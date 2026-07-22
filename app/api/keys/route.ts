import { getSession }       from '@/lib/auth'
import { log, newRequestId } from '@/lib/logger'
import { getDb, nowExpr, isPostgres } from '@/lib/db'
import { encrypt, decrypt } from '@/lib/encrypt'
export const runtime = 'nodejs'

async function ensureTable() {
  const sql = getDb()
  // Postgres schema is owned by setup-pg.ts; skip the SQLite-specific DDL there.
  if (isPostgres()) return
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
  // AI & Search — SEARCH_PROVIDER selects the backend (tavily|perplexity),
  // each provider's key read via getKey so it's runtime-settable here.
  'SEARCH_PROVIDER', 'TAVILY_API_KEY', 'PERPLEXITY_API_KEY',
  // Notifications
  'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN',
  // n8n
  'N8N_URL', 'N8N_API_KEY', 'N8N_MOSAIC_API_KEY',
  // GitHub update checker
  'GITHUB_TOKEN', 'GITHUB_REPO',
  // App config
  // NOTE: NEXT_PUBLIC_APP_URL is intentionally excluded. NEXT_PUBLIC_ vars are
  // inlined by Next.js at BUILD time, and every consumer reads process.env
  // directly (never getKey), so a value stored here would be silently ignored.
  // It is env-only — see ENV_TEMPLATE.md / DEPLOY_RUNBOOK.md.
  'CRON_SECRET',
  // 'false' means this deployment intentionally runs without AI (air-gapped /
  // no-internet sites). Absent = AI enabled. Settable here so it can also be
  // pre-set in .env; the toggle lives in Settings -> Setup, not in the API Keys
  // UI, so it is deliberately absent from KEY_SECTIONS in TabKeys.tsx.
  'AI_ENABLED',
  // DATABASE_URL is intentionally excluded — it is Mosaic's own database
  // connection string, read from process.env at startup to open the connection
  // that kv_settings itself lives in. A value stored here could never be read
  // before that connection exists, so it was a silent no-op. Env-only.
  //
  // SUPERSET_* and AIRBYTE_* are likewise excluded. They are internal service
  // accounts, set once in .env and shared by compose across both containers
  // (SUPERSET_ADMIN_PASSWORD bootstraps the Superset admin AND is Mosaic's auth;
  // AIRBYTE_* is basic auth on both the proxy and Mosaic's caller). All are read
  // from process.env, never getKey, so storing them here did nothing. End users
  // reach Superset through the SSO gate, not these credentials. Env-only.
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

  const result: Record<string, { configured: boolean; preview: string; value?: string }> = {}

  // Non-secret keys whose plain value the UI legitimately needs (e.g. to know
  // which provider is selected so it can show the right fields). These are not
  // credentials, so returning the value rather than a masked preview is safe.
  const PLAIN_KEYS = new Set(['SEARCH_PROVIDER', 'GITHUB_REPO', 'N8N_URL', 'CISO_API_URL'])

  // Seed from env vars first (lowest priority — kv_settings overrides below)
  KNOWN_KEYS.forEach(k => {
    if (process.env[k]) {
      const v = process.env[k] as string
      result[k] = { configured: true, preview: v.length > 8 ? v.slice(0, 4) + '...' + v.slice(-4) : '***',
        ...(PLAIN_KEYS.has(k) ? { value: v } : {}) }
    } else {
      result[k] = { configured: false, preview: '' }
    }
  })
  // kv_settings values take precedence (more recently set)
  for (const row of rows as { key: string; value_enc: string }[]) {
    try {
      const plain = decrypt(row.value_enc)
      result[row.key] = { configured: true,
        preview: plain.length > 8 ? plain.slice(0, 4) + '...' + plain.slice(-4) : '***',
        ...(PLAIN_KEYS.has(row.key) ? { value: plain } : {}) }
    } catch {
      result[row.key] = { configured: false, preview: '' }
    }
  }
  return Response.json({ keys: result })
}

export async function POST(req: Request) {
  const requestId = req.headers.get('x-request-id') || newRequestId()
  const reqLog = log.child({ requestId, service: 'keys' })
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
      VALUES (${key}, ${enc}, ${session.id}, ${nowExpr()})
      ON CONFLICT(key) DO UPDATE SET value_enc=excluded.value_enc,
        updated_by=excluded.updated_by, updated_at=${nowExpr()}`
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
