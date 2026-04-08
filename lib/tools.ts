import type Anthropic from '@anthropic-ai/sdk'
import { getDb } from './db'
import { Pool } from 'pg'

// ── Tool definitions shown to Claude ─────────────────────────
export const TOOLS: Anthropic.Tool[] = [
  {
    name: 'web_search',
    description: 'Search the web for current information, news, or recent events.',
    input_schema: {
      type: 'object' as const,
      properties: { query: { type: 'string', description: 'Search query' } },
      required: ['query'],
    },
  },
  {
    name: 'query_database',
    description: 'Run a SQL SELECT query against a configured database connection. Use this to answer questions about data.',
    input_schema: {
      type: 'object' as const,
      properties: {
        connection_id: { type: 'string', description: 'The database connection ID from settings' },
        sql: { type: 'string', description: 'SQL query to run. Must be SELECT only.' },
      },
      required: ['connection_id', 'sql'],
    },
  },
  {
    name: 'call_api',
    description: 'Make an HTTP request to a configured API connection.',
    input_schema: {
      type: 'object' as const,
      properties: {
        connection_id: { type: 'string', description: 'The API connection ID from settings' },
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], description: 'HTTP method' },
        path: { type: 'string', description: 'Path to append to the base path, e.g. /search or ?limit=10' },
        body: { type: 'object', description: 'Request body for POST/PUT/PATCH' },
      },
      required: ['connection_id', 'method', 'path'],
    },
  },
]

// ── Run any tool ──────────────────────────────────────────────
export async function runTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'web_search': return webSearch(String(input.query))
    case 'query_database': return queryDatabase(String(input.connection_id), String(input.sql))
    case 'call_api': return callApi(String(input.connection_id), String(input.method), String(input.path), input.body as Record<string, unknown> | undefined)
    default: throw new Error(`Unknown tool: ${name}`)
  }
}

// ── Web search ────────────────────────────────────────────────
async function webSearch(query: string) {
  if (process.env.TAVILY_API_KEY) {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query, max_results: 5 }),
    })
    if (!res.ok) throw new Error(`Tavily error ${res.status}`)
    const data = await res.json()
    return (data.results || []).map((r: { title: string; url: string; content: string }) => ({
      title: r.title, url: r.url, snippet: String(r.content || '').slice(0, 400),
    }))
  }
  return [{ title: 'Search not configured', url: '', snippet: 'Add TAVILY_API_KEY to environment variables. Get a free key at app.tavily.com' }]
}

// ── Database query ────────────────────────────────────────────
const pools = new Map<string, Pool>()

async function queryDatabase(connectionId: string, sql: string) {
  // Safety: only allow SELECT queries
  const trimmed = sql.trim().toUpperCase()
  if (!trimmed.startsWith('SELECT') && !trimmed.startsWith('WITH') && !trimmed.startsWith('EXPLAIN')) {
    throw new Error('Only SELECT queries are allowed for safety. No INSERT, UPDATE, DELETE, or DROP.')
  }

  const db = getDb()
  const rows = await db`SELECT * FROM db_connections WHERE id=${connectionId}`
  if (!rows.length) throw new Error(`Database connection "${connectionId}" not found. Check your connections in Settings.`)

  const conn = rows[0]

  // Read-only check
  if (conn.read_only && (trimmed.includes('INSERT') || trimmed.includes('UPDATE') || trimmed.includes('DELETE'))) {
    throw new Error('This connection is set to read-only.')
  }

  // Build connection string
  const connStr = conn.connection_string ||
    `postgresql://${conn.username}:${conn.password_enc}@${conn.host}:${conn.port}/${conn.database_name}`

  // Get or create pool
  let pool = pools.get(connectionId)
  if (!pool) {
    pool = new Pool({
      connectionString: connStr,
      max: conn.pool_max || 3,
      connectionTimeoutMillis: conn.connect_timeout_ms || 5000,
      statement_timeout: conn.query_timeout_ms || 30000,
      ssl: conn.ssl_mode === 'disable' ? false :
           conn.ssl_mode === 'require' ? { rejectUnauthorized: false } :
           conn.ssl_mode === 'verify-full' ? { rejectUnauthorized: true, ca: conn.ssl_ca || undefined } :
           undefined,
    })
    pools.set(connectionId, pool)
  }

  const result = await pool.query(`SELECT * FROM (${sql}) _q LIMIT 200`)
  return { rows: result.rows, rowCount: result.rowCount, fields: result.fields.map(f => f.name) }
}

// ── API call ──────────────────────────────────────────────────
async function callApi(connectionId: string, method: string, path: string, body?: Record<string, unknown>) {
  const db = getDb()

  // Load connection + its service
  const connRows = await db`
    SELECT c.*, s.base_url, s.auth_type, s.auth_config, s.default_headers,
           s.api_version, s.version_header, s.rate_limit_rpm,
           s.request_timeout_ms, s.label as service_label
    FROM api_connections c
    JOIN api_services s ON s.id = c.service_id
    WHERE c.id = ${connectionId}`

  if (!connRows.length) throw new Error(`API connection "${connectionId}" not found. Check your connections in Settings.`)
  const conn = connRows[0]

  // Build URL
  const base = conn.base_url.replace(/\/$/, '')
  const basePath = (conn.base_path || '').replace(/\/$/, '')
  const reqPath = path.startsWith('/') ? path : '/' + path
  const url = base + basePath + reqPath

  // Build headers
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }

  // Default headers from service
  try { Object.assign(headers, JSON.parse(conn.default_headers || '{}')) } catch {}

  // Auth
  const authConfig = conn.auth_override
    ? JSON.parse(conn.auth_config || '{}')
    : JSON.parse((conn as Record<string, string>).auth_config || '{}')

  const authType = conn.auth_type as string
  if (authType === 'bearer' && authConfig.token) {
    headers['Authorization'] = `Bearer ${authConfig.token}`
  } else if (authType === 'api_key_header' && authConfig.header && authConfig.key) {
    headers[authConfig.header] = authConfig.key
  } else if (authType === 'basic' && authConfig.username && authConfig.password) {
    headers['Authorization'] = 'Basic ' + Buffer.from(`${authConfig.username}:${authConfig.password}`).toString('base64')
  } else if (authType === 'oauth2_client') {
    // Token should be pre-fetched and stored — simplified here
    if (authConfig.token) headers['Authorization'] = `Bearer ${authConfig.token}`
  }

  // API version header
  if (conn.api_version && conn.version_header) {
    headers[conn.version_header] = conn.api_version
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), (conn.request_timeout_ms || 30000))

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: ['POST', 'PUT', 'PATCH'].includes(method) && body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
    clearTimeout(timeout)

    const text = await res.text()
    let data: unknown
    try { data = JSON.parse(text) } catch { data = text }

    if (!res.ok) throw new Error(`API returned ${res.status}: ${text.slice(0, 200)}`)
    return data
  } catch (err) {
    clearTimeout(timeout)
    if ((err as Error).name === 'AbortError') throw new Error(`Request timed out after ${conn.request_timeout_ms || 30000}ms`)
    throw err
  }
}
