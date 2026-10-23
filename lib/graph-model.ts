// lib/graph-model.ts
// Knowledge-graph domain model: types, persistence, in-memory loader, traversal,
// and the identity-matching primitives the resolver uses. Pure helpers here are
// unit-tested; DB helpers wrap the unified sql client.
//
// The graph is small (a plant is hundreds–low-thousands of nodes), so we load it
// whole into memory for traversal rather than running recursive SQL.

import { getDb, nowExpr } from './db'

export type NodeKind = 'plant' | 'line' | 'asset' | 'sensor' | 'gateway' | 'source' | 'dimension' | 'other'
export type EdgeType = 'contains' | 'measured_on' | 'same_as' | 'related'
export type Provenance = 'data' | 'manual'
export type EdgeStatus = 'verified' | 'pending' | 'rejected'
export type NodeStatus = 'active' | 'retired'

export interface GraphNode {
  id: string
  source_type: string
  source_id: string
  kind: NodeKind
  natural_key: string
  label: string
  props: Record<string, unknown>
  status: NodeStatus
}

export interface GraphEdge {
  id: string
  src: string
  dst: string
  type: EdgeType
  provenance: Provenance
  confidence: number | null
  status: EdgeStatus
  evidence: string
}

export interface Graph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

// -- id construction ----------------------------------------------------------
// Node ids are deterministic so a re-materialisation of the same source updates
// rows in place (drift) rather than duplicating them.
export function nodeId(sourceType: string, sourceId: string, kind: NodeKind, naturalKey: string): string {
  return `${sourceType}:${sourceId}:${kind}:${naturalKey}`
}

// A structural (data) edge id is deterministic from its endpoints+type, so the same
// containment is never inserted twice. same_as ids are also deterministic but order
// the endpoints so A↔B and B↔A collapse to one proposal.
export function edgeId(src: string, dst: string, type: EdgeType): string {
  if (type === 'same_as') {
    const [a, b] = [src, dst].sort()
    return `same_as|${a}|${b}`
  }
  return `${type}|${src}|${dst}`
}

// -- identity matching primitives (pure) --------------------------------------
// Normalise an asset key/label for cross-source comparison: lowercase, strip a
// common trailing device-role suffix (P=power, E=energy) and non-alphanumerics,
// so 'GM01000009P' and 'GM01000009' share a stem.
export function normalizeKey(raw: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_\-./]+/g, '')
}

// The "stem" additionally drops a single trailing letter when the key is an
// alphanumeric tag ending in one (common for meter/device suffixes), so a machine
// id and its meter id collapse. Conservative: only when it leaves >=4 chars.
export function stemKey(raw: string): string {
  const n = normalizeKey(raw)
  const m = /^([0-9a-z]*\d[0-9a-z]*?)([a-z])$/.exec(n)
  if (m && m[1].length >= 4) return m[1]
  return n
}

// Similarity in [0,1]. Exact normalised match = 1; shared stem = 0.85; otherwise a
// token/trigram overlap. Deterministic and explainable (we surface the reason).
export function matchScore(a: string, b: string): { score: number; reason: string } {
  const na = normalizeKey(a), nb = normalizeKey(b)
  if (!na || !nb) return { score: 0, reason: 'empty key' }
  if (na === nb) return { score: 1, reason: `exact match on "${a}"` }
  const sa = stemKey(a), sb = stemKey(b)
  if (sa && sa === sb) return { score: 0.85, reason: `shared asset-tag stem "${sa}" (differing suffix)` }
  // containment (one key fully inside the other, >=5 chars)
  if (na.length >= 5 && nb.length >= 5 && (na.includes(nb) || nb.includes(na))) {
    return { score: 0.7, reason: `one key contains the other ("${a}" / "${b}")` }
  }
  // trigram Jaccard
  const tri = (s: string) => { const g = new Set<string>(); for (let i = 0; i < s.length - 2; i++) g.add(s.slice(i, i + 3)); return g }
  const ga = tri(na), gb = tri(nb)
  if (!ga.size || !gb.size) return { score: 0, reason: 'too short to compare' }
  let inter = 0; ga.forEach(g => { if (gb.has(g)) inter++ })
  const j = inter / (ga.size + gb.size - inter)
  return { score: Math.round(j * 100) / 100, reason: `name similarity ${(j * 100) | 0}%` }
}

// -- persistence --------------------------------------------------------------
interface NodeRow { id: string; source_type: string; source_id: string; kind: string; natural_key: string; label: string; props: string; status: string }
interface EdgeRow { id: string; src: string; dst: string; type: string; provenance: string; confidence: number | null; status: string; evidence: string }

export async function loadGraph(): Promise<Graph> {
  const sql = getDb()
  const [nrows, erows] = await Promise.all([
    sql`SELECT id, source_type, source_id, kind, natural_key, label, props, status FROM graph_nodes`.catch(() => []) as Promise<NodeRow[]>,
    sql`SELECT id, src, dst, type, provenance, confidence, status, evidence FROM graph_edges`.catch(() => []) as Promise<EdgeRow[]>,
  ])
  const nodes: GraphNode[] = (nrows as NodeRow[]).map(r => ({
    id: r.id, source_type: r.source_type, source_id: r.source_id,
    kind: r.kind as NodeKind, natural_key: r.natural_key, label: r.label,
    props: safeJson(r.props), status: (r.status as NodeStatus) || 'active',
  }))
  const edges: GraphEdge[] = (erows as EdgeRow[]).map(r => ({
    id: r.id, src: r.src, dst: r.dst, type: r.type as EdgeType,
    provenance: (r.provenance as Provenance) || 'data',
    confidence: r.confidence, status: (r.status as EdgeStatus) || 'verified',
    evidence: r.evidence || '',
  }))
  return { nodes, edges }
}

function safeJson(s: string): Record<string, unknown> {
  try { const v = JSON.parse(s || '{}'); return v && typeof v === 'object' ? v as Record<string, unknown> : {} } catch { return {} }
}

// Upsert a batch of nodes/edges in one transaction-ish pass. Deterministic ids
// mean ON CONFLICT updates in place (drift: existing rows refreshed, not dupes).
export async function upsertNodes(nodes: GraphNode[]): Promise<void> {
  const sql = getDb()
  for (const n of nodes) {
    await sql`
      INSERT INTO graph_nodes (id, source_type, source_id, kind, natural_key, label, props, status, updated_at)
      VALUES (${n.id}, ${n.source_type}, ${n.source_id}, ${n.kind}, ${n.natural_key}, ${n.label}, ${JSON.stringify(n.props || {})}, ${n.status || 'active'}, ${nowExpr()})
      ON CONFLICT(id) DO UPDATE SET
        label=excluded.label, props=excluded.props, kind=excluded.kind,
        status=excluded.status, updated_at=excluded.updated_at
    `
  }
}

export async function upsertEdges(edges: GraphEdge[]): Promise<void> {
  const sql = getDb()
  for (const e of edges) {
    // Never clobber a human decision: if a same_as was verified/rejected by an
    // admin, a re-proposal must not reset it to pending.
    await sql`
      INSERT INTO graph_edges (id, src, dst, type, provenance, confidence, status, evidence, updated_at)
      VALUES (${e.id}, ${e.src}, ${e.dst}, ${e.type}, ${e.provenance}, ${e.confidence}, ${e.status}, ${e.evidence}, ${nowExpr()})
      ON CONFLICT(id) DO UPDATE SET
        confidence=excluded.confidence, evidence=excluded.evidence, updated_at=excluded.updated_at,
        status=CASE WHEN graph_edges.provenance='manual' OR graph_edges.status IN ('verified','rejected')
                    THEN graph_edges.status ELSE excluded.status END
    `
  }
}

// -- traversal (in-memory) ----------------------------------------------------
export function neighbours(g: Graph, nodeId: string, opts: { includeRejected?: boolean } = {}): Array<{ node: GraphNode; edge: GraphEdge }> {
  const byId = new Map(g.nodes.map(n => [n.id, n]))
  const out: Array<{ node: GraphNode; edge: GraphEdge }> = []
  for (const e of g.edges) {
    if (!opts.includeRejected && e.status === 'rejected') continue
    if (e.src === nodeId && byId.has(e.dst)) out.push({ node: byId.get(e.dst)!, edge: e })
    else if (e.dst === nodeId && byId.has(e.src)) out.push({ node: byId.get(e.src)!, edge: e })
  }
  return out
}

// Connected-component scope: all nodes reachable from a seed over non-rejected
// edges, up to an optional depth. Used by the Explorer to expand a line/plant.
export function subgraph(g: Graph, seedIds: string[], depth = 2): Graph {
  const keep = new Set<string>(seedIds)
  let frontier = [...seedIds]
  for (let d = 0; d < depth; d++) {
    const next: string[] = []
    for (const id of frontier) {
      for (const { node } of neighbours(g, id)) {
        if (!keep.has(node.id)) { keep.add(node.id); next.push(node.id) }
      }
    }
    frontier = next
    if (!frontier.length) break
  }
  return {
    nodes: g.nodes.filter(n => keep.has(n.id)),
    edges: g.edges.filter(e => keep.has(e.src) && keep.has(e.dst) && e.status !== 'rejected'),
  }
}
