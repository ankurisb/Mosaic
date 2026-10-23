// lib/graph-materialize.ts
// The GENERIC materialiser. Same code at every install; the output differs only
// because the connected sources differ. It never hand-codes a customer's schema:
// it reads the semantic roles the describer assigned (semantic_descriptions) and
// the conformed-dimension crosswalk (022), then emits nodes/edges by fixed rules.
//
// Pipeline per run:
//   1. enumerate every connected source (db / prism / api)
//   2. per source, an adapter emits entity NODES + intra-source structural EDGES
//   3. identity resolution proposes cross-source same_as edges (status=pending)
//   4. persist (upsert — deterministic ids, human decisions preserved), record run
//
// A source with no shared keys produces an island (its own internal structure,
// no cross edges). That is the correct result, not a failure.

import { getDb, nowExpr } from './db'
import { getSemanticModel } from './semantic-model'
import { isIdentifierName } from './dashboard-readiness'
import { queryDatabase, queryPrism } from './tools'
import {
  type Graph, type GraphNode, type GraphEdge, type NodeKind,
  nodeId, edgeId, matchScore, upsertNodes, upsertEdges, loadGraph,
} from './graph-model'
import { log } from './logger'

// Dimension columns, ranked high→low in the plant hierarchy. Lower index = higher
// up the tree. Anything not listed ranks last and sits just above the asset.
const HIER: Array<{ re: RegExp; rank: number; kind: NodeKind }> = [
  { re: /^(plant|facility|site|factory)/i, rank: 0, kind: 'plant' },
  { re: /^(area|zone|building|dept|department)/i, rank: 1, kind: 'line' },
  { re: /^(line|cell|station|workcenter|workcentre)/i, rank: 2, kind: 'line' },
]
function dimRank(col: string): { rank: number; kind: NodeKind } {
  for (const h of HIER) if (h.re.test(col)) return { rank: h.rank, kind: h.kind }
  return { rank: 50, kind: 'dimension' }
}
function looksLabelCol(col: string): boolean {
  return /(name|label|title|desc|description)$/i.test(col)
}
const CROSS_MATCH_THRESHOLD = 0.6

function tableOf(key: string): string { return key.includes('.') ? key.split('.')[0] : '' }
function colOf(key: string): string { const p = key.split('.'); return p[p.length - 1] }
function ident(s: string): string { return /^[A-Za-z_][A-Za-z0-9_]*$/.test(s) ? s : `"${s.replace(/"/g, '""')}"` }

interface SourceRef { source_type: string; source_id: string; label: string }
interface AdapterOut { nodes: GraphNode[]; edges: GraphEdge[]; note?: string }

// -- source enumeration -------------------------------------------------------
async function enumerateSources(): Promise<SourceRef[]> {
  const sql = getDb()
  const [dbs, prisms, apis] = await Promise.all([
    sql`SELECT id, label FROM db_connections ORDER BY created_at ASC`.catch(() => []) as Promise<Array<{ id: string; label: string }>>,
    sql`SELECT id, label FROM prism_instances WHERE active = true ORDER BY created_at ASC`.catch(() => []) as Promise<Array<{ id: string; label: string }>>,
    // One island node per published SERVICE (not per connection): a service is the
    // unit a user thinks of as "a connected API", and a service often has many
    // connections/endpoints that would otherwise flood the graph with stray dots.
    sql`SELECT id, label FROM api_services WHERE COALESCE(status,'published')='published' ORDER BY created_at ASC`.catch(() => []) as Promise<Array<{ id: string; label: string }>>,
  ])
  return [
    ...dbs.map(r => ({ source_type: 'database', source_id: r.id, label: r.label || r.id })),
    ...prisms.map(r => ({ source_type: 'prism', source_id: r.id, label: r.label || r.id })),
    ...apis.map(r => ({ source_type: 'api', source_id: r.id, label: r.label || r.id })),
  ]
}

// -- database adapter ---------------------------------------------------------
// Reads the semantic model: identifier columns define asset nodes; dimension
// columns define hierarchy nodes; co-occurrence in a row is the containment edge.
async function adaptDatabase(src: SourceRef): Promise<AdapterOut> {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const model = await getSemanticModel('database', src.source_id)
  if (!model.byKey.size) return { nodes, edges, note: 'no semantic model — run Describe first' }

  // group columns by table, classify
  const tables = new Map<string, { ids: string[]; dims: string[]; label?: string }>()
  for (const [key, f] of model.byKey) {
    const table = tableOf(key); if (!table) continue
    const col = colOf(key)
    const t = tables.get(table) || { ids: [], dims: [] }
    const role = f.role || null
    if (role === 'identifier' || (!role && isIdentifierName(col))) t.ids.push(col)
    else if (role === 'dimension') t.dims.push(col)
    else if (!t.label && looksLabelCol(col)) t.label = col
    tables.set(table, t)
  }

  const seen = new Set<string>()
  const addNode = (n: GraphNode) => { if (!seen.has(n.id)) { seen.add(n.id); nodes.push(n) } }
  const addEdge = (a: string, b: string, evidence: string) => {
    edges.push({ id: edgeId(a, b, 'contains'), src: a, dst: b, type: 'contains', provenance: 'data', confidence: null, status: 'verified', evidence })
  }

  for (const [table, t] of tables) {
    if (!t.ids.length) continue
    const idCol = t.ids[0]
    const dimCols = t.dims
    const labelCol = t.label
    const cols = Array.from(new Set([idCol, ...dimCols, labelCol].filter(Boolean) as string[]))
    const selectList = cols.map(ident).join(', ')
    let rows: Record<string, unknown>[] = []
    try {
      const res = await queryDatabase(src.source_id, `SELECT DISTINCT ${selectList} FROM ${ident(table)}`, { maxRows: 1000 }) as { rows?: Record<string, unknown>[] }
      rows = res?.rows || []
    } catch (e) {
      log.warn({ table, err: (e as Error)?.message }, 'graph: table introspection failed')
      continue
    }
    for (const row of rows) {
      const idVal = row[idCol]
      if (idVal == null || idVal === '') continue
      const idStr = String(idVal)
      const labelVal = labelCol && row[labelCol] != null ? String(row[labelCol]) : idStr
      const assetId = nodeId('database', src.source_id, 'asset', idStr)
      addNode({ id: assetId, source_type: 'database', source_id: src.source_id, kind: 'asset', natural_key: idStr, label: labelVal, props: { table, source: src.label }, status: 'active' })

      // hierarchy chain from present dimension values, ordered by rank
      const chain = dimCols
        .filter(c => row[c] != null && row[c] !== '')
        .map(c => ({ col: c, val: String(row[c]), ...dimRank(c) }))
        .sort((a, b) => a.rank - b.rank)
      let prevId: string | null = null
      for (const d of chain) {
        const key = `${d.col}=${d.val}`
        const dId = nodeId('database', src.source_id, d.kind, key)
        addNode({ id: dId, source_type: 'database', source_id: src.source_id, kind: d.kind, natural_key: key, label: d.val, props: { dimension: d.col, source: src.label }, status: 'active' })
        if (prevId) addEdge(prevId, dId, `rows share ${d.col}`)
        prevId = dId
      }
      if (prevId) addEdge(prevId, assetId, `${table}.${idCol} grouped under ${chain[chain.length - 1].col}`)
    }
  }
  return { nodes, edges }
}

// -- prism adapter ------------------------------------------------------------
// The instance is a gateway node; its devices are sensor nodes it contains. Assets
// (if the instance exposes them) become asset nodes containing their devices.
function pluckArray(v: unknown): Record<string, unknown>[] {
  if (Array.isArray(v)) return v as Record<string, unknown>[]
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    for (const k of ['devices', 'assets', 'data', 'rows', 'items', 'results']) {
      if (Array.isArray(o[k])) return o[k] as Record<string, unknown>[]
    }
  }
  return []
}
function pick(o: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) { const v = o[k]; if (v != null && v !== '') return String(v) }
  return ''
}
async function adaptPrism(src: SourceRef): Promise<AdapterOut> {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  const gwId = nodeId('prism', src.source_id, 'gateway', src.source_id)
  nodes.push({ id: gwId, source_type: 'prism', source_id: src.source_id, kind: 'gateway', natural_key: src.source_id, label: src.label, props: { role: 'PRISM instance' }, status: 'active' })

  let devices: Record<string, unknown>[] = []
  try { devices = pluckArray(await queryPrism({ instance_id: src.source_id, operation: 'devices', page_size: 500 })) }
  catch (e) { log.warn({ err: (e as Error)?.message }, 'graph: prism devices failed'); return { nodes, edges, note: 'prism devices unavailable' } }

  for (const d of devices) {
    const name = pick(d, ['name', 'label', 'deviceName', 'id'])
    if (!name) continue
    const devUuid = pick(d, ['id', 'uuid', 'deviceId'])
    const sId = nodeId('prism', src.source_id, 'sensor', name)
    nodes.push({ id: sId, source_type: 'prism', source_id: src.source_id, kind: 'sensor', natural_key: name, label: name, props: { deviceId: devUuid, type: pick(d, ['type', 'deviceProfile']) || 'device', source: src.label }, status: 'active' })
    edges.push({ id: edgeId(gwId, sId, 'contains'), src: gwId, dst: sId, type: 'contains', provenance: 'data', confidence: null, status: 'verified', evidence: 'device registered on instance' })
  }
  return { nodes, edges }
}

// -- api adapter --------------------------------------------------------------
// Without a declared entity endpoint we can't invent structure, so the connection
// enters the graph as a single source node — an island until a real link appears.
async function adaptApi(src: SourceRef): Promise<AdapterOut> {
  const id = nodeId('api', src.source_id, 'source', src.source_id)
  return {
    nodes: [{ id, source_type: 'api', source_id: src.source_id, kind: 'source', natural_key: src.source_id, label: src.label, props: { note: 'no shared keys discovered — independent source' }, status: 'active' }],
    edges: [],
    note: 'api entered as island (no entity endpoint introspected)',
  }
}

// -- identity resolution ------------------------------------------------------
// Propose same_as between asset/sensor nodes of DIFFERENT sources when their keys
// match above threshold. Each proposal carries its confidence and a human-readable
// reason. Pairs an admin already decided are skipped (upsert preserves decisions).
function resolveIdentities(nodes: GraphNode[], decided: Set<string>): GraphEdge[] {
  const cand = nodes.filter(n => n.kind === 'asset' || n.kind === 'sensor')
  const out: GraphEdge[] = []
  const made = new Set<string>()
  for (let i = 0; i < cand.length; i++) {
    for (let j = i + 1; j < cand.length; j++) {
      const a = cand[i], b = cand[j]
      if (a.source_type === b.source_type && a.source_id === b.source_id) continue
      const { score, reason } = matchScore(a.label || a.natural_key, b.label || b.natural_key)
      if (score < CROSS_MATCH_THRESHOLD) continue
      const id = edgeId(a.id, b.id, 'same_as')
      if (made.has(id) || decided.has(id)) continue
      made.add(id)
      out.push({ id, src: a.id, dst: b.id, type: 'same_as', provenance: 'data', confidence: score, status: 'pending', evidence: `${reason} · ${a.source_type}:${a.label} ↔ ${b.source_type}:${b.label}` })
    }
  }
  return out
}

// -- orchestration ------------------------------------------------------------
export interface MaterializeResult { ok: boolean; nodes: number; edges: number; pending: number; sources: number; detail: Record<string, unknown>; error?: string }

export async function materializeGraph(): Promise<MaterializeResult> {
  const sql = getDb()
  const runId = (globalThis.crypto?.randomUUID?.() || String(Date.now()) + Math.random().toString(16).slice(2))
  await sql`INSERT INTO graph_runs (id, status) VALUES (${runId}, 'running')`.catch(() => {})
  const detail: Record<string, unknown> = {}
  try {
    const sources = await enumerateSources()
    const allNodes: GraphNode[] = []
    const allEdges: GraphEdge[] = []
    for (const src of sources) {
      let out: AdapterOut
      if (src.source_type === 'database') out = await adaptDatabase(src)
      else if (src.source_type === 'prism') out = await adaptPrism(src)
      else out = await adaptApi(src)
      allNodes.push(...out.nodes)
      allEdges.push(...out.edges)
      detail[`${src.source_type}:${src.label}`] = { nodes: out.nodes.length, edges: out.edges.length, ...(out.note ? { note: out.note } : {}) }
    }

    // preserve human decisions, skip re-proposing decided pairs
    const existing = await loadGraph()
    const decided = new Set(existing.edges.filter(e => e.type === 'same_as' && (e.status === 'verified' || e.status === 'rejected')).map(e => e.id))
    const proposals = resolveIdentities(allNodes, decided)

    await upsertNodes(allNodes)
    await upsertEdges([...allEdges, ...proposals])

    const pending = proposals.length
    detail.sameas_proposed = pending
    if (runId) {
      await sql`UPDATE graph_runs SET status='ok', finished_at=${nowExpr()}, nodes=${allNodes.length}, edges=${allEdges.length + pending}, pending=${pending}, sources=${sources.length}, detail=${JSON.stringify(detail)} WHERE id=${runId}`
    }
    log.info({ nodes: allNodes.length, edges: allEdges.length + pending, pending, sources: sources.length }, 'graph materialised')
    return { ok: true, nodes: allNodes.length, edges: allEdges.length + pending, pending, sources: sources.length, detail }
  } catch (e) {
    const error = (e as Error)?.message || String(e)
    if (runId) await sql`UPDATE graph_runs SET status='error', finished_at=${nowExpr()}, error=${error}, detail=${JSON.stringify(detail)} WHERE id=${runId}`.catch(() => {})
    log.error({ err: error }, 'graph materialisation failed')
    return { ok: false, nodes: 0, edges: 0, pending: 0, sources: 0, detail, error }
  }
}

export async function lastRun(): Promise<Record<string, unknown> | null> {
  const sql = getDb()
  const rows = await sql`SELECT * FROM graph_runs ORDER BY started_at DESC LIMIT 1`.catch(() => []) as Array<Record<string, unknown>>
  return rows[0] || null
}
