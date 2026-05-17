import { NextRequest } from 'next/server'

export async function GET(_req: NextRequest) {
  const statsUrl = process.env.STATS_SIDECAR_URL || 'http://localhost:8001'
  try {
    const res = await fetch(`${statsUrl}/health`, { signal: AbortSignal.timeout(3000) })
    const data = await res.json()
    return Response.json({ ok: res.ok && data.ok, url: statsUrl })
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message })
  }
}
