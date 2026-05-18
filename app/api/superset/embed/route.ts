import { getSession } from '@/lib/auth'
import { log } from '@/lib/logger'
import { getDb } from '@/lib/db'
import { NextRequest } from 'next/server'
export const runtime = 'nodejs'

async function getSupersetAuth() {
  const url = process.env.SUPERSET_URL || 'http://localhost:8088'
  const user = process.env.SUPERSET_ADMIN_USER || 'admin'
  const pass = process.env.SUPERSET_ADMIN_PASSWORD || ''

  const loginRes = await fetch(`${url}/api/v1/security/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user, password: pass, provider: 'db', refresh: false }),
    signal: AbortSignal.timeout(5000),
  })
  if (!loginRes.ok) return null
  const token = (await loginRes.json()).access_token
  if (!token) return null

  const csrfRes = await fetch(`${url}/api/v1/security/csrf_token/`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5000),
  })
  if (!csrfRes.ok) return null
  const csrf = (await csrfRes.json()).result
  if (!csrf) return null

  const setCookies = csrfRes.headers.getSetCookie?.() || []
  const sessionCookie = setCookies
    .map((c: string) => c.split(';')[0])
    .find((c: string) => c.startsWith('session=')) || null

  return { url, token, csrf, sessionCookie }
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || session.role !== 'admin') {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { mosaic_dashboard_id, superset_dashboard_id } = await req.json()
  if (!mosaic_dashboard_id || !superset_dashboard_id) {
    return Response.json({ error: 'Missing fields' }, { status: 400 })
  }

  const auth = await getSupersetAuth()
  if (!auth) return Response.json({ error: 'Superset auth failed' }, { status: 502 })

  const embedRes = await fetch(`${auth.url}/api/v1/dashboard/${superset_dashboard_id}/embedded`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${auth.token}`,
      'X-CSRFToken': auth.csrf,
      'Content-Type': 'application/json',
      'Referer': auth.url,
      ...(auth.sessionCookie ? { 'Cookie': auth.sessionCookie } : {}),
    },
    body: JSON.stringify({ allowed_domains: [] }),
    signal: AbortSignal.timeout(10000),
  })
  const embedData = await embedRes.json()
  log.info({ service: 'superset-embed' }, 'Embed response received')
  const embedUuid = embedData.result?.uuid
  if (!embedUuid) {
    return Response.json({ error: 'Failed to enable embedding', detail: embedData }, { status: 502 })
  }

  const sql = getDb()
  await sql`UPDATE dashboards SET superset_embed_uuid = ${embedUuid} WHERE id = ${mosaic_dashboard_id}`
  return Response.json({ ok: true, embed_uuid: embedUuid })
}

export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session || session.role !== 'admin') {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { mosaic_dashboard_id } = await req.json()
  const sql = getDb()
  await sql`UPDATE dashboards SET superset_embed_uuid = NULL WHERE id = ${mosaic_dashboard_id}`
  return Response.json({ ok: true })
}
