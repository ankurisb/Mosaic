/**
 * lib/superset-sync.ts
 *
 * Registers a SQL database connection in Superset whenever one is added
 * in claude-app. Only runs for dialects Superset supports.
 * Failures are silent — claude-app works fine even if Superset sync fails.
 */

import { log } from '@/lib/logger'

// Resolve Superset config settings-FIRST (kv_settings via supersetSetting) then
// env. These MUST NOT be module-level env constants: docker-compose bakes in the
// bundled defaults (superset:8088 / Admin1234!), so reading env at load time made
// sync ignore a bring-your-own Superset's saved credentials and fail auth with a
// 401 — while every other Superset endpoint (already migrated) worked. Resolve per
// call instead.
async function supersetCfg(): Promise<{ url: string; user: string; pass: string }> {
  const { supersetSetting } = await import('./superset-auth')
  return {
    url: (await supersetSetting('SUPERSET_URL', process.env.SUPERSET_URL || 'http://localhost:8088')).replace(/\/$/, ''),
    user: await supersetSetting('SUPERSET_ADMIN_USER', process.env.SUPERSET_ADMIN_USER || 'admin'),
    pass: await supersetSetting('SUPERSET_ADMIN_PASSWORD', process.env.SUPERSET_ADMIN_PASSWORD || ''),
  }
}

// Dialects that Superset can handle — others are claude-app only
const SUPERSET_SUPPORTED_DIALECTS = ['postgres', 'mysql', 'mssql', 'clickhouse']

interface ConnectionParams {
  id: string
  label: string
  dialect: string
  host?: string
  port?: number
  database_name?: string
  username?: string
  password?: string           // plaintext — only available at create time
  connection_string?: string  // plaintext — only available at create time
  ssl_mode?: string
  schema_name?: string
}

// ── Superset API auth ─────────────────────────────────────────────────────────

async function getSupersetToken(): Promise<string | null> {
  try {
    const { url, user, pass } = await supersetCfg()
    const res = await fetch(`${url}/api/v1/security/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: user,
        password: pass,
        provider: 'db',
        refresh: false,
      }),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.access_token || null
  } catch {
    return null
  }
}

type CsrfPair = { csrfToken: string; sessionCookie: string | null }

async function getCsrfToken(accessToken: string): Promise<CsrfPair | null> {
  try {
    const { url } = await supersetCfg()
    const res = await fetch(`${url}/api/v1/security/csrf_token/`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const data = await res.json()
    if (!data.result) return null

    // Bug 4.4: Superset 3.x+ binds the CSRF token to the Flask session cookie
    // set on this same response. Bearer auth alone is not enough — the POST
    // that uses the CSRF token must also forward the matching session cookie.
    // node fetch's Headers.getSetCookie() exposes Set-Cookie values for
    // server-to-server requests (no CORS filtering). Extract the 'session='
    // pair specifically; ignore other cookies the server may set.
    const setCookies = res.headers.getSetCookie?.() || []
    const sessionCookie = setCookies
      .map(c => c.split(';')[0])
      .find(c => c.startsWith('session=')) || null

    if (!sessionCookie) {
      log.warn({ service: 'superset-sync', setCookiesCount: setCookies.length }, 'CSRF response had no session cookie')
    }

    return { csrfToken: data.result, sessionCookie }
  } catch {
    return null
  }
}

// ── SQLAlchemy URI builder ────────────────────────────────────────────────────

function buildSqlalchemyUri(conn: ConnectionParams): string | null {
  // If user provided a full connection string, use it directly
  if (conn.connection_string) return conn.connection_string

  const { dialect, username, password, host, port, database_name } = conn

  if (!host || !database_name) return null

  const user = username || ''
  const pass = password ? encodeURIComponent(password) : ''
  const creds = user ? (pass ? `${user}:${pass}@` : `${user}@`) : ''

  switch (dialect) {
    case 'postgres':
      return `postgresql+psycopg2://${creds}${host}:${port || 5432}/${database_name}`
    case 'mysql':
      return `mysql+pymysql://${creds}${host}:${port || 3306}/${database_name}`
    case 'mssql':
      return `mssql+pyodbc://${creds}${host}:${port || 1433}/${database_name}?driver=ODBC+Driver+17+for+SQL+Server`
    case 'clickhouse':
      return `clickhousedb://${creds}${host}:${port || 8123}/${database_name}`
    default:
      return null
  }
}

// ── Main sync function ────────────────────────────────────────────────────────

export interface SyncResult {
  ok: boolean
  status: 'registered' | 'updated' | 'skipped' | 'failed'
  reason?: string
  supersetId?: number
}

export async function syncToSuperset(conn: ConnectionParams): Promise<SyncResult> {
  // Skip unsupported dialects (API/file/NoSQL sources can't be dashboarded in
  // Superset — it only speaks SQLAlchemy). Not a failure, just out of scope.
  if (!SUPERSET_SUPPORTED_DIALECTS.includes(conn.dialect)) {
    return { ok: true, status: 'skipped', reason: `dialect "${conn.dialect}" is not SQL — Superset dashboards need a SQL database` }
  }

  const uri = buildSqlalchemyUri(conn)
  if (!uri) {
    const reason = `could not build a SQLAlchemy URI (missing host/database, or no credentials for ${conn.label})`
    log.warn({ service: 'superset-sync', connId: conn.id }, `[superset-sync] ${reason}`)
    return { ok: false, status: 'failed', reason }
  }

  const { url } = await supersetCfg()

  try {
    const accessToken = await getSupersetToken()
    if (!accessToken) {
      const reason = 'could not authenticate with Superset (check SUPERSET_URL / admin credentials)'
      log.warn({ service: 'superset-sync', connId: conn.id }, `[superset-sync] ${reason}`)
      return { ok: false, status: 'failed', reason }
    }

    const csrf = await getCsrfToken(accessToken)
    if (!csrf) {
      const reason = 'could not obtain a CSRF token from Superset'
      log.warn({ service: 'superset-sync', connId: conn.id }, `[superset-sync] ${reason}`)
      return { ok: false, status: 'failed', reason }
    }
    const { csrfToken, sessionCookie } = csrf

    const body = {
      database_name: conn.label,
      sqlalchemy_uri: uri,
      expose_in_sqllab: true,
      allow_run_async: true,
      allow_dml: !conn.connection_string, // conservative default
      extra: JSON.stringify({
        // Store claude-app connection ID for reference
        claude_app_connection_id: conn.id,
        schemas_allowed_for_file_upload: [],
      }),
    }

    const res = await fetch(`${url}/api/v1/database/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'X-CSRFToken': csrfToken,
        Referer: url,
        ...(sessionCookie ? { Cookie: sessionCookie } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    })

    if (res.ok) {
      const data = await res.json()
      log.info({ service: 'superset-sync', connId: conn.id }, `[superset-sync] Registered "${conn.label}" in Superset (id: ${data.id})`)
      return { ok: true, status: 'registered', supersetId: data.id }
    }

    const err = await res.text()

    // Superset rejects a duplicate database_name with 422. That means it's
    // already registered — treat as success (idempotent), find its id.
    if (res.status === 422 && /already exists/i.test(err)) {
      const existingId = await findSupersetDatabaseId(accessToken, conn.label)
      log.info({ service: 'superset-sync', connId: conn.id }, `[superset-sync] "${conn.label}" already in Superset (id: ${existingId ?? '?'})`)
      return { ok: true, status: 'updated', supersetId: existingId ?? undefined }
    }

    // Surface the real reason — most often Superset's live connection test
    // failing (wrong credentials, unreachable host). This is the failure that
    // used to be swallowed silently.
    const reason = `Superset rejected the database (${res.status}): ${err.slice(0, 200)}`
    log.warn({ service: 'superset-sync', connId: conn.id }, `[superset-sync] ${reason}`)
    return { ok: false, status: 'failed', reason }
  } catch (err) {
    // Never throw — Superset sync failure must not break claude-app.
    const reason = err instanceof Error ? err.message : String(err)
    log.warn({ service: 'superset-sync', connId: conn.id, data: err }, '[superset-sync] Sync error (non-fatal)')
    return { ok: false, status: 'failed', reason }
  }
}

/** Look up an existing Superset database id by name (for the already-exists case). */
async function findSupersetDatabaseId(accessToken: string, name: string): Promise<number | null> {
  try {
    const q = encodeURIComponent(`(filters:!((col:database_name,opr:eq,value:'${name.replace(/'/g, "\\'")}')))`)
    const { url } = await supersetCfg()
    const res = await fetch(`${url}/api/v1/database/?q=${q}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.result?.[0]?.id ?? null
  } catch {
    return null
  }
}
