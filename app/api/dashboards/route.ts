import { getSession } from '@/lib/auth'
import { log } from '@/lib/logger'
import { getDb, nowExpr } from '@/lib/db'
import { readonlyGuard } from '@/lib/dashboard-plan'
export const runtime = 'nodejs'

const MAX_PANELS_PER_DASHBOARD = 50

// Reject a non-read-only panel query at write time (defence in depth — the panel
// executor also guards at run time). Database sources only; api/file defer.
async function denyNonReadonly(sql: ReturnType<typeof getDb>, source_type: string | undefined, source_id: string | undefined, query: string | undefined): Promise<string | null> {
  if ((source_type ?? 'database') !== 'database' || !source_id || !query) return null
  let dialect = 'postgres'
  try { const r = await sql`SELECT dialect FROM db_connections WHERE id=${source_id}` as Array<{ dialect?: string }>; if (r[0]?.dialect) dialect = r[0].dialect } catch { /* default dialect */ }
  const g = readonlyGuard(query, dialect)
  return g.ok ? null : (g.reason || 'only read-only SELECT queries are allowed')
}

// Ownership check for a single panel (via its dashboard) — prevents cross-user
// panel edits/deletes by guessed id (IDOR).
async function ownsPanel(sql: ReturnType<typeof getDb>, id: string, userId: string): Promise<boolean> {
  const r = await sql`SELECT p.id FROM dashboard_panels p JOIN dashboards d ON d.id = p.dashboard_id WHERE p.id = ${id} AND d.owner_id = ${userId}`
  return r.length > 0
}

// -- GET -- list dashboards visible to the user -----------------
export async function GET() {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  const sql = getDb()
  const rows = await sql`
    SELECT d.id, d.name, d.description, d.owner_id, d.is_public,
           d.refresh_sec, d.created_at, d.updated_at, d.superset_embed_uuid,
           d.source_kind, d.source_sql, d.source_connection, d.source_chart_spec,
           d.superset_dashboard_id, d.superset_chart_id, d.superset_dataset_id,
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
    const { name, description, is_public, refresh_sec, default_time_window } = body
    if (!name?.trim()) return Response.json({ error: 'Name required' }, { status: 400 })
    const dtw = typeof default_time_window === 'string' && default_time_window.trim() ? default_time_window.trim() : null
    const rows = await sql`
      INSERT INTO dashboards (name, description, owner_id, is_public, refresh_sec, default_time_window)
      VALUES (${name.trim()}, ${description ?? ''}, ${session.id},
              ${is_public ?? false}, ${refresh_sec ?? 300}, ${dtw})
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
             updated_at  = ${nowExpr()}
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
    const cnt = await sql`SELECT COUNT(*) AS c FROM dashboard_panels WHERE dashboard_id = ${dashboard_id}`
    if (Number((cnt[0] as { c: number }).c) >= MAX_PANELS_PER_DASHBOARD)
      return Response.json({ error: `dashboard already has the maximum ${MAX_PANELS_PER_DASHBOARD} panels` }, { status: 400 })
    const roErr = await denyNonReadonly(sql, source_type, source_id, query)
    if (roErr) return Response.json({ error: `panel query rejected: ${roErr}` }, { status: 400 })
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
         ${col ?? 0}, ${row ?? 0}, ${w ?? 6}, ${h ?? 1},
         ${sort_order ?? 0})
      RETURNING id`
    await sql`UPDATE dashboards SET updated_at = ${nowExpr()} WHERE id = ${dashboard_id}`
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
    if (!(await ownsPanel(sql, id, session.id))) return Response.json({ error: 'Not found' }, { status: 404 })
    // Geometry-only update: when the body carries no content fields (title/query),
    // this is a resize/move — touch ONLY col/row/w/h and leave the panel's title,
    // query and source intact. (Previously a resize sent just {id,w,h} and this
    // branch blanked everything else to its defaults.)
    const geometryOnly = title === undefined && query === undefined && source_id === undefined && chart_type === undefined
    if (geometryOnly) {
      await sql`
        UPDATE dashboard_panels
        SET    col = ${col ?? 0}, row = ${row ?? 0}, w = ${w ?? 6}, h = ${h ?? 1}
        WHERE  id = ${id}`
      return Response.json({ ok: true })
    }
    const roErr = await denyNonReadonly(sql, source_type, source_id, query)
    if (roErr) return Response.json({ error: `panel query rejected: ${roErr}` }, { status: 400 })
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
             w            = ${w ?? 6},
             h            = ${h ?? 1}
      WHERE  id = ${id}`
    return Response.json({ ok: true })
  }

  // -- DELETE PANEL ----------------------------------------------
  if (action === 'delete_panel') {
    const { id } = body
    if (!id) return Response.json({ error: 'ID required' }, { status: 400 })
    // Scope the delete to panels on the caller's own dashboards (IDOR guard).
    await sql`DELETE FROM dashboard_panels WHERE id = ${id} AND dashboard_id IN (SELECT id FROM dashboards WHERE owner_id = ${session.id})`
    return Response.json({ ok: true })
  }

  // -- REORDER PANELS --------------------------------------------
  if (action === 'reorder_panels') {
    const panels = body.panels as { id: string; col: number; row: number; w: number; h: number }[]
    if (!Array.isArray(panels)) return Response.json({ error: 'panels must be array' }, { status: 400 })
    // Persist sort_order by array position (the grid auto-flows by sort_order), plus
    // any col/row/w/h the client sends.
    for (let i = 0; i < panels.length; i++) {
      const p = panels[i]
      await sql`
        UPDATE dashboard_panels
        SET col = ${p.col ?? 0}, row = ${p.row ?? 0}, w = ${p.w ?? 6}, h = ${p.h ?? 1}, sort_order = ${i}
        WHERE id = ${p.id} AND dashboard_id IN (SELECT id FROM dashboards WHERE owner_id = ${session.id})`
    }
    return Response.json({ ok: true })
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    log.error({ service: 'api_dashboards', err }, 'POST /api/dashboards failed:')
    return Response.json({ error: (err as Error).message }, { status: 500 })
  }
}
