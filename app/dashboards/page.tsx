import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { setupDatabase } from '@/lib/setup'
import DashboardsPage from '@/components/dashboards/DashboardsPage'

export default async function Dashboards() {
  try { await setupDatabase() } catch (e) { console.error('DB setup:', e) }
  const session = await getSession()
  if (!session) redirect('/login')
  return <DashboardsPage user={session} />
}
