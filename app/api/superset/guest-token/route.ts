import { getSession } from '@/lib/auth'
import { canAccessSurface } from '@/lib/permissions'
import { log } from '@/lib/logger'
import { getDb } from '@/lib/db'
import { NextRequest } from 'next/server'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  if (!(await canAccessSurface({ id: session.id, role: session.role }, 'superset')))
    return Response.json({ error: 'No access to analytics' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const mosaicDashboardId = searchParams.get('dashboard_id')
  if (!mosaicDashboardId) return Response.json({ error: 'Missing dashboard_id' }, { status: 400 })

  const sql = getDb()
  const rows = await sql`SELECT superset_embed_uuid FROM dashboards WHERE id = ${mosaicDashboardId}`
  const embedUuid = rows[0]?.superset_embed_uuid
  if (!embedUuid) return Response.json({ error: 'No Superset dashboard linked' }, { status: 404 })

  const url = process.env.SUPERSET_URL || 'http://localhost:8088'
  const user = process.env.SUPERSET_ADMIN_USER || 'admin'
  const pass = process.env.SUPERSET_ADMIN_PASSWORD || ''

  const loginRes = await fetch(`${url}/api/v1/security/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user, password: pass, provider: 'db', refresh: false }),
    signal: AbortSignal.timeout(5000),
  })
  if (!loginRes.ok) return Response.json({ error: 'Superset auth failed' }, { status: 502 })
  const token = (await loginRes.json()).access_token
  if (!token) return Response.json({ error: 'Superset auth failed' }, { status: 502 })

  const csrfRes = await fetch(`${url}/api/v1/security/csrf_token/`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5000),
  })
  if (!csrfRes.ok) return Response.json({ error: 'CSRF failed' }, { status: 502 })
  const csrf = (await csrfRes.json()).result
  if (!csrf) return Response.json({ error: 'CSRF failed' }, { status: 502 })

  const setCookies = csrfRes.headers.getSetCookie?.() || []
  const sessionCookie = setCookies
    .map((c: string) => c.split(';')[0])
    .find((c: string) => c.startsWith('session=')) || null

  const nameParts = (session.name || 'Guest User').split(' ')
  const guestRes = await fetch(`${url}/api/v1/security/guest_token/`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-CSRFToken': csrf,
      'Content-Type': 'application/json',
      'Referer': url,
      ...(sessionCookie ? { 'Cookie': sessionCookie } : {}),
    },
    body: JSON.stringify({
      resources: [{ type: 'dashboard', id: embedUuid }],
      rls: [],
      user: {
        username: session.email,
        first_name: nameParts[0] || 'Guest',
        last_name: nameParts[1] || 'User',
      },
    }),
    signal: AbortSignal.timeout(10000),
  })
  const guestData = await guestRes.json()
  log.info({ service: 'superset-guest-token' }, 'Guest token response received')
  const guestToken = guestData.token
  if (!guestToken) return Response.json({ error: 'Guest token failed', detail: guestData }, { status: 502 })

  return Response.json({ token: guestToken, embed_uuid: embedUuid, superset_url: url })
}
