import { redirect }     from 'next/navigation'
import { getSession }   from '@/lib/auth'
import { setupDatabase } from '@/lib/setup'
import RulesPage        from '@/components/rules/RulesPage'

export default async function Rules() {
  try { await setupDatabase() } catch (e) { console.error('DB setup:', e) }
  const session = await getSession()
  if (!session) redirect('/login')
  return <RulesPage user={session} />
}
