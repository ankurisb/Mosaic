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

// PATCH /api/conversations/[id] -- update title
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  const { id } = await params
  const { title } = await req.json()
  const sql = getDb()
  const rows = await sql`
    UPDATE conversations SET title = ${title.slice(0, 100)}, updated_at = ${nowExpr()}
    WHERE id = ${id} AND user_id = ${session.id}
    RETURNING id, title, updated_at`
  if (!rows.length) return Response.json({ error: 'Not found' }, { status: 404 })
  return Response.json({ conversation: rows[0] })
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
