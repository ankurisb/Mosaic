import { getSession } from '@/lib/auth'
import { NextRequest } from 'next/server'

export async function GET(_req: NextRequest) {
  const session = await getSession()
  if (!session) {
    return Response.json({ error: 'Not signed in' }, { status: 401 })
  }

  const supersetUrl = process.env.SUPERSET_URL
  if (!supersetUrl) {
    return Response.json({ configured: false })
  }

  let reachable = false
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2000)
    const res = await fetch(`${supersetUrl}/health`, {
      signal: controller.signal,
      cache: 'no-store',
    })
    clearTimeout(timeout)
    reachable = res.ok
  } catch {
    reachable = false
  }

  return Response.json({
    configured: true,
    url: supersetUrl,
    reachable,
    role: session.role,
  })
}
