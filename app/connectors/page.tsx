import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import ConnectorsPage from '@/components/ConnectorsPage'

export const dynamic = 'force-dynamic'

export default async function Connectors() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role !== 'admin') redirect('/')
  return <ConnectorsPage user={session} />
}
