import { getSession } from '@/lib/auth'
import { log } from '@/lib/logger'
import { getDb } from '@/lib/db'
export const runtime = 'nodejs'

// -- GET -- list dashboards visible to the user -----------------
export async function GET() {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  const sql = getDb()
  const rows = await sql`
    SELECT d.id, d.name, d.description, d.owner_id, d.is_public,
           d.refresh_sec, d.created_at, d.updated_at, d.superset_embed_uuid,
           COUNT(p.id) AS panel_count
    FROM   dashboards d
    LEFT JOIN dashboard_panels p ON p.dashboard_id = d.id
    WHERE  d.owner_id = ${session.id} OR d.is_public = true
    GROUP  BY d.id
    ORDER  BY d.updated_at DESC`
  return Response.json({ dashboards: rows })
}

// -- POST -- create / update / delete dashboard or panel --------
export async function POST(req: Request) {
  try {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  const sql  = getDb()
  const body = await req.json()
  const { action } = body

  // -- CREATE DASHBOARD ------------------------------------------
  if (action === 'create_dashboard') {
    const { name, description, is_public, refresh_sec } = body
    if (!name?.trim()) return Response.json({ error: 'Name required' }, { status: 400 })
    const rows = await sql`
      INSERT INTO dashboards (name, description, owner_id, is_public, refresh_sec)
      VALUES (${name.trim()}, ${description ?? ''}, ${session.id},
              ${is_public ?? false}, ${refresh_sec ?? 300})
      RETURNING id`
    return Response.json({ id: rows[0].id })
  }

  // -- UPDATE DASHBOARD ------------------------------------------
  if (action === 'update_dashboard') {
    const { id, name, description, is_public, refresh_sec } = body
    if (!id) return Response.json({ error: 'ID required' }, { status: 400 })
    await sql`
      UPDATE dashboards
      SET    name        = ${name?.trim() ?? ''},
             description = ${description ?? ''},
             is_public   = ${is_public ?? false},
             refresh_sec = ${refresh_sec ?? 300},
             updated_at  = datetime('now')
      WHERE  id = ${id} AND owner_id = ${session.id}`
    return Response.json({ ok: true })
  }

  // -- DELETE DASHBOARD ------------------------------------------
  if (action === 'delete_dashboard') {
    const { id } = body
    if (!id) return Response.json({ error: 'ID required' }, { status: 400 })
    await sql`DELETE FROM dashboards WHERE id = ${id} AND owner_id = ${session.id}`
    return Response.json({ ok: true })
  }

  // -- ADD PANEL -------------------------------------------------
  if (action === 'add_panel') {
    const {
      dashboard_id, title, subtitle, source_type, source_id,
      query, chart_type, chart_config, refresh_sec,
      col, row, w, h, sort_order,
    } = body
    if (!dashboard_id || !title?.trim() || !source_id || !query?.trim())
      return Response.json({ error: 'dashboard_id, title, source_id and query are required' }, { status: 400 })
    // Verify ownership
    const owns = await sql`SELECT id FROM dashboards WHERE id = ${dashboard_id} AND owner_id = ${session.id}`
    if (!owns.length) return Response.json({ error: 'Not found' }, { status: 404 })
    const rows = await sql`
      INSERT INTO dashboard_panels
        (dashboard_id, title, subtitle, source_type, source_id,
         query, chart_type, chart_config, refresh_sec,
         col, row, w, h, sort_order)
      VALUES
        (${dashboard_id}, ${title.trim()}, ${subtitle ?? ''},
         ${source_type ?? 'database'}, ${source_id},
         ${query.trim()}, ${chart_type ?? 'bar'},
         ${JSON.stringify(chart_config ?? {})}, ${refresh_sec ?? null},
         ${col ?? 0}, ${row ?? 0}, ${w ?? 2}, ${h ?? 1},
         ${sort_order ?? 0})
      RETURNING id`
    await sql`UPDATE dashboards SET updated_at = datetime('now') WHERE id = ${dashboard_id}`
    return Response.json({ id: rows[0].id })
  }

  // -- UPDATE PANEL ----------------------------------------------
  if (action === 'update_panel') {
    const {
      id, title, subtitle, source_type, source_id,
      query, chart_type, chart_config, refresh_sec,
      col, row, w, h,
    } = body
    if (!id) return Response.json({ error: 'ID required' }, { status: 400 })
    await sql`
      UPDATE dashboard_panels
      SET    title        = ${title?.trim() ?? ''},
             subtitle     = ${subtitle ?? ''},
             source_type  = ${source_type ?? 'database'},
             source_id    = ${source_id},
             query        = ${query?.trim() ?? ''},
             chart_type   = ${chart_type ?? 'bar'},
             chart_config = ${JSON.stringify(chart_config ?? {})},
             refresh_sec  = ${refresh_sec ?? null},
             col          = ${col ?? 0},
             row          = ${row ?? 0},
             w            = ${w ?? 2},
             h            = ${h ?? 1}
      WHERE  id = ${id}`
    return Response.json({ ok: true })
  }

  // -- DELETE PANEL ----------------------------------------------
  if (action === 'delete_panel') {
    const { id } = body
    if (!id) return Response.json({ error: 'ID required' }, { status: 400 })
    await sql`DELETE FROM dashboard_panels WHERE id = ${id}`
    return Response.json({ ok: true })
  }

  // -- REORDER PANELS --------------------------------------------
  if (action === 'reorder_panels') {
    const panels = body.panels as { id: string; col: number; row: number; w: number; h: number }[]
    if (!Array.isArray(panels)) return Response.json({ error: 'panels must be array' }, { status: 400 })
    for (const p of panels) {
      await sql`
        UPDATE dashboard_panels
        SET col = ${p.col}, row = ${p.row}, w = ${p.w}, h = ${p.h}
        WHERE id = ${p.id}`
    }
    return Response.json({ ok: true })
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    log.error({ service: 'api_dashboards', err }, 'POST /api/dashboards failed:')
    return Response.json({ error: (err as Error).message }, { status: 500 })
  }
}
