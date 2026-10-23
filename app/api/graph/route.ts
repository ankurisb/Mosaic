// app/api/graph/route.ts
// Knowledge graph read + curation API.
//   GET                      -> full graph { nodes, edges, run } (reads allowed to any signed-in user)
//   GET ?scope=<nodeId>&depth=2  -> connected subgraph around a seed node
//   POST { action:'rebuild' }                         -> re-materialise (admin)
//   POST { action:'confirm'|'reject', edge_id }        -> resolve a pending same_as (admin)
//   POST { action:'manual_edge', src, dst, type?, note? } -> admin-asserted edge (admin)
//
// Curation (confirm/reject/manual) and rebuild are admin-only, mirroring datasource
// and semantic-dictionary configuration. Every edge stays attributable: data edges
// carry provenance='data', admin edges 'manual'.
import { getSession } from '@/lib/auth'
import { getDb, nowExpr } from '@/lib/db'
import { log } from '@/lib/logger'
import { loadGraph, subgraph, edgeId, type EdgeType } from '@/lib/graph-model'
import { materializeGraph, lastRun } from '@/lib/graph-materialize'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  const { searchParams } = new URL(req.url)
  const g = await loadGraph()
  const scope = searchParams.get('scope')
  const run = await lastRun()
  if (scope) {
    const depth = Math.max(1, Math.min(5, Number(searchParams.get('depth') || 2)))
    const sub = subgraph(g, [scope], depth)
    return Response.json({ ...sub, run })
  }
  return Response.json({ ...g, run })
}

export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  if (session.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const action = String(body.action || '')
  const sql = getDb()

  try {
    if (action === 'rebuild') {
      const res = await materializeGraph()
      return Response.json(res, { status: res.ok ? 200 : 500 })
    }

    if (action === 'confirm' || action === 'reject') {
      const edge = String(body.edge_id || '')
      if (!edge) return Response.json({ error: 'edge_id required' }, { status: 400 })
      const status = action === 'confirm' ? 'verified' : 'rejected'
      await sql`UPDATE graph_edges SET status=${status}, provenance='manual', updated_at=${nowExpr()} WHERE id=${edge}`
      log.info({ edge, status, by: session.email }, 'graph: identity match resolved')
      return Response.json({ ok: true, edge_id: edge, status })
    }

    if (action === 'manual_edge') {
      const src = String(body.src || ''), dst = String(body.dst || '')
      const type = (String(body.type || 'related') as EdgeType)
      if (!src || !dst) return Response.json({ error: 'src and dst required' }, { status: 400 })
      const id = edgeId(src, dst, type)
      const note = String(body.note || 'admin-asserted')
      await sql`
        INSERT INTO graph_edges (id, src, dst, type, provenance, confidence, status, evidence, updated_at)
        VALUES (${id}, ${src}, ${dst}, ${type}, 'manual', NULL, 'verified', ${note}, ${nowExpr()})
        ON CONFLICT(id) DO UPDATE SET status='verified', provenance='manual', evidence=excluded.evidence, updated_at=excluded.updated_at
      `
      log.info({ id, by: session.email }, 'graph: manual edge added')
      return Response.json({ ok: true, edge_id: id })
    }

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 })
  } catch (e) {
    const error = (e as Error)?.message || String(e)
    log.error({ err: error, action }, 'graph POST failed')
    return Response.json({ error }, { status: 500 })
  }
}
