/**
 * lib/superset-sync.ts
 *
 * Registers a SQL database connection in Superset whenever one is added
 * in claude-app. Only runs for dialects Superset supports.
 * Failures are silent — claude-app works fine even if Superset sync fails.
 */

const SUPERSET_URL = process.env.SUPERSET_URL || 'http://localhost:8088'
const SUPERSET_USER = process.env.SUPERSET_ADMIN_USER || 'admin'
const SUPERSET_PASS = process.env.SUPERSET_ADMIN_PASSWORD || ''

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
    const res = await fetch(`${SUPERSET_URL}/api/v1/security/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: SUPERSET_USER,
        password: SUPERSET_PASS,
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
    const res = await fetch(`${SUPERSET_URL}/api/v1/security/csrf_token/`, {
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
      console.warn('[superset-sync] CSRF response had no session cookie. setCookies count=' + setCookies.length)
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

export async function syncToSuperset(conn: ConnectionParams): Promise<void> {
  // Skip unsupported dialects silently
  if (!SUPERSET_SUPPORTED_DIALECTS.includes(conn.dialect)) return

  const uri = buildSqlalchemyUri(conn)
  if (!uri) {
    console.warn(`[superset-sync] Could not build URI for connection ${conn.id}`)
    return
  }

  try {
    const accessToken = await getSupersetToken()
    if (!accessToken) {
      console.warn('[superset-sync] Could not authenticate with Superset')
      return
    }

    const csrf = await getCsrfToken(accessToken)
    if (!csrf) {
      console.warn('[superset-sync] Could not get CSRF token from Superset')
      return
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

    const res = await fetch(`${SUPERSET_URL}/api/v1/database/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'X-CSRFToken': csrfToken,
        Referer: SUPERSET_URL,
        ...(sessionCookie ? { Cookie: sessionCookie } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    })

    if (res.ok) {
      const data = await res.json()
      console.log(`[superset-sync] Registered "${conn.label}" in Superset (id: ${data.id})`)
    } else {
      const err = await res.text()
      console.warn(`[superset-sync] Failed to register in Superset: ${res.status} ${err.slice(0, 200)}`)
    }
  } catch (err) {
    // Never throw — Superset sync failure must not break claude-app
    console.warn('[superset-sync] Sync error (non-fatal):', err)
  }
}
