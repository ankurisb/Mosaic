import { getSession } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { runTool } from '@/lib/tools'
export const runtime = 'nodejs'

// -- GET /api/dashboards/[id]/data -----------------------------
// Executes all panel queries for a dashboard and returns results.
// Called on initial load and by the client auto-refresh timer.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })

  const { id } = await params
  const sql = getDb()

  // Verify the user can see this dashboard
  const dash = await sql`
    SELECT id, name, refresh_sec
    FROM   dashboards
    WHERE  id = ${id} AND (owner_id = ${session.id} OR is_public = true)`
  if (!dash.length) return Response.json({ error: 'Not found' }, { status: 404 })

  // Load all panels
  const panels = await sql`
    SELECT id, title, subtitle, source_type, source_id,
           query, chart_type, chart_config, refresh_sec,
           col, row, w, h, sort_order
    FROM   dashboard_panels
    WHERE  dashboard_id = ${id}
    ORDER  BY sort_order ASC, row ASC, col ASC`

  // Execute each panel query in parallel
  const results = await Promise.all(
    panels.map(async (panel) => {
      const p = panel as Record<string, unknown>
      const start = Date.now()
      try {
        let data: unknown
        if (p.source_type === 'database') {
          data = await runTool('query_database', {
            connection_id: p.source_id,
            sql: p.query,
          })
        } else if (p.source_type === 'api') {
          // For API panels, query is the path (e.g. /odata/OEEReport?$top=20)
          data = await runTool('call_api', {
            connection_id: p.source_id,
            method: 'GET',
            path: String(p.query),
          })
        } else if (p.source_type === 'file_server') {
          data = await runTool('read_file_server', {
            server_id: p.source_id,
            file_hint: String(p.query),
            ts_strategy: 'auto',
            max_rows: 500,
          })
        }
        return {
          panel_id: p.id,
          ok: true,
          data,
          latency_ms: Date.now() - start,
        }
      } catch (err) {
        return {
          panel_id: p.id,
          ok: false,
          error: err instanceof Error ? err.message : 'Query failed',
          latency_ms: Date.now() - start,
        }
      }
    })
  )

  return Response.json({
    dashboard: dash[0],
    panels,
    results,
    fetched_at: new Date().toISOString(),
  })
}
