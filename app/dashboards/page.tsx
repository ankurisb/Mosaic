import { redirect } from 'next/navigation'
import { log } from '@/lib/logger'
import { getSession } from '@/lib/auth'
import { setupDatabase } from '@/lib/setup'
import DashboardsPage from '@/components/dashboards/DashboardsPage'

export const dynamic = 'force-dynamic'

export default async function Dashboards() {
  try { await setupDatabase() } catch (e) { log.error({ service: 'dashboards_page', err: e }, 'DB setup error') }
  const session = await getSession()
  if (!session) redirect('/login')
  return <DashboardsPage user={session} />
}
