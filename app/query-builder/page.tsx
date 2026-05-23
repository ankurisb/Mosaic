import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import QueryBuilderPage from '@/components/QueryBuilderPage'

export const dynamic = 'force-dynamic'

export default async function QueryBuilder() {
  const session = await getSession()
  if (!session) redirect('/login')
  return <QueryBuilderPage user={session} />
}
