import { getSession } from '@/lib/auth'
import { getDb } from '@/lib/db'
export const runtime = 'nodejs'

// -- GET -- list all workflows ----------------------------------
export async function GET() {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  const sql = getDb()
  const rows = await sql`
    SELECT id, name, description, problem_type, active, color,
           keywords, data_steps, renderers, output_config,
           sort_order, created_by, created_at, updated_at
    FROM   rca_workflows
    ORDER  BY sort_order ASC, created_at ASC`
  return Response.json({ workflows: rows })
}

// -- POST -- create / update / delete / reorder -----------------
export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })

  // All writes are admin-only
  if (session.role !== 'admin') {
    return Response.json({ error: 'Admin access required' }, { status: 403 })
  }

  const sql  = getDb()
  const body = await req.json()
  const { action } = body

  // -- CREATE ----------------------------------------------------
  if (action === 'create') {
    const {
      name, description, problem_type, active, color,
      keywords, data_steps, renderers, output_config, sort_order,
    } = body

    if (!name?.trim())  return Response.json({ error: 'Name is required' },         { status: 400 })
    if (!data_steps?.length) return Response.json({ error: 'Add at least one data step' }, { status: 400 })
    if (!renderers?.length)  return Response.json({ error: 'Select at least one renderer' }, { status: 400 })

    // sort_order defaults to max + 1
    const maxOrder = await sql`SELECT COALESCE(MAX(sort_order), 0) AS m FROM rca_workflows`
    const order = sort_order ?? (Number((maxOrder[0] as { m: string })?.m || 0) + 1)

    const rows = await sql`
      INSERT INTO rca_workflows
        (name, description, problem_type, active, color,
         keywords, data_steps, renderers, output_config,
         sort_order, created_by)
      VALUES
        (${name.trim()},
         ${description ?? ''},
         ${problem_type ?? 'quality_defect'},
         ${active ?? true},
         ${color ?? '#2563eb'},
         ${JSON.stringify(keywords ?? [])},
         ${JSON.stringify(data_steps)},
         ${JSON.stringify(renderers)},
         ${JSON.stringify(output_config ?? { title: 'RCA . {problem} . {machine} . {date}', export: 'word', save_db: true })},
         ${order},
         ${session.id})
      RETURNING id`

    return Response.json({ id: rows[0].id })
  }

  // -- UPDATE ----------------------------------------------------
  if (action === 'update') {
    const {
      id, name, description, problem_type, active, color,
      keywords, data_steps, renderers, output_config, sort_order,
    } = body

    if (!id)           return Response.json({ error: 'ID required' },     { status: 400 })
    if (!name?.trim()) return Response.json({ error: 'Name is required' }, { status: 400 })

    await sql`
      UPDATE rca_workflows SET
        name          = ${name.trim()},
        description   = ${description ?? ''},
        problem_type  = ${problem_type ?? 'quality_defect'},
        active        = ${active ?? true},
        color         = ${color ?? '#2563eb'},
        keywords      = ${JSON.stringify(keywords ?? [])},
        data_steps    = ${JSON.stringify(data_steps ?? [])},
        renderers     = ${JSON.stringify(renderers ?? [])},
        output_config = ${JSON.stringify(output_config ?? {})},
        sort_order    = ${sort_order ?? 0},
        updated_at    = datetime('now')
      WHERE id = ${id}`

    return Response.json({ ok: true })
  }

  // -- DELETE ----------------------------------------------------
  if (action === 'delete') {
    if (!body.id) return Response.json({ error: 'ID required' }, { status: 400 })
    await sql`DELETE FROM rca_workflows WHERE id = ${body.id}`
    return Response.json({ ok: true })
  }

  // -- TOGGLE ACTIVE ---------------------------------------------
  if (action === 'toggle_active') {
    if (!body.id) return Response.json({ error: 'ID required' }, { status: 400 })
    await sql`
      UPDATE rca_workflows
      SET    active = NOT active, updated_at = datetime('now')
      WHERE  id = ${body.id}`
    return Response.json({ ok: true })
  }

  // -- REORDER -- update sort_order for a list of ids -------------
  if (action === 'reorder') {
    // body.order = [{ id, sort_order }, ...]
    const orders = body.order as { id: string; sort_order: number }[]
    if (!Array.isArray(orders)) return Response.json({ error: 'order must be an array' }, { status: 400 })
    for (const item of orders) {
      await sql`UPDATE rca_workflows SET sort_order = ${item.sort_order} WHERE id = ${item.id}`
    }
    return Response.json({ ok: true })
  }

  // -- DUPLICATE -------------------------------------------------
  if (action === 'duplicate') {
    if (!body.id) return Response.json({ error: 'ID required' }, { status: 400 })
    const source = await sql`SELECT * FROM rca_workflows WHERE id = ${body.id}`
    if (!source.length) return Response.json({ error: 'Workflow not found' }, { status: 404 })
    const wf = source[0] as Record<string, unknown>

    const maxOrder = await sql`SELECT COALESCE(MAX(sort_order), 0) AS m FROM rca_workflows`
    const order = Number((maxOrder[0] as { m: string })?.m || 0) + 1

    const rows = await sql`
      INSERT INTO rca_workflows
        (name, description, problem_type, active, color,
         keywords, data_steps, renderers, output_config, sort_order, created_by)
      VALUES
        (${String(wf.name) + ' (copy)'},
         ${wf.description as string},
         ${wf.problem_type as string},
         false,
         ${wf.color as string},
         ${JSON.stringify(wf.keywords)},
         ${JSON.stringify(wf.data_steps)},
         ${JSON.stringify(wf.renderers)},
         ${JSON.stringify(wf.output_config)},
         ${order},
         ${session.id})
      RETURNING id`

    return Response.json({ id: rows[0].id })
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 })
}
