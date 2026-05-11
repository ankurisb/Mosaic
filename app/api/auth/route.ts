import { signInUser, COOKIE_NAME } from '@/lib/auth'
import { cookies } from 'next/headers'
import { getDb } from '@/lib/db'
export const runtime = 'nodejs'
const OPTS = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, maxAge: 60*60*24*7, path: '/' }

export async function GET() {
  try {
    const sql = getDb()
    const rows = await sql`SELECT provider, client_id, tenant_id, enabled FROM sso_config`
    return Response.json({ providers: rows })
  } catch { return Response.json({ providers: [] }) }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { action } = body

    if (action === 'signin') {
      const { email, password } = body
      if (!email || !password) return Response.json({ error: 'Email and password required' }, { status: 400 })
      const result = await signInUser(email, password)
      if (!result) return Response.json({ error: 'Incorrect email or password' }, { status: 401 })
      const store = await cookies()
      store.set(COOKIE_NAME, result.token, OPTS)
      return Response.json({ user: result.user })
    }

    if (action === 'signout') {
      const store = await cookies()
      store.delete(COOKIE_NAME)
      return Response.json({ ok: true })
    }

    if (action === 'saveSsoConfig') {
      const { provider, client_id, client_secret, tenant_id, enabled } = body
      if (!provider || !client_id || !client_secret) return Response.json({ error: 'provider, client_id and client_secret are required' }, { status: 400 })
      const sql = getDb()
      await sql`INSERT INTO sso_config (id, provider, client_id, client_secret, tenant_id, enabled)
        VALUES (${provider}, ${provider}, ${client_id}, ${client_secret}, ${tenant_id || null}, ${enabled ? 1 : 0})
        ON CONFLICT(id) DO UPDATE SET client_id=${client_id}, client_secret=${client_secret}, tenant_id=${tenant_id || null}, enabled=${enabled ? 1 : 0}`
      return Response.json({ ok: true })
    }

    if (action === 'deleteSsoConfig') {
      const { provider } = body
      const sql = getDb()
      await sql`DELETE FROM sso_config WHERE id=${provider}`
      return Response.json({ ok: true })
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e) { return Response.json({ error: String(e) }, { status: 500 }) }
}
