import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import SettingsPage from '@/components/settings/SettingsPage'

export const dynamic = 'force-dynamic'

export default async function Settings() {
  const session = await getSession()
  if (!session) redirect('/login')
  return <SettingsPage user={session} />
}
