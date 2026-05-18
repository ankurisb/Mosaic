import { redirect }     from 'next/navigation'
import { log } from '@/lib/logger'
import { getSession }   from '@/lib/auth'
import { setupDatabase } from '@/lib/setup'
import RulesPage        from '@/components/rules/RulesPage'

export const dynamic = 'force-dynamic'

export default async function Rules() {
  try { await setupDatabase() } catch (e) { log.error({ service: 'rules_page', err: e }, 'DB setup error') }
  const session = await getSession()
  if (!session) redirect('/login')
  return <RulesPage user={session} />
}
