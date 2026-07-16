import { getSession } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { decrypt } from '@/lib/encrypt'
import { getPrismToken, invalidatePrismToken } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

// POST — test a Prism connection (login + fetch device count)
// Accepts either { base_url, username, password } for new instances,
// or { instance_id } to re-test an existing one using stored credentials.
export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { base_url, username, password, instance_id } = body

  let testBase = base_url?.trim().replace(/\/$/, '')
  let testUser = username?.trim()
  let testPass = password

  // If testing an existing instance, load stored credentials
  if (instance_id && (!testBase || !testUser || !testPass)) {
    const sql = getDb()
    const rows = await sql`SELECT * FROM prism_instances WHERE id = ${instance_id} AND active = true`
    if (!rows.length) return Response.json({ ok: false, message: 'Instance not found' })
    const inst = rows[0] as Record<string, unknown>
    testBase = testBase || (inst.base_url as string).replace(/\/$/, '')
    testUser = testUser || (inst.username as string)
    if (!testPass && inst.password_enc) {
      try { testPass = decrypt(inst.password_enc as string) } catch { testPass = '' }
    }
    // Evict cached token so test always does a fresh login
    invalidatePrismToken(instance_id)
  }

  if (!testBase) return Response.json({ ok: false, message: 'URL is required' })
  if (!testUser) return Response.json({ ok: false, message: 'Username is required' })
  if (!testPass) return Response.json({ ok: false, message: 'Password is required' })

  // Attempt login
  const tokenResult = await getPrismToken(
    `test-${Date.now()}`,
    testBase,
    { username: testUser, password: testPass }
  )
  if (!tokenResult.ok) {
    return Response.json({
      ok: false,
      message: (tokenResult as { ok: false; error: string }).error,
    })
  }

  const token = (tokenResult as { ok: true; token: string }).token

  // Try fetching device count as a connectivity smoke test
  try {
    const res = await fetch(`${testBase}/api/tenant/devices?pageSize=1&page=0`, {
      headers: { 'X-Authorization': `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) {
      return Response.json({
        ok: false,
        message: `Login succeeded but device list returned HTTP ${res.status}`,
      })
    }
    const data = await res.json() as { totalElements?: number }
    const count = data.totalElements ?? 0
    return Response.json({
      ok: true,
      message: `Connected — ${count} device${count !== 1 ? 's' : ''} found`,
    })
  } catch (e) {
    // Login worked but device fetch failed — still a successful connection
    return Response.json({
      ok: true,
      message: 'Login succeeded (device list unavailable — check permissions)',
    })
  }
}
