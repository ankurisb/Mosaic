/**
 * lib/superset-user-sync.ts
 *
 * Syncs Mosaic users to Superset so the same admin credentials
 * work in both systems. Regular users never log into Superset
 * directly — they access it via embedded guest tokens only.
 *
 * Called from app/api/users/route.ts on create/update.
 * Fire-and-forget — never blocks Mosaic user operations.
 */

const SUPERSET_URL  = process.env.SUPERSET_URL  || 'http://localhost:8088'
const SUPERSET_USER = process.env.SUPERSET_ADMIN_USER     || 'admin'
const SUPERSET_PASS = process.env.SUPERSET_ADMIN_PASSWORD || ''

async function getSupersetToken(): Promise<string | null> {
  try {
    const res = await fetch(`${SUPERSET_URL}/api/v1/security/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: SUPERSET_USER, password: SUPERSET_PASS, provider: 'db', refresh: false }),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.access_token || null
  } catch { return null }
}

async function getCsrfToken(token: string): Promise<string | null> {
  try {
    const res = await fetch(`${SUPERSET_URL}/api/v1/security/csrf_token/`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    return (await res.json()).result || null
  } catch { return null }
}

export async function syncUserToSuperset(params: {
  email: string
  name: string
  password: string
  role: 'admin' | 'user'
}): Promise<void> {
  if (!SUPERSET_PASS) return  // Superset not configured

  try {
    const accessToken = await getSupersetToken()
    if (!accessToken) return

    const csrfToken = await getCsrfToken(accessToken)
    if (!csrfToken) return

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
      'X-CSRFToken': csrfToken,
      'Referer': SUPERSET_URL,
    }

    const firstName = params.name.split(' ')[0] || params.name
    const lastName  = params.name.split(' ').slice(1).join(' ') || 'User'

    // Map Mosaic roles to Superset roles
    // Admin → Admin; regular user → no Superset login (guest token only)
    if (params.role !== 'admin') return

    // Check if user already exists
    const listRes = await fetch(
      `${SUPERSET_URL}/api/v1/security/users/?q=(filters:!((col:email,opr:eq,val:'${params.email}')))`,
      { headers, signal: AbortSignal.timeout(5000) }
    )
    const listData = await listRes.json() as { result?: { id: number }[] }
    const existing = listData.result?.[0]

    // Get Admin role ID
    const rolesRes = await fetch(`${SUPERSET_URL}/api/v1/security/roles/`, { headers, signal: AbortSignal.timeout(5000) })
    const rolesData = await rolesRes.json() as { result?: { id: number; name: string }[] }
    const adminRole = rolesData.result?.find(r => r.name === 'Admin')
    if (!adminRole) return

    const body = {
      first_name: firstName,
      last_name:  lastName,
      email:      params.email,
      username:   params.email,
      password:   params.password,
      active:     true,
      roles:      [adminRole.id],
    }

    if (existing) {
      await fetch(`${SUPERSET_URL}/api/v1/security/users/${existing.id}`, {
        method: 'PUT', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(8000),
      })
      console.log(`[superset-user-sync] Updated admin "${params.email}" in Superset`)
    } else {
      await fetch(`${SUPERSET_URL}/api/v1/security/users/`, {
        method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(8000),
      })
      console.log(`[superset-user-sync] Created admin "${params.email}" in Superset`)
    }
  } catch (e) {
    console.warn('[superset-user-sync] Sync error (non-fatal):', (e as Error).message)
  }
}
