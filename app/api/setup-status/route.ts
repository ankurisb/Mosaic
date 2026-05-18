import { getSession } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getKey } from '@/lib/keys'
export const runtime = 'nodejs'

export interface SetupStatus {
  anthropicKey:    { done: boolean }
  dataSource:      { done: boolean; count: number }
  users:           { done: boolean; count: number }
  notifications:   { done: boolean }
  allCriticalDone: boolean
  allDone:         boolean
}

export async function GET() {
  const session = await getSession()
  if (!session || session.role !== 'admin')
    return Response.json({ error: 'Admin only' }, { status: 403 })

  const sql = getDb()

  const [apiKey, dbConns, apiConns, userRows, notifRows] = await Promise.all([
    getKey('ANTHROPIC_API_KEY'),
    sql`SELECT COUNT(*) as cnt FROM db_connections`.catch(() => [{ cnt: 0 }]),
    sql`SELECT COUNT(*) as cnt FROM api_connections`.catch(() => [{ cnt: 0 }]),
    sql`SELECT COUNT(*) as cnt FROM users WHERE role = 'user'`.catch(() => [{ cnt: 0 }]),
    sql`SELECT COUNT(*) as cnt FROM integration_channels WHERE active = 1`.catch(() => [{ cnt: 0 }]),
  ])

  const dbCount    = Number((dbConns[0]  as { cnt: number })?.cnt || 0)
  const apiCount   = Number((apiConns[0] as { cnt: number })?.cnt || 0)
  const userCount  = Number((userRows[0] as { cnt: number })?.cnt || 0)
  const notifCount = Number((notifRows[0] as { cnt: number })?.cnt || 0)

  const status: SetupStatus = {
    anthropicKey:    { done: !!apiKey },
    dataSource:      { done: dbCount + apiCount > 0, count: dbCount + apiCount },
    users:           { done: userCount > 0, count: userCount },
    notifications:   { done: notifCount > 0 },
    allCriticalDone: !!apiKey && (dbCount + apiCount > 0),
    allDone:         !!apiKey && (dbCount + apiCount > 0) && userCount > 0 && notifCount > 0,
  }

  return Response.json(status)
}
