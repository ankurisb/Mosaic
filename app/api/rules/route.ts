import { getSession } from '@/lib/auth'
import { getDb }      from '@/lib/db'
export const runtime = 'nodejs'

export async function GET() {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  const sql = getDb()
  const rows = await sql`SELECT * FROM rule_groups ORDER BY updated_at DESC`
  return Response.json({ groups: rows })
}

export async function POST(req: Request) {
  const session = await getSession()
  if (!session || session.role !== 'admin')
    return Response.json({ error: 'Admin only' }, { status: 403 })

  const sql  = getDb()
  const body = await req.json()
  const { action } = body

  if (action === 'create') {
    const { name, description, active, logic, trigger, conditions, controls, actions, recipients, message_template } = body
    if (!name?.trim()) return Response.json({ error: 'Name required' }, { status: 400 })
    const rows = await sql`
      INSERT INTO rule_groups (name, description, active, logic, trigger, conditions, controls, actions, recipients, message_template, created_by)
      VALUES (${name.trim()}, ${description ?? ''}, ${active ?? true}, ${logic ?? 'OR'},
              ${JSON.stringify(trigger ?? {})}, ${JSON.stringify(conditions ?? [])},
              ${JSON.stringify(controls ?? {})}, ${JSON.stringify(actions ?? [])},
              ${JSON.stringify(recipients ?? [])}, ${message_template ?? ''},
              ${session.id})
      RETURNING id`
    return Response.json({ id: rows[0].id })
  }

  if (action === 'update') {
    const { id, name, description, active, logic, trigger, conditions, controls, actions, recipients, message_template } = body
    if (!id) return Response.json({ error: 'ID required' }, { status: 400 })
    await sql`
      UPDATE rule_groups SET
        name             = ${name?.trim() ?? ''},
        description      = ${description ?? ''},
        active           = ${active ?? true},
        logic            = ${logic ?? 'OR'},
        trigger          = ${JSON.stringify(trigger ?? {})},
        conditions       = ${JSON.stringify(conditions ?? [])},
        controls         = ${JSON.stringify(controls ?? {})},
        actions          = ${JSON.stringify(actions ?? [])},
        recipients       = ${JSON.stringify(recipients ?? [])},
        message_template = ${message_template ?? ''},
        updated_at       = datetime('now')
      WHERE id = ${id}`
    return Response.json({ ok: true })
  }

  if (action === 'toggle') {
    if (!body.id) return Response.json({ error: 'ID required' }, { status: 400 })
    await sql`UPDATE rule_groups SET active = NOT active, updated_at = datetime('now') WHERE id = ${body.id}`
    return Response.json({ ok: true })
  }

  if (action === 'delete') {
    if (!body.id) return Response.json({ error: 'ID required' }, { status: 400 })
    await sql`DELETE FROM rule_groups WHERE id = ${body.id}`
    return Response.json({ ok: true })
  }

  if (action === 'log_fire') {
    // Called by the scheduler after a group fires
    const { id } = body
    await sql`
      UPDATE rule_groups
      SET last_fired_at = datetime('now'),
          fire_count_today = fire_count_today + 1,
          updated_at = datetime('now')
      WHERE id = ${id}`
    return Response.json({ ok: true })
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 })
}
