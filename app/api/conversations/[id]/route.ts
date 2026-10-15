import { getSession } from '@/lib/auth'
import { getDb, nowExpr } from '@/lib/db'
export const runtime = 'nodejs'

// GET /api/conversations/[id] -- load messages for a conversation
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  const { id } = await params
  const sql = getDb()
  // Verify ownership
  const conv = await sql`SELECT id, title FROM conversations WHERE id = ${id} AND user_id = ${session.id}`
  if (!conv.length) return Response.json({ error: 'Not found' }, { status: 404 })
  const messages = await sql`
    SELECT id, role, content, tool_calls, rca_block, created_at
    FROM messages WHERE conversation_id = ${id}
    ORDER BY created_at ASC`
  return Response.json({ conversation: conv[0], messages })
}

// PATCH /api/conversations/[id] -- update title and/or move to a folder.
// Body may contain { title } and/or { folder_id } (folder_id null = ungroup).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const sql = getDb()

  // Move to / out of a folder. 'folder_id' present (even as null) triggers a move;
  // a non-null target is verified to belong to this user.
  if (Object.prototype.hasOwnProperty.call(body, 'folder_id')) {
    const fid = body.folder_id ? String(body.folder_id) : null
    if (fid) {
      const f = await sql`SELECT id FROM chat_folders WHERE id = ${fid} AND user_id = ${session.id}`
      if (!f.length) return Response.json({ error: 'Folder not found' }, { status: 404 })
    }
    const moved = await sql`
      UPDATE conversations SET folder_id = ${fid}, updated_at = ${nowExpr()}
      WHERE id = ${id} AND user_id = ${session.id}
      RETURNING id, title, folder_id, updated_at`
    if (!moved.length) return Response.json({ error: 'Not found' }, { status: 404 })
    return Response.json({ conversation: moved[0] })
  }

  if (typeof body.title === 'string') {
    const rows = await sql`
      UPDATE conversations SET title = ${body.title.slice(0, 100)}, updated_at = ${nowExpr()}
      WHERE id = ${id} AND user_id = ${session.id}
      RETURNING id, title, folder_id, updated_at`
    if (!rows.length) return Response.json({ error: 'Not found' }, { status: 404 })
    return Response.json({ conversation: rows[0] })
  }

  return Response.json({ error: 'Nothing to update' }, { status: 400 })
}

// DELETE /api/conversations/[id]
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  const { id } = await params
  const sql = getDb()
  await sql`DELETE FROM conversations WHERE id = ${id} AND user_id = ${session.id}`
  return Response.json({ ok: true })
}
