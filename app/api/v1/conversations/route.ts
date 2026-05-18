import { validateDevApiKey, logDevApiUsage } from '@/lib/dev-api-auth'
import { getDb } from '@/lib/db'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const start = Date.now()
  const auth = await validateDevApiKey(req, ['read'])
  if (!auth.ok) return auth.response

  const url = new URL(req.url)
  const limit  = Math.min(parseInt(url.searchParams.get('limit')  || '50'), 200)
  const offset = parseInt(url.searchParams.get('offset') || '0')
  const userId = url.searchParams.get('user_id') || null

  const sql = getDb()
  const conversations = userId
    ? await sql`
        SELECT c.id, c.title, c.created_at, c.updated_at,
               u.email as user_email, u.name as user_name,
               COUNT(m.id) as message_count
        FROM conversations c
        JOIN users u ON u.id = c.user_id
        LEFT JOIN messages m ON m.conversation_id = c.id
        WHERE c.user_id = ${userId}
        GROUP BY c.id
        ORDER BY c.updated_at DESC
        LIMIT ${limit} OFFSET ${offset}`
    : await sql`
        SELECT c.id, c.title, c.created_at, c.updated_at,
               u.email as user_email, u.name as user_name,
               COUNT(m.id) as message_count
        FROM conversations c
        JOIN users u ON u.id = c.user_id
        LEFT JOIN messages m ON m.conversation_id = c.id
        GROUP BY c.id
        ORDER BY c.updated_at DESC
        LIMIT ${limit} OFFSET ${offset}`

  await logDevApiUsage(auth.keyId, '/api/v1/conversations', 'GET', 200, Date.now() - start)
  return Response.json({ conversations, limit, offset, total: conversations.length })
}
