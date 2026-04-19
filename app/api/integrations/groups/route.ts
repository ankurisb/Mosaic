// -- /api/integrations/groups ----------------------------------
// CRUD for notification recipient groups.
// Groups are stored in the notification_groups table.

import { getSession } from '@/lib/auth'
import { getDb }      from '@/lib/db'
export const runtime = 'nodejs'

export async function GET() {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  const sql = getDb()
  const rows = await sql`SELECT * FROM notification_groups ORDER BY created_at ASC`
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
    const { name, description, members } = body
    if (!name?.trim()) return Response.json({ error: 'Name required' }, { status: 400 })
    const rows = await sql`
      INSERT INTO notification_groups (name, description, members, created_by)
      VALUES (${name.trim()}, ${description ?? ''}, ${JSON.stringify(members ?? [])}, ${session.id})
      RETURNING id`
    return Response.json({ id: rows[0].id })
  }

  if (action === 'update') {
    const { id, name, description, members } = body
    if (!id) return Response.json({ error: 'ID required' }, { status: 400 })
    await sql`
      UPDATE notification_groups
      SET name = ${name?.trim() ?? ''}, description = ${description ?? ''},
          members = ${JSON.stringify(members ?? [])}
      WHERE id = ${id}`
    return Response.json({ ok: true })
  }

  if (action === 'delete') {
    if (!body.id) return Response.json({ error: 'ID required' }, { status: 400 })
    await sql`DELETE FROM notification_groups WHERE id = ${body.id}`
    return Response.json({ ok: true })
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 })
}
