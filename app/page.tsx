import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { setupDatabase } from '@/lib/setup'
import { getDb } from '@/lib/db'
import ChatPage from '@/components/ChatPage'

export const dynamic = 'force-dynamic'

export default async function Home() {
  try { await setupDatabase() } catch (e) { console.error('DB setup:', e) }

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
