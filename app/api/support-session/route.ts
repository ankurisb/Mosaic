import { getSession } from '@/lib/auth'
import { audit, AUDIT } from '@/lib/audit'
import { getActorIp } from '@/lib/audit'
import { getDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

const TUNNEL_URL = process.env.TUNNEL_MANAGER_URL || 'http://mosaic-tunnel:3100'

async function tunnelFetch(path: string, method = 'GET') {
  const r = await fetch(`${TUNNEL_URL}${path}`, {
    method,
    signal: AbortSignal.timeout(35_000),
  })
  return r.json()
}

/**
 * Close the audit record for a session that ended without the app being told —
 * the 4-hour timer firing, cloudflared exiting, or the tunnel container being
 * restarted. Without this a session is recorded as started and never ended, so
 * an auditor can't tell when remote access actually ceased.
 *
 * Finds the most recent SUPPORT_SESSION_START with no matching END and closes
 * it. The END timestamp is when we DETECTED the session was gone, not when it
 * actually stopped — recorded honestly in the detail.
 */
async function reconcileOrphanSession(req: Request, actor: { email: string; role: string }) {
  try {
    const sql = getDb()
    const rows = await sql`
      SELECT action, detail FROM audit_events
      WHERE action IN ('SUPPORT_SESSION_START', 'SUPPORT_SESSION_END')
      ORDER BY timestamp DESC LIMIT 50`

    const ended = new Set<string>()
    let orphan: string | null = null
    for (const row of rows as { action: string; detail: unknown }[]) {
      // The SQLite driver auto-parses JSON columns, so detail may already be an
      // object; handle both that and the raw-string case.
      let d: { sessionId?: string } = {}
      const raw = row.detail
      if (raw && typeof raw === 'object') d = raw as { sessionId?: string }
      else if (typeof raw === 'string') { try { d = JSON.parse(raw) } catch { /* skip */ } }
      const id = d.sessionId
      if (!id) continue
      if (row.action === 'SUPPORT_SESSION_END') ended.add(id)
      else if (!ended.has(id)) { orphan = id; break }  // newest unclosed START
    }

    if (orphan) {
      await audit(req, actor, AUDIT.SUPPORT_SESSION_END, 'support:session', 'success', {
        sessionId: orphan,
        reason: 'reconciled — tunnel no longer running (expired, exited, or service restarted)',
        detectedAt: new Date().toISOString(),
      })
    }
  } catch { /* reconciliation must never break the status endpoint */ }
}

// GET — return current session state
export async function GET(req: Request) {
  const session = await getSession()
  if (!session || session.role !== 'admin') {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }
  const actor = { email: session.email ?? 'unknown', role: session.role }
  try {
    const status = await tunnelFetch('/status')
    // If nothing is running, close out any session still recorded as open.
    if (!status.running) await reconcileOrphanSession(req, actor)
    return Response.json(status)
  } catch {
    // Tunnel service unreachable means no session can be running, so any
    // recorded-open session is dead and should be closed too.
    await reconcileOrphanSession(req, actor)
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
      // Only audit a genuinely NEW session. The manager returns alreadyRunning
      // when it hands back an existing one; auditing that would inflate the
      // count of times remote access was opened.
      if (result.ok && !result.alreadyRunning) {
        await audit(req, actor, AUDIT.SUPPORT_SESSION_START, 'support:session', 'success', {
          sessionId: result.sessionId,
          url: result.url,
          expiresAt: result.expiresAt,
          ip,
        })
      }
      return Response.json(result)
    } catch {
      // Raw fetch errors ("fetch failed") are meaningless in the UI — match the
      // clear message the status endpoint already returns.
      return Response.json(
        { ok: false, error: 'Tunnel service unavailable — the mosaic-tunnel container may not be running.' },
        { status: 503 },
      )
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
    } catch {
      return Response.json(
        { ok: false, error: 'Tunnel service unavailable — the mosaic-tunnel container may not be running.' },
        { status: 503 },
      )
    }
  }

  return Response.json({ error: 'Invalid action' }, { status: 400 })
}
