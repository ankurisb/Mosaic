import { getSession } from '@/lib/auth'
import { NextRequest } from 'next/server'
import { supersetSetting } from '@/lib/superset-auth'

export async function GET(_req: NextRequest) {
  const session = await getSession()
  if (!session) {
    return Response.json({ error: 'Not signed in' }, { status: 401 })
  }

  // Two different URLs, deliberately:
  //  - SUPERSET_URL        internal Docker network address (http://superset:8088).
  //                        Server-side only — used for the health check below.
  //  - SUPERSET_PUBLIC_URL browser-facing origin behind Caddy (…:8445). This is
  //                        what we hand back to the client for links and embeds;
  //                        a browser cannot resolve the internal Docker hostname.
  // Both resolve settings-first (kv_settings via supersetSetting) then env, so a
  // customer can point Mosaic at their OWN Superset from Settings → Keys ("bring
  // your own") without redeploying. Configured = a non-empty SUPERSET_URL exists
  // in either place.
  const supersetUrl = await supersetSetting('SUPERSET_URL', process.env.SUPERSET_URL || '')
  if (!supersetUrl) {
    return Response.json({ configured: false })
  }
  const publicUrl = await supersetSetting('SUPERSET_PUBLIC_URL', process.env.SUPERSET_PUBLIC_URL || 'https://localhost:8445/')

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
    url: publicUrl,
    reachable,
    role: session.role,
  })
}
