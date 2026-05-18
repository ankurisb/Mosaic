import { getSession }       from '@/lib/auth'
import { getDb }            from '@/lib/db'
import { encrypt, decrypt } from '@/lib/encrypt'
export const runtime = 'nodejs'

async function ensureTable() {
  const sql = getDb()
  await sql`CREATE TABLE IF NOT EXISTS kv_settings (
    key        TEXT PRIMARY KEY,
    value_enc  TEXT NOT NULL,
    updated_by TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  )`.catch(() => {})
}

const KNOWN_KEYS = [
  // AI
  'ANTHROPIC_API_KEY',
  // AI & Search
  'TAVILY_API_KEY',
  // Notifications
  'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN',
  // n8n
  'N8N_URL', 'N8N_API_KEY', 'N8N_MOSAIC_API_KEY',
  // GitHub update checker
  'GITHUB_TOKEN', 'GITHUB_REPO',
  // App config
  'NEXT_PUBLIC_APP_URL', 'CRON_SECRET',
  // Database
  'DATABASE_URL',
  // Superset
  'SUPERSET_URL', 'SUPERSET_ADMIN_USER', 'SUPERSET_ADMIN_PASSWORD',
  // Airbyte
  'AIRBYTE_USER', 'AIRBYTE_PASSWORD',
]

export async function GET() {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  await ensureTable()
  const sql  = getDb()
  // SQLite doesn't support ANY() -- use individual queries or IN with literal
  // Fetch all known keys dynamically
  // Fetch all known keys — query each individually to avoid SQL injection and driver compat issues
  const allRows: {key:string;value_enc:string}[] = []
  for (const k of KNOWN_KEYS) {
    const r = await sql`SELECT key, value_enc FROM kv_settings WHERE key=${k}`.catch(() => [])
    if ((r as {key:string;value_enc:string}[]).length) allRows.push((r as {key:string;value_enc:string}[])[0])
  }
  const rows = allRows

  const result: Record<string, { configured: boolean; preview: string }> = {}
  KNOWN_KEYS.forEach(k => { result[k] = { configured: false, preview: '' } })
  for (const row of rows as { key: string; value_enc: string }[]) {
    try {
      const plain = decrypt(row.value_enc)
      result[row.key] = { configured: true,
        preview: plain.length > 8 ? plain.slice(0, 4) + '...' + plain.slice(-4) : '***' }
    } catch {
      result[row.key] = { configured: false, preview: '' }
    }
  }
  return Response.json({ keys: result })
}

export async function POST(req: Request) {
  const session = await getSession()
  if (!session || session.role !== 'admin')
    return Response.json({ error: 'Admin only' }, { status: 403 })
  await ensureTable()
  const sql  = getDb()
  const body = await req.json()
  const { action, key, value } = body as { action: string; key: string; value?: string }

  if (!KNOWN_KEYS.includes(key))
    return Response.json({ error: 'Unknown key' }, { status: 400 })

  if (action === 'set') {
    if (!value?.trim()) return Response.json({ error: 'Value required' }, { status: 400 })
    const enc = encrypt(value.trim())
    await sql`INSERT INTO kv_settings (key, value_enc, updated_by, updated_at)
      VALUES (${key}, ${enc}, ${session.id}, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value_enc=excluded.value_enc,
        updated_by=excluded.updated_by, updated_at=datetime('now')`
    process.env[key] = value.trim()
    return Response.json({ ok: true })
  }

  if (action === 'delete') {
    await sql`DELETE FROM kv_settings WHERE key = ${key}`
    delete process.env[key]
    return Response.json({ ok: true })
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 })
}

export async function getKey(key: string): Promise<string | null> {
  if (process.env[key]) return process.env[key] as string
  try {
    await ensureTable()
    const sql  = getDb()
    const rows = await sql`SELECT value_enc FROM kv_settings WHERE key = ${key} LIMIT 1`
    const row  = (rows as { value_enc: string }[])[0]
    if (!row) return null
    const val = decrypt(row.value_enc)
    process.env[key] = val
    return val
  } catch { return null }
}
