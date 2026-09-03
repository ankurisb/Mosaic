// app/api/superset/validate-dashboard/route.ts
// Live pre-validation for the "build a dashboard in Superset from a query" flow.
// A UI (or the API caller) posts a connection + SQL + chart spec; this runs the
// query to learn the ACTUAL result columns/rows, then checks the chart spec against
// them and returns { valid, errors, warnings } — WITHOUT touching Superset.
//
// The point (issue #2): surface spec problems (unknown columns, dimension==value
// duplication, non-numeric metric, empty/ungrouped result) here, in Mosaic, tied to
// the query the user wrote — instead of letting them land as an opaque error on a
// broken Superset dashboard.
import { getSession } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { validateChartSpec, type ChartSpec } from '@/lib/superset-dashboard'

export const runtime = 'nodejs'

const READ_ONLY_SQL = /^\s*(SELECT|WITH)\b/i

export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  if (session.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const { connectionLabel, sql, chart } = body as {
    connectionLabel?: string; sql?: string; chart?: ChartSpec
  }

  if (!connectionLabel || !sql || !chart?.vizType) {
    return Response.json({ error: 'connectionLabel, sql and chart.vizType are required' }, { status: 400 })
  }
  if (!READ_ONLY_SQL.test(sql)) {
    return Response.json({
      valid: false,
      errors: ['Dashboard SQL must be a read-only SELECT / WITH query.'],
      warnings: [],
    })
  }

  // Resolve the connection id from its label, then run the query to learn the shape.
  const db = getDb()
  const [conn] = await db`SELECT id FROM db_connections WHERE label = ${connectionLabel} LIMIT 1` as unknown as { id: string }[]
  if (!conn) {
    return Response.json({ valid: false, errors: [`Connection "${connectionLabel}" not found.`], warnings: [] })
  }

  // Reuse the query-runner internally (same execution path the user's preview uses).
  let columns: string[] = []
  let rows: Record<string, unknown>[] = []
  try {
    const origin = new URL(req.url).origin
    const res = await fetch(`${origin}/api/query-runner`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: req.headers.get('cookie') || '' },
      body: JSON.stringify({ connectionId: conn.id, query: sql, limit: 200 }),
      signal: AbortSignal.timeout(20000),
    })
    const data = await res.json()
    if (!res.ok) {
      // A SQL/connection error is itself a validation failure the user should see.
      return Response.json({
        valid: false,
        errors: [`The query didn't run: ${data.error || `HTTP ${res.status}`}`],
        warnings: [],
      })
    }
    columns = data.columns || []
    rows = data.rows || []
  } catch (e) {
    return Response.json({
      valid: false,
      errors: [`Couldn't run the query to validate it: ${e instanceof Error ? e.message : 'unknown error'}`],
      warnings: [],
    })
  }

  const result = validateChartSpec(columns, rows, chart)
  return Response.json({ ...result, columns, rowCount: rows.length })
}
