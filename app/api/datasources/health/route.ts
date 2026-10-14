import { getSession } from '@/lib/auth'
import { checkDataSources } from '@/lib/tools'

export const runtime = 'nodejs'
export const maxDuration = 60

// Run the same bounded, de-duplicated health check the chat tool uses, for the
// Settings → Data sources "Check all" button. One probe per source (one login
// per service), so it never stampedes shared auth endpoints.
export async function GET() {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  try {
    const result = await checkDataSources({})
    return Response.json(result)
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Health check failed' }, { status: 500 })
  }
}
