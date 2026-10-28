import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { setupDatabase } from '@/lib/setup'
import AgentsPage from '@/components/agents/AgentsPage'

export const dynamic = 'force-dynamic'

export default async function Page() {
  await setupDatabase()
  const session = await getSession()
  if (!session) redirect('/login')
  return <AgentsPage user={session} />
}
