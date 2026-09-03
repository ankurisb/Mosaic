// app/api/saved-queries/columns/route.ts
// Return the result COLUMNS of a saved query, so UIs (rule conditions, alert
// thresholds, report field pickers) can offer a column dropdown instead of a free-
// text field name — preventing the "typed field doesn't match a result column ->
// condition silently never fires" mismatch. Runs the query with limit 1.
import { getSession } from '@/lib/auth'
import { getDb } from '@/lib/db'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })

  const { saved_query_id } = await req.json().catch(() => ({})) as { saved_query_id?: string }
  if (!saved_query_id) return Response.json({ error: 'saved_query_id required' }, { status: 400 })

  const sql = getDb()
  const [sq] = await sql`SELECT connection_id, query FROM saved_queries WHERE id = ${saved_query_id} LIMIT 1` as unknown as { connection_id: string; query: string }[]
  if (!sq) return Response.json({ columns: [], error: 'Saved query not found' })
  if (!sq.connection_id) return Response.json({ columns: [], error: 'Saved query has no connection' })

  try {
    // Reuse the query-runner via the app's internal port (not the external Caddy
    // origin, which the container can't reach — same fix as the validate endpoint).
    const internal = `http://127.0.0.1:${process.env.PORT || '3001'}`
    const res = await fetch(`${internal}/api/query-runner`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: req.headers.get('cookie') || '' },
      body: JSON.stringify({ connectionId: sq.connection_id, query: sq.query, limit: 1 }),
      signal: AbortSignal.timeout(15000),
    })
    const data = await res.json()
    if (!res.ok) return Response.json({ columns: [], error: data.error || `HTTP ${res.status}` })
    return Response.json({ columns: data.columns || [] })
  } catch (e) {
    return Response.json({ columns: [], error: e instanceof Error ? e.message : 'Could not read columns' })
  }
}
