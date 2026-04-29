import { getSession } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { runTool } from '@/lib/tools'
export const runtime = 'nodejs'

// -- GET /api/dashboards/[id]/data -----------------------------
// Executes all panel queries for a dashboard and returns results.
// Called on initial load and by the client auto-refresh timer.
// Time window helpers
function getTimeWindow(tw: string): { time_from: string; time_to: string; interval: string } {
  const now = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  const fmt = (d: Date) => d.toISOString()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  const presets: Record<string, number> = {
    'today': 0, '15m': 15 * 60 * 1000, '1h': 60 * 60 * 1000,
    '6h': 6 * 60 * 60 * 1000, '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000, '30d': 30 * 24 * 60 * 60 * 1000,
  }
  const intervalLabels: Record<string, string> = {
    'today': '1 day', '15m': '15 minutes', '1h': '1 hour',
    '6h': '6 hours', '24h': '24 hours', '7d': '7 days', '30d': '30 days',
  }
  if (tw === 'today') {
    return { time_from: fmt(today), time_to: fmt(now), interval: '1 day' }
  }
  const ms = presets[tw]
  if (ms) {
    return { time_from: fmt(new Date(now.getTime() - ms)), time_to: fmt(now), interval: intervalLabels[tw] || '1 hour' }
  }
  // Default: today
  return { time_from: fmt(today), time_to: fmt(now), interval: '1 day' }
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })

  const { id } = await params
  const url = new URL(req.url)
  const timeWindow = url.searchParams.get('time_window') || 'today'
  const customFromP = url.searchParams.get('time_from') || ''
  const customToP   = url.searchParams.get('time_to')   || ''
  const { time_from, time_to, interval } = timeWindow === 'custom' && customFromP && customToP
    ? { time_from: customFromP, time_to: customToP, interval: 'custom' }
    : getTimeWindow(timeWindow)
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
          const q = String(p.query || '')
            .replace(/\{\{time_from\}\}/g, time_from)
            .replace(/\{\{time_to\}\}/g, time_to)
            .replace(/\{\{interval\}\}/g, interval)
          data = await runTool('query_database', {
            connection_id: p.source_id,
            sql: q,
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
