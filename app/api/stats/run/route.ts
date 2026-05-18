import { getSession } from '@/lib/auth'
export const runtime = 'nodejs'

export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  const body = await req.json()
  const statsUrl = process.env.STATS_SIDECAR_URL || 'http://localhost:8001'
  try {
    const res = await fetch(`${statsUrl}/analyse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    })
    const data = await res.json()
    return Response.json(data)
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 503 })
  }
}
