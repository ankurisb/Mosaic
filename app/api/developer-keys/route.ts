import { getSession } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { generateApiKey } from '@/lib/dev-api-auth'
import { log, newRequestId } from '@/lib/logger'
import { audit, AUDIT } from '@/lib/audit'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const session = await getSession()
  if (!session || session.role !== 'admin')
    return Response.json({ error: 'Admin only' }, { status: 403 })

  const sql = getDb()
  const rows = await sql`
    SELECT id, name, key_preview, scopes, rate_limit, active,
           last_used_at, expires_at, created_at
    FROM developer_api_keys
    ORDER BY created_at DESC`

  // Usage stats per key (last 24h and all time)
  const stats: Record<string, { last24h: number; total: number }> = {}
  for (const row of rows as { id: string }[]) {
    try {
      const yesterday = new Date(Date.now() - 86400_000).toISOString()
      const [total, recent] = await Promise.all([
        sql`SELECT COUNT(*) as cnt FROM developer_api_usage WHERE key_id = ${row.id}`,
        sql`SELECT COUNT(*) as cnt FROM developer_api_usage WHERE key_id = ${row.id} AND created_at > ${yesterday}`,
      ])
      stats[row.id] = {
        total: Number((total[0] as { cnt: string })?.cnt || 0),
        last24h: Number((recent[0] as { cnt: string })?.cnt || 0),
      }
    } catch { stats[row.id] = { total: 0, last24h: 0 } }
  }

  return Response.json({ keys: rows, stats })
}

export async function POST(req: Request) {
  const requestId = req.headers.get('x-request-id') || newRequestId()
  const reqLog = log.child({ requestId, service: 'developer-keys' })
  const session = await getSession()
  if (!session || session.role !== 'admin')
    return Response.json({ error: 'Admin only' }, { status: 403 })

  const sql = getDb()
  const body = await req.json()
  const { action } = body

  // Generate a new key
  if (action === 'create') {
    const { name, scopes = ['read'], rate_limit = 100, expires_at = null } = body
    if (!name?.trim()) return Response.json({ error: 'Name required' }, { status: 400 })

    const { plaintext, hash, preview } = generateApiKey()
    await sql`
      INSERT INTO developer_api_keys (name, key_hash, key_preview, scopes, rate_limit, expires_at, created_by)
      VALUES (${name.trim()}, ${hash}, ${preview},
              ${JSON.stringify(scopes)}, ${rate_limit}, ${expires_at || null}, ${session.id})`

    reqLog.info({ name }, 'Developer API key created')
    audit(req, { id: session.id, email: session.email, role: session.role }, AUDIT.API_KEY_CREATE, `api_key:${preview}`, 'success', { name, scopes, rate_limit })
    // Return plaintext ONCE — never stored
    return Response.json({ ok: true, key: plaintext, preview })
  }

  // Revoke / toggle active
  if (action === 'revoke' || action === 'enable') {
    const { id } = body
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    const active = action === 'enable' ? 1 : 0
    await sql`UPDATE developer_api_keys SET active = ${active} WHERE id = ${id}`
    reqLog.info({ id, action }, 'Developer API key updated')
    audit(req, { id: session.id, email: session.email, role: session.role }, action === 'revoke' ? AUDIT.API_KEY_REVOKE : AUDIT.SETTINGS_UPDATE, `api_key:${id}`, 'success', { action })
    return Response.json({ ok: true })
  }

  // Delete
  if (action === 'delete') {
    const { id } = body
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    await sql`DELETE FROM developer_api_keys WHERE id = ${id}`
    reqLog.info({ id }, 'Developer API key deleted')
    return Response.json({ ok: true })
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 })
}
