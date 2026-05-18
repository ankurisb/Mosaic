import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { setupDatabase } from '@/lib/setup'
import ReportsPage from '@/components/reports/ReportsPage'

export const dynamic = 'force-dynamic'

export default async function Page() {
  await setupDatabase()
  const session = await getSession()
  if (!session) redirect('/login')
  return <ReportsPage user={session} />
}
