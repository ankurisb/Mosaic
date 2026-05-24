import { getSession } from '@/lib/auth'
import { audit, AUDIT } from '@/lib/audit'
import { getActorIp } from '@/lib/audit'

export const dynamic = 'force-dynamic'

const TUNNEL_URL = process.env.TUNNEL_MANAGER_URL || 'http://mosaic-tunnel:3100'

async function tunnelFetch(path: string, method = 'GET') {
  const r = await fetch(`${TUNNEL_URL}${path}`, {
    method,
    signal: AbortSignal.timeout(35_000),
  })
  return r.json()
}

// GET — return current session state
export async function GET(req: Request) {
  const session = await getSession()
  if (!session || session.role !== 'admin') {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }
  try {
    const status = await tunnelFetch('/status')
    return Response.json(status)
  } catch {
    return Response.json({ running: false, url: null, error: 'Tunnel service unavailable' })
  }
}

// POST — start or stop session
export async function POST(req: Request) {
  const session = await getSession()
  if (!session || session.role !== 'admin') {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { action } = await req.json()
  const actor = { email: session.email ?? 'unknown', role: session.role }
  const ip = getActorIp(req)

  if (action === 'start') {
    try {
      const result = await tunnelFetch('/start', 'POST')
      if (result.ok) {
        await audit(req, actor, AUDIT.SUPPORT_SESSION_START, 'support:session', 'success', {
          sessionId: result.sessionId,
          url: result.url,
          expiresAt: result.expiresAt,
          ip,
        })
      }
      return Response.json(result)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      return Response.json({ ok: false, error: msg }, { status: 500 })
    }
  }

  if (action === 'stop') {
    // Get sessionId before stopping for audit log
    let sessionId = null
    try {
      const status = await tunnelFetch('/status')
      sessionId = status.sessionId
    } catch {}

    try {
      await tunnelFetch('/stop', 'POST')
      await audit(req, actor, AUDIT.SUPPORT_SESSION_END, 'support:session', 'success', {
        sessionId,
        stoppedBy: actor.email,
        ip,
      })
      return Response.json({ ok: true })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      return Response.json({ ok: false, error: msg }, { status: 500 })
    }
  }

  return Response.json({ error: 'Invalid action' }, { status: 400 })
}
