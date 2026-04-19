import { getSession } from '@/lib/auth'
import { getDb } from '@/lib/db'
export const runtime = 'nodejs'

// -- GET /api/dashboards/[id] -- load dashboard + panels --------
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  const { id } = await params
  const sql = getDb()

  const dash = await sql`
    SELECT id, name, description, owner_id, is_public, refresh_sec, created_at, updated_at
    FROM   dashboards
    WHERE  id = ${id} AND (owner_id = ${session.id} OR is_public = true)`
  if (!dash.length) return Response.json({ error: 'Not found' }, { status: 404 })

  const panels = await sql`
    SELECT id, title, subtitle, source_type, source_id,
           query, chart_type, chart_config, refresh_sec,
           col, row, w, h, sort_order
    FROM   dashboard_panels
    WHERE  dashboard_id = ${id}
    ORDER  BY sort_order ASC, row ASC, col ASC`

  return Response.json({ dashboard: dash[0], panels })
}
