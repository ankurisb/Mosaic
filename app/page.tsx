import { redirect } from 'next/navigation'
import { log } from '@/lib/logger'
import { getSession } from '@/lib/auth'
import { setupDatabase } from '@/lib/setup'
import { getDb, getDbDriver } from '@/lib/db'
import ChatPage from '@/components/ChatPage'

export const dynamic = 'force-dynamic'

export default async function Home() {
  // Run migrations first (SQLite only — Postgres uses setup-pg.ts)
  if (getDbDriver() === 'sqlite') {
    try {
      const Database = (await import('better-sqlite3')).default
      const dbUrl = (process.env.DATABASE_URL || '').replace(/^sqlite:\/\//, '').replace(/^sqlite:/, '')
      if (dbUrl) {
        const rawDb = new Database(dbUrl)
        const { runMigrations } = await import('@/lib/migrate')
        await runMigrations(rawDb)
        rawDb.close()
      }
    } catch (e) { log.error({ service: 'app-pagex', err: e }, '[migrations] Failed:') }
  }

  try { await setupDatabase() } catch (e) { log.error({ service: 'app-pagex', err: e }, 'DB setup:') }

  // First-run detection: no users and setup not complete → setup wizard
  try {
    const sql = getDb()
    const [userCount, setupFlag] = await Promise.all([
      sql`SELECT COUNT(*) as cnt FROM users`,
      sql`SELECT value_enc FROM kv_settings WHERE key = 'SETUP_COMPLETE' LIMIT 1`.catch(() => []),
    ])
    const count = Number((userCount[0] as { cnt: string })?.cnt || 0)
    const complete = (setupFlag as { value_enc: string }[]).length > 0
    if (count === 0 && !complete) redirect('/setup')
  } catch { /* if DB not ready yet, fall through to login */ }

  const session = await getSession()
  if (!session) redirect('/login')
  return <ChatPage user={session} />
}
