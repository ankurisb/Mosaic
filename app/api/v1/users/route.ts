import { validateDevApiKey, logDevApiUsage } from '@/lib/dev-api-auth'
import { getDb } from '@/lib/db'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const start = Date.now()
  const auth = await validateDevApiKey(req, ['read'])
  if (!auth.ok) return auth.response

  const sql = getDb()
  const users = await sql`
    SELECT id, email, name, role, created_at, last_login_at
    FROM users
    WHERE banned = 0
    ORDER BY created_at ASC`

  await logDevApiUsage(auth.keyId, '/api/v1/users', 'GET', 200, Date.now() - start)
  return Response.json({ users, total: users.length })
}
