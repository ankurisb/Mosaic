import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import DashboardView from '@/components/dashboards/DashboardView'

export default async function DashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) redirect('/login')
  const { id } = await params
  return <DashboardView id={id} user={session} />
}
