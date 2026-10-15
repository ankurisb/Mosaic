import { getSession } from '@/lib/auth'
import { getDb } from '@/lib/db'
export const runtime = 'nodejs'

// Chat folders — per-user grouping of conversations in the sidebar.
//   GET    -> list the user's folders (id, name, position)
//   POST   { name }            -> create a folder
//   PATCH  { id, name?, position? } -> rename / reorder
//   DELETE { id }              -> delete the folder; its conversations become ungrouped

export async function GET() {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  const sql = getDb()
  const rows = await sql`
    SELECT id, name, position, created_at
    FROM chat_folders WHERE user_id = ${session.id}
    ORDER BY position ASC, created_at ASC`
  return Response.json({ folders: rows })
}

export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  const { name } = await req.json().catch(() => ({}))
  const sql = getDb()
  const maxPos = await sql`SELECT COALESCE(MAX(position), -1) AS m FROM chat_folders WHERE user_id = ${session.id}`
  const pos = Number((maxPos[0] as { m: number })?.m ?? -1) + 1
  const rows = await sql`
    INSERT INTO chat_folders (user_id, name, position)
    VALUES (${session.id}, ${(String(name || 'New folder')).slice(0, 60)}, ${pos})
    RETURNING id, name, position, created_at`
  return Response.json({ folder: rows[0] })
}

export async function PATCH(req: Request) {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  const { id, name, position } = await req.json().catch(() => ({}))
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })
  const sql = getDb()
  if (typeof name === 'string') {
    await sql`UPDATE chat_folders SET name = ${name.slice(0, 60)} WHERE id = ${id} AND user_id = ${session.id}`
  }
  if (Number.isInteger(position)) {
    await sql`UPDATE chat_folders SET position = ${position} WHERE id = ${id} AND user_id = ${session.id}`
  }
  const rows = await sql`SELECT id, name, position FROM chat_folders WHERE id = ${id} AND user_id = ${session.id}`
  if (!rows.length) return Response.json({ error: 'Not found' }, { status: 404 })
  return Response.json({ folder: rows[0] })
}

export async function DELETE(req: Request) {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  const { id } = await req.json().catch(() => ({}))
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })
  const sql = getDb()
  // Ungroup this folder's conversations first, then remove the folder.
  await sql`UPDATE conversations SET folder_id = NULL WHERE folder_id = ${id} AND user_id = ${session.id}`
  await sql`DELETE FROM chat_folders WHERE id = ${id} AND user_id = ${session.id}`
  return Response.json({ ok: true })
}
