import { redirect } from 'next/navigation'
import { log } from '@/lib/logger'
import { getSession } from '@/lib/auth'
import { setupDatabase } from '@/lib/setup'
import AssetExplorer from '@/components/assets/AssetExplorer'

export const dynamic = 'force-dynamic'

export default async function Assets() {
  try { await setupDatabase() } catch (e) { log.error({ service: 'assets_page', err: e }, 'DB setup error') }
  const session = await getSession()
  if (!session) redirect('/login')
  return <AssetExplorer user={session} />
}
