import { getSession } from '@/lib/auth'
import { getDb } from '@/lib/db'
export const runtime = 'nodejs'

export async function GET() {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  const sql = getDb()
  const rows = await sql`
    SELECT c.id, c.title, c.created_at, c.updated_at,
           COUNT(m.id) AS message_count
    FROM conversations c
    LEFT JOIN messages m ON m.conversation_id = c.id
    WHERE c.user_id = ${session.id}
    GROUP BY c.id
    ORDER BY c.updated_at DESC
    LIMIT 100`
  return Response.json({ conversations: rows })
}

export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  const { title } = await req.json()
  const sql = getDb()
  const rows = await sql`
    INSERT INTO conversations (user_id, title)
    VALUES (${session.id}, ${(title || 'New conversation').slice(0, 100)})
    RETURNING id, title, created_at, updated_at`
  return Response.json({ conversation: rows[0] })
}
