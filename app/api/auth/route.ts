import { signInUser, getSession, COOKIE_NAME } from '@/lib/auth'
import { log, newRequestId } from '@/lib/logger'
import { audit, AUDIT, getActorIp } from '@/lib/audit'
import { cookies } from 'next/headers'
import { getDb } from '@/lib/db'
import { encrypt, decrypt } from '@/lib/encrypt'
export const runtime = 'nodejs'
const OPTS = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, maxAge: 60*60*24*7, path: '/' }

export async function GET() {
  try {
    const sql = getDb()
    const rows = await sql`SELECT provider, client_id, tenant_id, realm, server_url, discovery_url, enabled FROM sso_config`
    return Response.json({ providers: rows })
  } catch { return Response.json({ providers: [] }) }
}

export async function POST(req: Request) {
  const requestId = req.headers.get('x-request-id') || newRequestId()
  const reqLog = log.child({ requestId, service: 'auth' })
  try {
    const body = await req.json()
    const { action } = body

    if (action === 'signin') {
      const { email, password } = body
      if (!email || !password) return Response.json({ error: 'Email and password required' }, { status: 400 })
      const result = await signInUser(email, password)
      if (!result) {
        // Audit failed login — fire and forget
        audit(req, { email }, AUDIT.LOGIN_FAILED, `user:${email}`, 'failure', { reason: 'invalid_credentials' })
        reqLog.warn({ email }, 'Login failed')
        return Response.json({ error: 'Incorrect email or password' }, { status: 401 })
      }
      const store = await cookies()
      store.set(COOKIE_NAME, result.token, OPTS)
      audit(req, { id: result.user.id, email: result.user.email, role: result.user.role }, AUDIT.LOGIN, `user:${result.user.email}`, 'success', { method: 'password' })
      reqLog.info({ email: result.user.email }, 'Login successful')
      return Response.json({ user: result.user })
    }

    if (action === 'signout') {
      const session = await getSession()
      if (session) {
        audit(req, { id: session.id, email: session.email, role: session.role }, AUDIT.LOGOUT, `user:${session.email}`, 'success', null)
      }
      const store = await cookies()
      store.delete(COOKIE_NAME)
      return Response.json({ ok: true })
    }

    if (action === 'saveSsoConfig') {
      const { provider, client_id, client_secret, tenant_id, enabled, realm, server_url, discovery_url } = body
      if (!provider || !client_id) return Response.json({ error: 'provider and client_id are required' }, { status: 400 })
      const isOidc = !['microsoft', 'google'].includes(provider)
      if (isOidc && !discovery_url && !(server_url && realm)) {
        return Response.json({ error: 'Keycloak requires Server URL + Realm, or a Discovery URL' }, { status: 400 })
      }
      const sql = getDb()
      const clientSecretEnc = client_secret ? encrypt(client_secret) : null
      await sql`INSERT INTO sso_config (id, provider, client_id, client_secret, client_secret_enc, tenant_id, enabled, realm, server_url, discovery_url)
        VALUES (${provider}, ${provider}, ${client_id}, '', ${clientSecretEnc}, ${tenant_id || null}, ${enabled ? 1 : 0}, ${realm || null}, ${server_url || null}, ${discovery_url || null})
        ON CONFLICT(id) DO UPDATE SET
          client_id=${client_id},
          client_secret='',
          client_secret_enc=COALESCE(${clientSecretEnc}, client_secret_enc),
          tenant_id=${tenant_id || null},
          enabled=${enabled ? 1 : 0},
          realm=${realm || null},
          server_url=${server_url || null},
          discovery_url=${discovery_url || null}`
      const session = await getSession()
      audit(req, session ? { id: session.id, email: session.email, role: session.role } : null, AUDIT.SETTINGS_UPDATE, `sso_config:${provider}`, 'success', { provider, enabled })
      return Response.json({ ok: true })
    }

    if (action === 'deleteSsoConfig') {
      const { provider } = body
      const sql = getDb()
      await sql`DELETE FROM sso_config WHERE id=${provider}`
      const session = await getSession()
      audit(req, session ? { id: session.id, email: session.email, role: session.role } : null, AUDIT.SETTINGS_UPDATE, `sso_config:${provider}`, 'success', { action: 'delete', provider })
      return Response.json({ ok: true })
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e) { return Response.json({ error: String(e) }, { status: 500 }) }
}
