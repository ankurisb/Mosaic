import { getSession } from '@/lib/auth'
import { NextRequest } from 'next/server'
import { supersetSetting } from '@/lib/superset-auth'

async function getSupersetToken(): Promise<{ token: string; cookie: string } | null> {
  // Resolve settings-first (kv_settings via supersetSetting) then env — a BYO
  // Superset configured in Settings must win over the compose defaults, exactly
  // like the status and guest-token endpoints. Reading process.env directly here
  // meant a BYO admin password was ignored and login failed, leaving the
  // "link to Superset dashboard" dropdown empty.
  const url = await supersetSetting('SUPERSET_URL', process.env.SUPERSET_URL || '')
  const user = await supersetSetting('SUPERSET_ADMIN_USER', process.env.SUPERSET_ADMIN_USER || 'admin')
  const pass = await supersetSetting('SUPERSET_ADMIN_PASSWORD', process.env.SUPERSET_ADMIN_PASSWORD || '')
  if (!url || !user || !pass) return null

  const res = await fetch(`${url}/api/v1/security/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user, password: pass, provider: 'db' }),
  })
  const data = await res.json()
  const token = data.access_token
  if (!token) return null
  const cookie = res.headers.get('set-cookie') || ''
  return { token, cookie }
}

export async function GET(_req: NextRequest) {
  const session = await getSession()
  if (!session || session.role !== 'admin') {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = await supersetSetting('SUPERSET_URL', process.env.SUPERSET_URL || '')
  if (!url) return Response.json({ dashboards: [] })

  const auth = await getSupersetToken()
  if (!auth) return Response.json({ error: 'Superset auth failed' }, { status: 502 })

  const res = await fetch(`${url}/api/v1/dashboard/?q=(page_size:100)`, {
    headers: {
      'Authorization': `Bearer ${auth.token}`,
      'Cookie': auth.cookie,
    },
  })
  const data = await res.json()

  const dashboards = (data.result || []).map((d: Record<string, unknown>) => ({
    id: d.id,
    title: d.dashboard_title,
    url: d.url,
    status: d.status,
  }))

  return Response.json({ dashboards })
}
