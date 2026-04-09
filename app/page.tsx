import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { setupDatabase } from '@/lib/setup'
import ChatPage from '@/components/ChatPage'

export default async function Home() {
  try { await setupDatabase() } catch (e) { console.error('DB setup:', e) }
  const session = await getSession()
  if (!session) redirect('/login')
  return <ChatPage user={session} />
}
