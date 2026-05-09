import type Anthropic from '@anthropic-ai/sdk'
import { getDb } from './db'
import { decrypt } from './encrypt'
import * as aws4 from 'aws4'

// Bug 4.13: S3 reader was sending unauthenticated requests against private
// buckets, and the legacy stub helper hard-coded "placeholder-sig". MinIO and
// real AWS S3 both reject this with 403. Use aws4 to compute proper SigV4
// auth headers. Works against AWS S3 (default region us-east-1) and any
// S3-compatible endpoint like MinIO when an explicit endpoint_url is set.
async function s3SignedFetch(
  method: string,
  url: string,
  accessKeyId: string,
  secretAccessKey: string,
  body?: Buffer,
): Promise<Response> {
  const u = new URL(url)
  // For S3-compatible servers (MinIO) the region defaults to 'us-east-1' and
  // the service is 's3'. Bucket lives in the path (path-style addressing),
  // matching the URLs we already construct.
  const opts: aws4.Request = {
    host:    u.host,
    method,
    path:    u.pathname + u.search,
    service: 's3',
    region:  'us-east-1',
    body,
  }
  aws4.sign(opts as any, { accessKeyId, secretAccessKey })
  return fetch(url, {
    method,
    headers: opts.headers as Record<string, string>,
    body: body as BodyInit,
    signal: AbortSignal.timeout(30000),
  })
}
import { Pool } from 'pg'
import type { Pool as MysqlPool } from 'mysql2/promise'
import { applyAuth, parseAuthConfig } from '@/lib/api-auth'

// -- Tool definitions ------------------------------------------
export const TOOLS: Anthropic.Tool[] = [
  {
    name: 'web_search',
    description: 'Search the web for current information, news, or recent events.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Search query' } },
      required: ['query']
    },
  },
  {
    name: 'query_database',
    description: 'Run a query against a configured database connection. For SQL databases use SELECT. For MongoDB use a JSON filter object.',
    input_schema: {
      type: 'object',
      properties: {
        connection_id: { type: 'string', description: 'The database connection ID from settings' },
        sql: { type: 'string', description: 'For SQL: a SELECT/WITH/EXPLAIN query. For MongoDB: JSON like {"collection":"users","filter":{"active":true},"limit":20}' },
      },
      required: ['connection_id', 'sql']
    },
  },
  {
    name: 'call_api',
    description: 'Make an HTTP request to a configured API connection.',
    input_schema: {
      type: 'object',
      properties: {
        connection_id: { type: 'string', description: 'The API connection ID from settings' },
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], description: 'HTTP method' },
        path: { type: 'string', description: 'Path to append to the base path, e.g. /search or ?limit=10' },
        body: { type: 'object', description: 'Request body for POST/PUT/PATCH'},
      },
      required: ['connection_id', 'method', 'path']
    },
  },
  {
    name: 'read_file_server',
    description: 'Read files from a configured file server connection (SMB/SFTP/local/S3). Finds the latest matching file using a 3-step timestamp strategy: (1) filename date pattern, (2) file system modified-at, (3) parse file content for date fields. Returns parsed rows for CSV/Excel, text for PDF/XML/JSON, or base64 for images.',
    input_schema: {
      type: 'object',
      properties: {
        server_id:   { type: 'string', description: 'File server connection ID from settings' },
        file_hint:   { type: 'string', description: 'Natural language hint or exact filename, e.g. "latest OEE report for Line A" or "OEE_LineA_20260414.csv"' },
        file_type:   { type: 'string', description: 'Filter by extension: csv, xlsx, pdf, xml, json, jpeg, png. Leave blank to match any configured type.' },
        ts_strategy: { type: 'string', enum: ['auto', 'filename', 'modified', 'content'], description: 'Timestamp resolution strategy. auto tries all three in order.' },
        max_rows:    { type: 'number', description: 'Row limit for CSV/Excel files (default: 500)' },
        extract:     { type: 'string', description: 'For Excel: sheet name to read, e.g. "sheet=OEE". For JSON/XML: dot-path to array, e.g. "results.items"' },
      },
      required: ['server_id', 'file_hint']
    },
  },
  {
    name: 'query_airbyte',
    description: 'Query data from an Airbyte-synced source, check sync status, or trigger a sync job.',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list_sources', 'list_connections', 'check_jobs', 'trigger_sync'] },
        instance_id: { type: 'string' },
        connection_id: { type: 'string' },
      },
      required: ['action']
    },
  },
  {
    name: 'render_chart',
    description: 'Render a chart inline in the chat to visualize data the user has asked about. Use this when the user asks for a chart, graph, visualization, breakdown, trend, or comparison; or when a visual summary would be more useful than a text response. Always fetch the underlying data first via call_api/query_database/etc., then summarise it into the right shape for the chart type below.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['bar', 'line', 'pie', 'kpi', 'table'], description: 'Chart type. bar = compare categories. line = trend over time. pie = parts of a whole. kpi = single headline number. table = formatted tabular data.' },
        title: { type: 'string', description: 'Short chart title, sentence case.' },
        subtitle: { type: 'string', description: 'Optional one-line context, e.g. units or total.' },
        data: { type: 'array', description: "For bar/pie: array of {label, value}. For line: array of {x, y}. Omit for kpi/table.", items: { type: 'object' } },
        value: { type: ['string', 'number'], description: 'For kpi only: the headline number or string.' },
        label: { type: 'string', description: 'For kpi only: short caption under the number.' },
        delta: { type: 'object', description: 'For kpi only: optional change indicator.', properties: { value: { type: 'number' }, direction: { type: 'string', enum: ['up', 'down'] }, label: { type: 'string' } } },
        columns: { type: 'array', description: 'For table only: column definitions.', items: { type: 'object', properties: { key: { type: 'string' }, label: { type: 'string' }, format: { type: 'string', enum: ['number', 'currency', 'percent', 'text'] } } } },
        rows: { type: 'array', description: 'For table only: array of row objects keyed by column key.', items: { type: 'object' } },
      },
      required: ['type', 'title']
    },
  },
]

export async function runTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'web_search': return webSearch(String(input.query))
    case 'query_database': return queryDatabase(String(input.connection_id), String(input.sql))
    case 'call_api': return callApi(String(input.connection_id), String(input.method), String(input.path), input.body as Record<string, unknown> | undefined)
    case 'read_file_server': return readFileServer(String(input.server_id), String(input.file_hint), { ts_strategy: input.ts_strategy, extract: input.extract, max_rows: input.max_rows, file_type: input.file_type } as Record<string, unknown>)
    case 'query_airbyte': return queryAirbyte(String(input.action), input.instance_id as string | undefined, input.connection_id as string | undefined)
    case 'render_chart': return renderChart(input)
    default: throw new Error(`Unknown tool: ${name}`)
  }
}

// -- Web search ------------------------------------------------
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
  return [{ title: 'Search not configured', url: '', snippet: 'Add TAVILY_API_KEY to environment variables.' }]
}

// -- DB helpers ------------------------------------------------
function getSslConfig(conn: Record<string, unknown>) {
  const mode = conn.ssl_mode as string
  if (mode === 'disable') return false
  if (mode === 'verify-full') return { rejectUnauthorized: true, ca: (conn.ssl_ca as string) || undefined }
  return { rejectUnauthorized: false }
}

function decryptConnStr(conn: Record<string, unknown>): string | null {
  return conn.connection_string ? decrypt(conn.connection_string as string) : null
}

// -- Fix #2: Postgres pool with cleanup on delete --------------
const pgPools = new Map<string, { pool: Pool; lastUsed: number }>()

// Evict pools for connections that no longer exist (run every 10 min)
setInterval(() => {
  const now = Date.now()
  for (const [id, entry] of pgPools.entries()) {
    if (now - entry.lastUsed > 10 * 60 * 1000) {
      entry.pool.end().catch(() => {})
      pgPools.delete(id)
    }
  }
}, 10 * 60 * 1000)

// -- Fix #3: MySQL connection pool ----------------------------
const mysqlPools = new Map<string, MysqlPool>()

async function getMysqlPool(connectionId: string, conn: Record<string, unknown>): Promise<MysqlPool> {
  if (mysqlPools.has(connectionId)) return mysqlPools.get(connectionId)!
  const mysql = await import('mysql2/promise')

  // Fix #4: MySQL SSL -- pass ssl config regardless of how connection is specified
  const sslMode = conn.ssl_mode as string
  const sslConfig = sslMode === 'disable' ? false
    : sslMode === 'verify-full' ? { rejectUnauthorized: true, ca: (conn.ssl_ca as string) || undefined }
    : { rejectUnauthorized: false }

  const pool = mysql.createPool({
    uri: decryptConnStr(conn) || undefined,
    host: decryptConnStr(conn) ? undefined : conn.host as string,
    port: decryptConnStr(conn) ? undefined : (conn.port as number) || 3306,
    database: decryptConnStr(conn) ? undefined : conn.database_name as string,
    user: decryptConnStr(conn) ? undefined : conn.username as string,
    password: decryptConnStr(conn) ? undefined : decrypt(conn.password_enc as string || ''),
    ssl: sslConfig as object,
    connectionLimit: (conn.pool_max as number) || 5,
    connectTimeout: (conn.connect_timeout_ms as number) || 5000,
    waitForConnections: true,
  })
  mysqlPools.set(connectionId, pool)
  return pool
}

// -- Database query -- dialect-aware ---------------------------
// -- MCP query helper --------------------------------------------------------
// Sends a JSON-RPC 2.0 tools/call request to an MCP-compatible server.
// Tries tool name 'query' first (postgres-mcp, pg-mcp, MCP Toolbox),
// falls back to 'run_sql' (Neon) if the server returns method-not-found.
async function queryViaMcp(endpoint: string, token: string | undefined, sql: string, database?: string): Promise<unknown> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`

  // Build args -- omit database key if not set (some servers reject unknown args)
  const args: Record<string, string> = { sql }
  if (database) args.database = database

  async function callTool(toolName: string) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', params: { name: toolName, arguments: args }, id: 1 }),
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) throw new Error(`MCP server returned HTTP ${res.status}`)
    return res.json()
  }

  // Try 'query' first, fall back to 'run_sql' on method-not-found (-32601)
  let body = await callTool('query')
  if (body.error?.code === -32601 || body.error?.message?.includes('not found')) {
    body = await callTool('run_sql')
  }
  if (body.error) throw new Error(`MCP error: ${body.error.message || JSON.stringify(body.error)}`)

  // Normalise result to {rows, rowCount, fields}
  const result = body.result
  if (!result) throw new Error('MCP server returned no result')

  // Standard MCP: result.content is an array of content blocks
  if (result.content) {
    const textBlock = (result.content as Array<{ type: string; text?: string }>).find(c => c.type === 'text')
    if (textBlock?.text) {
      try {
        const parsed = JSON.parse(textBlock.text)
        if (Array.isArray(parsed)) return { rows: parsed, rowCount: parsed.length, fields: parsed[0] ? Object.keys(parsed[0]) : [], via: 'mcp' }
        if (parsed.rows) return { ...parsed, via: 'mcp' }
        if (parsed.results) return { rows: parsed.results, rowCount: parsed.results.length, fields: parsed.results[0] ? Object.keys(parsed.results[0]) : [], via: 'mcp' }
        return { result: parsed, via: 'mcp' }
      } catch { return { result: textBlock.text, via: 'mcp' } }
    }
  }
  // Some servers return rows directly in result
  if (Array.isArray(result)) return { rows: result, rowCount: result.length, fields: result[0] ? Object.keys(result[0]) : [], via: 'mcp' }
  if (result.rows) return { ...result, via: 'mcp' }
  return { result, via: 'mcp' }
}

async function queryDatabase(connectionId: string, queryInput: string) {
  // Bug 4.6: strip trailing semicolons (and any whitespace after them) so they
  // don't break the `SELECT * FROM (${q}) _q LIMIT 200` wrap below.
  const trimmed = queryInput.trim().replace(/;+\s*$/, '')
  if (!trimmed) throw new Error('SQL query is empty. Please provide a valid SELECT statement.')
  const db = getDb()
  const rows = await db`SELECT * FROM db_connections WHERE id=${connectionId}`
  if (!rows.length) throw new Error(`Database connection "${connectionId}" not found. Check Settings → Databases.`)

  const conn = rows[0] as Record<string, unknown>
  const dialect = (conn.dialect as string) || 'postgres'
  const upper = trimmed.toUpperCase()

  // SQL safety guard -- dialect-aware whitelist for read-only commands
  if (dialect !== 'mongodb') {
    const baseAllowed = ['SELECT', 'WITH', 'EXPLAIN']
    const dialectExtras: Record<string, string[]> = {
      influxdb:  ['SHOW'],
      mysql:     ['SHOW', 'DESCRIBE', 'DESC'],
      mssql:     ['SHOW', 'DESCRIBE'],
      clickhouse:['SHOW', 'DESCRIBE', 'DESC'],
      sqlite:    ['PRAGMA'],
      postgres:  [],
    }
    const allowed = [...baseAllowed, ...(dialectExtras[dialect] || [])]
    const ok = allowed.some(v => upper.startsWith(v))
    if (!ok) {
      throw new Error(`Only ${allowed.join(' / ')} queries are allowed for ${dialect}.`)
    }
    if (conn.read_only && (upper.includes('INSERT') || upper.includes('UPDATE') || upper.includes('DELETE'))) {
      throw new Error('This connection is read-only.')
    }
  }

  // -- MCP connector (Postgres / MySQL / SQL Server) -----------
  // If the connection has an mcp_endpoint configured, route through it.
  // Supports: Neon remote MCP, postgres-mcp, pg-mcp, Google MCP Toolbox,
  //           any server that implements the MCP tools/call JSON-RPC protocol.
  if (conn.mcp_endpoint && (dialect === 'postgres' || dialect === 'mysql' || dialect === 'mssql')) {
    return queryViaMcp(
      conn.mcp_endpoint as string,
      conn.mcp_token as string | undefined,
      trimmed,
      conn.database_name as string | undefined,
    )
  }

  // -- PostgreSQL ----------------------------------------------
  if (dialect === 'postgres') {
    let entry = pgPools.get(connectionId)
    if (!entry) {
      const connStr = decryptConnStr(conn) ||
        `postgresql://${conn.username}:${decrypt(conn.password_enc as string)}@${conn.host}:${conn.port}/${conn.database_name}`
      const pool = new Pool({
        connectionString: connStr,
        max: (conn.pool_max as number) || 5,
        connectionTimeoutMillis: (conn.connect_timeout_ms as number) || 5000,
        statement_timeout: (conn.query_timeout_ms as number) || 30000,
        ssl: getSslConfig(conn),
      })
      entry = { pool, lastUsed: Date.now() }
      pgPools.set(connectionId, entry)
    }
    entry.lastUsed = Date.now()
    const result = await entry.pool.query(`SELECT * FROM (${trimmed}) _q LIMIT 200`)
    return { rows: result.rows, rowCount: result.rowCount, fields: result.fields.map(f => f.name) }
  }

  // -- MySQL ----------------------------------------------------
  if (dialect === 'mysql') {
    const pool = await getMysqlPool(connectionId, conn)
    const [results, fields] = await pool.execute(`SELECT * FROM (${trimmed}) _q LIMIT 200`)
    return {
      rows: results,
      rowCount: (results as unknown[]).length,
      fields: (fields as Array<{ name: string }>).map(f => f.name),
    }
  }

  // -- SQL Server -----------------------------------------------
  if (dialect === 'mssql') {
    const mssql = await import('mssql')
    const pass = decrypt((conn.password_enc as string) || '')
    const config: any = {
      user: conn.username as string,
      password: pass,
      server: conn.host as string,
      port: (conn.port as number) || 1433,
      database: conn.database_name as string,
      options: {
        encrypt: (conn.ssl_mode as string) !== 'disable',
        trustServerCertificate: (conn.ssl_mode as string) !== 'verify-full',
      },
      connectionTimeout: (conn.connect_timeout_ms as number) || 5000,
      requestTimeout: (conn.query_timeout_ms as number) || 30000,
    }
    // Fix #1: wrap in TOP 200 for MSSQL (no LIMIT support)
    const mssqlQuery = trimmed.replace(/^(SELECT)/i, 'SELECT TOP 200')
    const pool = decryptConnStr(conn)
      ? await mssql.connect(decryptConnStr(conn)!)
      : await mssql.connect(config as any)
    try {
      const result = await pool.request().query(mssqlQuery)
      return {
        rows: result.recordset,
        rowCount: result.rowsAffected[0],
        fields: Object.keys((result.recordset[0] as object) || {}),
      }
    } finally {
      await pool.close()
    }
  }

  // -- SQLite ---------------------------------------------------
  if (dialect === 'sqlite') {
    const Database = (await import('better-sqlite3')).default
    const rawPath = (decryptConnStr(conn) || conn.database_name) as string
    const isSandbox = rawPath === '__sandbox__'

    const db2 = isSandbox
      ? (() => {
          const d = new Database(':memory:')
          d.exec(`
            CREATE TABLE machines(id INTEGER PRIMARY KEY, name TEXT, type TEXT, line TEXT, status TEXT);
            CREATE TABLE production_logs(id INTEGER PRIMARY KEY, machine_id INTEGER, shift_date TEXT, shift TEXT, units_produced INTEGER, units_target INTEGER, cycle_time_s REAL, oee_pct REAL);
            CREATE TABLE downtime_events(id INTEGER PRIMARY KEY, machine_id INTEGER, started_at TEXT, duration_min INTEGER, reason TEXT, category TEXT);
            CREATE TABLE quality_checks(id INTEGER PRIMARY KEY, machine_id INTEGER, check_date TEXT, defect_rate_pct REAL, inspector TEXT);

            INSERT INTO machines VALUES(1,'CNC-01','CNC','Line A','active'),(2,'CNC-02','CNC','Line A','active'),(3,'LATHE-01','Lathe','Line B','active'),(4,'PRESS-01','Press','Line B','maintenance'),(5,'MILL-01','Milling','Line C','active');

            INSERT INTO production_logs VALUES
            (1,1,'2026-04-12','Shift 1',58,64,36.4,82.1),(2,1,'2026-04-12','Shift 2',48,64,41.1,71.2),(3,1,'2026-04-12','Shift 3',36,48,37.2,81.9),
            (4,2,'2026-04-12','Shift 1',61,64,35.1,88.4),(5,2,'2026-04-12','Shift 2',59,64,36.0,85.2),(6,2,'2026-04-12','Shift 3',44,48,37.5,84.1),
            (7,3,'2026-04-12','Shift 1',42,48,52.1,79.4),(8,3,'2026-04-12','Shift 2',38,48,57.3,71.8),(9,3,'2026-04-12','Shift 3',31,40,54.2,72.1),
            (10,5,'2026-04-12','Shift 1',78,80,28.4,91.2),(11,5,'2026-04-12','Shift 2',74,80,29.1,88.6),(12,5,'2026-04-12','Shift 3',60,64,30.2,87.4);

            INSERT INTO downtime_events VALUES
            (1,1,'2026-04-12 09:14',42,'Tool change','Planned'),(2,1,'2026-04-12 14:30',28,'Material shortage','Unplanned'),
            (3,2,'2026-04-12 10:00',15,'Preventive maintenance','Planned'),
            (4,3,'2026-04-12 08:45',35,'Conveyor jam','Unplanned'),(5,3,'2026-04-12 15:20',20,'Tool breakage','Unplanned'),
            (6,4,'2026-04-12 07:00',480,'Scheduled maintenance','Planned');

            INSERT INTO quality_checks VALUES
            (1,1,'2026-04-12',1.8,'Ravi Kumar'),(2,2,'2026-04-12',0.9,'Ravi Kumar'),
            (3,3,'2026-04-12',2.4,'Priya Singh'),(4,5,'2026-04-12',0.6,'Priya Singh');
          `)
          return d
        })()
      : new Database(rawPath, { readonly: true })

    try {
      const stmt = db2.prepare(trimmed)
      const results = stmt.all()
      const fields = results.length > 0 ? Object.keys(results[0] as object) : []
      return { rows: results, rowCount: results.length, fields }
    } finally {
      db2.close()
    }
  }

  // -- MongoDB --------------------------------------------------
  if (dialect === 'mongodb') {
    const { MongoClient } = await import('mongodb')
    const connStr = decryptConnStr(conn) ||
      `mongodb://${conn.username}:${decrypt((conn.password_enc as string) || '')}@${conn.host}:${conn.port}/${conn.database_name}`

    let query: Record<string, unknown>
    try { query = JSON.parse(trimmed) } catch {
      throw new Error('MongoDB queries must be JSON: {"collection":"name","filter":{},"limit":20}')
    }
    if (!query.collection) throw new Error('MongoDB query must include "collection" field.')

    const client = new MongoClient(connStr, { serverSelectionTimeoutMS: (conn.connect_timeout_ms as number) || 5000 })
    try {
      await client.connect()
      const db2 = client.db(conn.database_name as string)
      const col = db2.collection(query.collection as string)
      const cursor = col.find((query.filter as object) || {})
      if (query.sort) cursor.sort(query.sort as Record<string, 1 | -1>)
      if (query.projection) cursor.project(query.projection as object)
      const limit = Math.min((query.limit as number) || 20, 200)
      cursor.limit(limit)
      const results = await cursor.toArray()
      const fields = results.length > 0 ? Object.keys(results[0]) : []
      return { rows: results, rowCount: results.length, fields }
    } finally {
      await client.close()
    }
  }

  // -- ClickHouse ----------------------------------------------
  if (dialect === 'clickhouse') {
    // ClickHouse exposes a plain HTTP API -- no driver needed
    const protocol = (conn.ssl_mode as string) === 'disable' ? 'http' : 'https'
    const base = decryptConnStr(conn) || `${protocol}://${conn.host}:${conn.port || 8123}`
    const url = new URL('/', base)
    url.searchParams.set('query', trimmed)
    url.searchParams.set('default_format', 'JSONEachRow')
    url.searchParams.set('max_result_rows', '200')
    if (conn.database_name) url.searchParams.set('database', conn.database_name as string)

    const headers: Record<string, string> = { 'Accept': 'application/json' }
    if (conn.username) {
      headers['Authorization'] = 'Basic ' + Buffer.from(`${conn.username}:${decrypt((conn.password_enc as string) || '')}`).toString('base64')
    }

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout((conn.query_timeout_ms as number) || 30000),
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`ClickHouse error ${res.status}: ${err.slice(0, 200)}`)
    }

    const text = await res.text()
    const lines = text.trim().split('\n').filter(Boolean)
    const rows = lines.map(l => JSON.parse(l))
    const fields = rows.length > 0 ? Object.keys(rows[0]) : []
    return { rows, rowCount: rows.length, fields }
  }

  // -- InfluxDB -------------------------------------------------
  if (dialect === 'influxdb') {
    // Supports both InfluxDB v1 (InfluxQL) and v2 (Flux)
    // Detect version by query format: Flux queries start with 'from(' or 'import'
    const isFlux = trimmed.startsWith('from(') || trimmed.startsWith('import ')
    const protocol = (conn.ssl_mode as string) === 'disable' ? 'http' : 'https'
    const base = decryptConnStr(conn) || `${protocol}://${conn.host}:${conn.port || 8086}`
    const token = decrypt((conn.password_enc as string) || '')

    if (isFlux) {
      // InfluxDB v2 -- Flux query via POST /api/v2/query
      const url = new URL('/api/v2/query', base)
      if (conn.database_name) url.searchParams.set('org', conn.database_name as string)

      const res = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Authorization': `Token ${token}`,
          'Content-Type': 'application/vnd.flux',
          'Accept': 'application/csv',
        },
        body: trimmed,
        signal: AbortSignal.timeout((conn.query_timeout_ms as number) || 30000),
      })
      if (!res.ok) throw new Error(`InfluxDB v2 error ${res.status}: ${(await res.text()).slice(0, 200)}`)

      // Parse annotated CSV -- skip # comment lines
      const csv = await res.text()
      const lines = csv.split('\n').filter(l => l && !l.startsWith('#'))
      if (lines.length < 2) return { rows: [], rowCount: 0, fields: [] }
      const headers = lines[0].split(',').map(h => h.trim())
      const rows = lines.slice(1).filter(Boolean).map(line => {
        const vals = line.split(',')
        const row: Record<string, string> = {}
        headers.forEach((h, i) => { if (h && h !== 'result' && h !== 'table') row[h] = vals[i]?.trim() || '' })
        return row
      }).filter(r => Object.keys(r).length > 0)
      const fields = rows.length > 0 ? Object.keys(rows[0]) : []
      return { rows, rowCount: rows.length, fields }
    } else {
      // InfluxDB v1 -- InfluxQL via GET /query
      const url = new URL('/query', base)
      url.searchParams.set('db', (conn.database_name as string) || 'default')
      url.searchParams.set('q', trimmed)
      url.searchParams.set('epoch', 'ms')

      const authHeader = conn.username
        ? 'Basic ' + Buffer.from(`${conn.username}:${token}`).toString('base64')
        : token ? `Token ${token}` : ''

      const res = await fetch(url.toString(), {
        headers: { ...(authHeader ? { 'Authorization': authHeader } : {}), 'Accept': 'application/json' },
        signal: AbortSignal.timeout((conn.query_timeout_ms as number) || 30000),
      })
      if (!res.ok) throw new Error(`InfluxDB error ${res.status}: ${(await res.text()).slice(0, 200)}`)

      const json = await res.json()
      const series = json?.results?.[0]?.series?.[0]
      if (!series) return { rows: [], rowCount: 0, fields: [] }
      const fields = series.columns as string[]
      const rows = (series.values as unknown[][]).map(v =>
        Object.fromEntries(fields.map((f: string, i: number) => [f, v[i]]))
      )
      return { rows, rowCount: rows.length, fields }
    }
  }

  throw new Error(`Unsupported dialect: ${dialect}. Supported: postgres, mysql, mssql, sqlite, mongodb, clickhouse, influxdb.`)
}

// -- API call --------------------------------------------------
async function callApi(connectionId: string, method: string, path: string, body?: Record<string, unknown>) {
  const db = getDb()
  const connRows = await db`
    SELECT c.*, s.base_url, s.auth_type, s.auth_config, s.default_headers,
           s.api_version, s.version_header, s.request_timeout_ms
    FROM api_connections c
    JOIN api_services s ON s.id = c.service_id
    WHERE c.id = ${connectionId}`
  if (!connRows.length) throw new Error(`API connection "${connectionId}" not found.`)
  const conn = connRows[0] as Record<string, unknown>
  const base = (conn.base_url as string).replace(/\/$/, '')
  const basePath = ((conn.base_path as string) || '').replace(/\/$/, '')

  // Split basePath into path-portion and query-portion so we can merge
  // query strings cleanly even if both basePath and the caller's path
  // contribute params (e.g. base_path "/invoices?organization_id=X" and
  // caller path "?per_page=10" -> "/invoices?organization_id=X&per_page=10").
  const [basePathOnly, basePathQuery = ''] = basePath.split('?', 2)
  let callerPath = path || ''
  let callerQuery = ''
  if (callerPath.startsWith('?')) {
    callerQuery = callerPath.slice(1)
    callerPath = ''
  } else {
    const qi = callerPath.indexOf('?')
    if (qi !== -1) { callerQuery = callerPath.slice(qi + 1); callerPath = callerPath.slice(0, qi) }
    if (callerPath && !callerPath.startsWith('/')) callerPath = '/' + callerPath
  }
  // Merge query strings, with caller's params overriding base_path's
  // (so APIs that bake mandatory params in base_path can still be overridden
  //  per-call, and we never send duplicate keys which some APIs reject).
  const mergedParams = new URLSearchParams()
  for (const qs of [basePathQuery, callerQuery]) {
    if (!qs) continue
    for (const [k, v] of new URLSearchParams(qs)) mergedParams.set(k, v)
  }
  const mergedQuery = mergedParams.toString()
  let url = base + basePathOnly + callerPath + (mergedQuery ? '?' + mergedQuery : '')
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  try { Object.assign(headers, JSON.parse((conn.default_headers as string) || '{}')) } catch {}
  const authConfig = parseAuthConfig(conn.auth_config as string)
  const authType = (conn.auth_type as string) || ''
  const authResult = await applyAuth(conn.service_id as string, authType, authConfig, headers)
  if (!authResult.ok) throw new Error(authResult.error)
  if (conn.api_version && conn.version_header) headers[conn.version_header as string] = conn.api_version as string
  // SAP OData: auto-inject correct format headers/params based on path
  const isSap = basePath.includes('/sap/opu/')
  const isSapV4 = isSap && (basePath.includes('odata4') || basePath.includes('srvd_a2x'))
  if (isSap) {
    if (isSapV4) {
      // V4: use Accept header, do not use $format param
      headers['Accept'] = 'application/json'
    } else {
      // V2: append $format=json to URL if not already present
      if (!url.includes('$format') && !url.includes('%24format')) {
        url += (url.includes('?') ? '&' : '?') + '%24format=json'
      }
    }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), (conn.request_timeout_ms as number) || 30000)
  try {
    const res = await fetch(url, {
      method, headers,
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
    // Improve SAP-specific error messages
    if (err instanceof Error && isSap) {
      const msg = err.message
      if (msg.includes('401')) throw new Error('SAP auth failed (401) -- check username/password and role /IWFND/RT_GW_USER')
      if (msg.includes('403')) throw new Error('SAP forbidden (403) -- user lacks OData read authorization for this service')
      if (msg.includes('404')) throw new Error('SAP service not found (404) -- activate in /IWFND/MAINT_SERVICE (V2) or /IWFND/V4_ADMIN (V4)')
      if (msg.includes('400')) throw new Error('SAP bad request (400) -- check $filter syntax; field names are case-sensitive in SAP')
      if (msg.includes('500')) throw new Error('SAP Gateway error (500) -- check ICF service active and system reachable')
    }
    throw err
  }
}


// -- File server reader ----------------------------------------
// -- Local/mounted file reader ---------------------------------
async function readLocalFiles(
  server: Record<string, unknown>,
  fileHint: string,
  tsStrategy: string,
  extract: string | undefined,
  maxRows: number,
  fileTypes: string[],
) {
  const fs   = await import('fs/promises')
  const path = await import('path')

  const basePath = path.join(
    (server.share_path as string) || '/',
    (server.sub_path   as string) || '',
  )

  let entries: { name: string; mtime: Date; size: number }[] = []
  try {
    const dirEntries = await fs.readdir(basePath, { withFileTypes: true })
    const stats = await Promise.all(
      dirEntries
        .filter(e => e.isFile() && fileTypes.some(t => e.name.toLowerCase().endsWith('.' + t)))
        .map(async e => {
          const stat = await fs.stat(path.join(basePath, e.name))
          return { name: e.name, mtime: stat.mtime, size: stat.size }
        })
    )
    entries = stats
  } catch (err) {
    throw new Error(`Cannot read directory ${basePath}: ${(err as Error).message}`)
  }

  if (!entries.length) return { server: server.label, files: [], message: 'No matching files found' }

  // Sort by mtime desc, pick best match for fileHint
  entries.sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
  const hint = fileHint.toLowerCase()
  const best = entries.find(e => e.name.toLowerCase().includes(hint)) || entries[0]

  const filePath = path.join(basePath, best.name)
  const ext = best.name.split('.').pop()?.toLowerCase() || ''

  // Read content based on extension
  if (ext === 'csv') {
    const text = await fs.readFile(filePath, 'utf-8')
    const lines = text.split('\n').filter(Boolean)
    const headers = lines[0]?.split(',') || []
    const dataRows = lines.slice(1, maxRows + 1).map(l => {
      const vals = l.split(',')
      return Object.fromEntries(headers.map((h, i) => [h.trim(), vals[i]?.trim()]))
    })
    return {
      server: server.label, file: best.name, timestamp: best.mtime.toISOString(),
      ts_source: tsStrategy === 'filename' ? 'filename' : 'modified_at',
      rows: dataRows.length, columns: headers, data: dataRows.slice(0, maxRows),
    }
  }

  if (ext === 'json') {
    const text = await fs.readFile(filePath, 'utf-8')
    const data = JSON.parse(text)
    return {
      server: server.label, file: best.name, timestamp: best.mtime.toISOString(),
      ts_source: 'modified_at', data: Array.isArray(data) ? data.slice(0, maxRows) : data,
    }
  }

  if (ext === 'xml') {
    const text = await fs.readFile(filePath, 'utf-8')
    // Return raw XML up to 4000 chars -- Claude can parse it
    return {
      server: server.label, file: best.name, timestamp: best.mtime.toISOString(),
      ts_source: 'modified_at', content_type: 'xml',
      content: text.slice(0, 4000) + (text.length > 4000 ? '...(truncated)' : ''),
    }
  }

  if (ext === 'txt') {
    const text = await fs.readFile(filePath, 'utf-8')
    return {
      server: server.label, file: best.name, timestamp: best.mtime.toISOString(),
      ts_source: 'modified_at', content: text.slice(0, 4000),
    }
  }

  // PDF/xlsx/jpeg -- return metadata, content requires additional parsing libraries
  return {
    server: server.label, file: best.name,
    timestamp: best.mtime.toISOString(), size_bytes: best.size,
    ts_source: 'modified_at',
    message: `${ext.toUpperCase()} file found. Add pdf-parse or xlsx npm package for content extraction.`,
    available_files: entries.slice(0, 10).map(e => ({ name: e.name, mtime: e.mtime.toISOString(), size: e.size })),
  }
}


// -- File server reader ----------------------------------------
async function readFileServer(
  serverId: string,
  fileHint: string,
  opts: Record<string, unknown>
): Promise<unknown> {
  const db = getDb()
  const rows = await db`SELECT * FROM file_servers WHERE id = ${serverId}`
  if (!rows.length) throw new Error(`File server "${serverId}" not found. Check Settings  File servers.`)

  const fs = rows[0] as Record<string, unknown>
  const transport   = fs.transport   as string
  const fileTypes   = ((fs.file_types as string) || 'csv,xlsx,pdf').split(',').map(s => s.trim())
  const maxRows     = (opts.max_rows  as number)  || (fs.max_rows   as number) || 500
  const tsStrategy  = (opts.ts_strategy as string) || (fs.ts_strategy as string) || 'auto'
  const filterExt   = opts.file_type as string | undefined

  // -- Step 1: Get file listing ----------------------------------
  const filelist = await listFiles(fs, transport, fileTypes, filterExt)
  if (!filelist.length) {
    throw new Error(`No matching files found on "${fs.label}". Connected path: ${fs.share_path || fs.bucket || fs.host}/${fs.sub_path || ''}`)
  }

  // -- Step 2: Resolve latest file via timestamp strategy --------
  const targetFile = await resolveLatestFile(filelist, fileHint, tsStrategy, fs.filename_date_pattern as string | null)

  // -- Step 3: Read and parse the file ---------------------------
  const content = await fetchFileContent(fs, transport, targetFile.path)
  const parsed   = await parseFileContent(content, targetFile.name, maxRows, opts.extract as string | undefined)

  return {
    file:         targetFile.name,
    path:         targetFile.path,
    size_bytes:   targetFile.size,
    modified_at:  targetFile.modified,
    timestamp:    targetFile.timestamp,
    ts_source:    targetFile.ts_source,
    ...parsed,
  }
}

// -- List files from the server --------------------------------
interface FileEntry {
  name: string
  path: string
  size: number
  modified: string
  timestamp?: Date
  ts_source?: string
}

async function listFiles(
  fs: Record<string, unknown>,
  transport: string,
  fileTypes: string[],
  filterExt?: string
): Promise<FileEntry[]> {
  const allowedExts = filterExt ? [filterExt.toLowerCase()] : fileTypes
  const basePath = [fs.share_path, fs.sub_path].filter(Boolean).join('/') as string

  if (transport === 'local') {
    const { readdir, stat } = await import('fs/promises')
    const { join } = await import('path')
    const entries = await readdir(basePath)
    const files: FileEntry[] = []
    for (const name of entries) {
      const ext = name.split('.').pop()?.toLowerCase() || ''
      if (!allowedExts.includes(ext)) continue
      const st = await stat(join(basePath, name))
      if (!st.isFile()) continue
      files.push({
        name,
        path: join(basePath, name),
        size: st.size,
        modified: st.mtime.toISOString(),
        timestamp: st.mtime,
        ts_source: 'modified',
      })
    }
    return files.sort((a, b) => (b.timestamp?.getTime() ?? 0) - (a.timestamp?.getTime() ?? 0))
  }

  if (transport === 'smb') {
    // SMB: use smbclient if available, fall back to mock for development
    try {
      const { execSync } = await import('child_process')
      const pwd = fs.password_enc ? decrypt(fs.password_enc as string) : ''
      const user = fs.username ? `${fs.username}%${pwd}` : ''
      const cmd = `smbclient "${basePath}" -U "${user}" -c "ls"  2>/dev/null`
      const output = execSync(cmd, { timeout: 10000, encoding: 'utf8' })
      const files: FileEntry[] = []
      for (const line of output.split('\n')) {
        const m = line.match(/^\s+(.+?)\s+[ADRHS]+\s+(\d+)\s+(.+)$/)
        if (!m) continue
        const name = m[1].trim()
        const ext  = name.split('.').pop()?.toLowerCase() || ''
        if (!allowedExts.includes(ext)) continue
        files.push({ name, path: `${basePath}/${name}`, size: Number(m[2]), modified: m[3] })
      }
      return files
    } catch {
      // smbclient not available -- return empty; tool will report no files found
      return []
    }
  }

  if (transport === 'sftp') {
    // SFTP via ssh2 if installed, otherwise log and return empty
    try {
      const ssh2 = await import('ssh2').catch(() => null)
      if (!ssh2) return []
      const { Client } = ssh2
      const password = fs.password_enc ? decrypt(fs.password_enc as string) : ''
      return await new Promise<FileEntry[]>((resolve, reject) => {
        const conn = new Client()
        conn.on('ready', () => {
          conn.sftp((err, sftp) => {
            if (err) { conn.end(); return reject(err) }
            const share = (fs.share_path as string || '').replace(/^\/+|\/+$/g, '')
            const sub   = (fs.sub_path   as string || '').replace(/^\/+|\/+$/g, '')
            const dirPath = '/' + [share, sub].filter(Boolean).join('/')
            sftp.readdir(dirPath, (err2, list) => {
              conn.end()
              if (err2) return reject(err2)
              const files: FileEntry[] = (list || [])
                .filter(e => {
                  const ext = e.filename.split('.').pop()?.toLowerCase() || ''
                  return allowedExts.includes(ext)
                })
                .map(e => ({
                  name:     e.filename,
                  path:     `${dirPath}/${e.filename}`,
                  size:     e.attrs.size,
                  modified: new Date(e.attrs.mtime * 1000).toISOString(),
                  timestamp: new Date(e.attrs.mtime * 1000),
                  ts_source: 'modified',
                }))
                .sort((a, b) => (b.timestamp?.getTime() ?? 0) - (a.timestamp?.getTime() ?? 0))
              resolve(files)
            })
          })
        })
        .on('error', reject)
        .connect({
          host:     fs.host as string,
          port:     (fs.port as number) || 22,
          username: fs.username as string,
          password,
        })
      })
    } catch {
      return []
    }
  }

  if (transport === 's3') {
    // S3: list objects via REST API (works with AWS S3 and S3-compatible)
    const endpoint  = (fs.endpoint_url  as string) || 'https://s3.amazonaws.com'
    const bucket    = fs.bucket    as string
    const prefix    = (fs.sub_path as string) || ''
    const url       = `${endpoint.replace(/\/$/, '')}/${bucket}?list-type=2&prefix=${encodeURIComponent(prefix)}&max-keys=100`
    const accessKey = fs.access_key_id as string
    const secretKey = fs.secret_key_enc ? decrypt(fs.secret_key_enc as string) : ''
    if (!accessKey || !secretKey) throw new Error('S3 list failed: missing access_key_id or secret_key on file server')
    const res       = await s3SignedFetch('GET', url, accessKey, secretKey)
    if (!res.ok) throw new Error(`S3 list failed: ${res.status}`)
    const xml = await res.text()
    const files: FileEntry[] = []
    const matches = xml.matchAll(/<Key>([^<]+)<\/Key>[\s\S]*?<LastModified>([^<]+)<\/LastModified>[\s\S]*?<Size>([^<]+)<\/Size>/g)
    for (const m of matches) {
      const name = m[1].split('/').pop() || m[1]
      const ext  = name.split('.').pop()?.toLowerCase() || ''
      if (!allowedExts.includes(ext)) continue
      const ts = new Date(m[2])
      files.push({ name, path: m[1], size: Number(m[3]), modified: m[2], timestamp: ts, ts_source: 'modified' })
    }
    return files.sort((a, b) => (b.timestamp?.getTime() ?? 0) - (a.timestamp?.getTime() ?? 0))
  }

  return []
}

// -- Resolve the best matching file ---------------------------
async function resolveLatestFile(
  files: FileEntry[],
  hint: string,
  strategy: string,
  datePattern: string | null
): Promise<FileEntry> {
  const hintLower = hint.toLowerCase()

  // Filter by hint keywords if hint looks specific
  const hintWords = hintLower.split(/[\s_\-./]+/).filter(w => w.length > 2)
  const scored = files.map(f => {
    const nameLower = f.name.toLowerCase()
    const score = hintWords.reduce((s, w) => s + (nameLower.includes(w) ? 1 : 0), 0)
    return { ...f, score }
  })
  const maxScore = Math.max(...scored.map(f => f.score))
  const candidates = maxScore > 0 ? scored.filter(f => f.score === maxScore) : scored

  // Strategy 1: filename date pattern
  if (strategy === 'auto' || strategy === 'filename') {
    const withDates = candidates.map(f => ({
      ...f,
      ts_source: 'filename' as const,
      timestamp: extractDateFromFilename(f.name, datePattern),
    })).filter(f => f.timestamp != null)
    if (withDates.length) {
      return withDates.sort((a, b) => b.timestamp!.getTime() - a.timestamp!.getTime())[0]
    }
  }

  // Strategy 2: file system modified-at
  if (strategy === 'auto' || strategy === 'modified') {
    const withMtime = candidates.filter(f => f.timestamp != null).sort(
      (a, b) => b.timestamp!.getTime() - a.timestamp!.getTime()
    )
    if (withMtime.length) return { ...withMtime[0], ts_source: 'modified' }
  }

  // Strategy 3 / fallback: just return most recent by list order (server already sorted)
  return { ...candidates[0], ts_source: 'content' }
}

function extractDateFromFilename(name: string, pattern: string | null): Date | null {
  // Bug 4.10: try user-supplied pattern first (from file_servers.
  // filename_date_pattern). Capture groups must be (YYYY)(MM)(DD), with
  // optional (HH)(MM) for time. Invalid regex / no match falls through to the
  // hardcoded fallbacks below — same behavior as before this fix.
  if (pattern && pattern.trim()) {
    try {
      const re = new RegExp(pattern)
      const m = name.match(re)
      if (m && m[1] && m[2] && m[3]) {
        const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4] || '00'}:${m[5] || '00'}:00Z`)
        if (!isNaN(d.getTime())) return d
      }
    } catch {
      // bad regex — fall through to hardcoded fallbacks
    }
  }

  // Hardcoded fallbacks: YYYYMMDD, YYYY-MM-DD, YYYYMMDD_HHmm, YYYYMMDDTHHMMSS
  const patterns = [
    /(\d{4})[_\-](\d{2})[_\-](\d{2})[_T](\d{2})(\d{2})/,  // 2026-04-14T0600
    /(\d{4})(\d{2})(\d{2})[_T](\d{2})(\d{2})/,              // 20260414_0600
    /(\d{4})[_\-](\d{2})[_\-](\d{2})/,                      // 2026-04-14
    /(\d{4})(\d{2})(\d{2})/,                                  // 20260414
  ]
  for (const re of patterns) {
    const m = name.match(re)
    if (m) {
      try {
        const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4] || '00'}:${m[5] || '00'}:00Z`)
        if (!isNaN(d.getTime())) return d
      } catch { continue }
    }
  }
  return null
}

// -- Fetch raw file content ------------------------------------
async function fetchFileContent(
  fs: Record<string, unknown>,
  transport: string,
  filePath: string
): Promise<Buffer> {
  if (transport === 'local') {
    const { readFile } = await import('fs/promises')
    return readFile(filePath)
  }
  if (transport === 's3') {
    const endpoint  = (fs.endpoint_url as string) || 'https://s3.amazonaws.com'
    const url       = `${endpoint.replace(/\/$/, '')}/${fs.bucket}/${filePath}`
    const accessKey = fs.access_key_id as string
    const secretKey = fs.secret_key_enc ? decrypt(fs.secret_key_enc as string) : ''
    if (!accessKey || !secretKey) throw new Error('S3 read failed: missing access_key_id or secret_key on file server')
    const res = await s3SignedFetch('GET', url, accessKey, secretKey)
    if (!res.ok) throw new Error(`S3 read failed: ${res.status}`)
    return Buffer.from(await res.arrayBuffer())
  }
  if (transport === 'sftp') {
    const ssh2 = await import('ssh2').catch(() => null)
    if (!ssh2) throw new Error('SFTP read failed: ssh2 package not installed')
    const { Client } = ssh2
    const password = fs.password_enc ? decrypt(fs.password_enc as string) : ''
    return await new Promise<Buffer>((resolve, reject) => {
      const conn = new Client()
      conn.on('ready', () => {
        conn.sftp((err, sftp) => {
          if (err) { conn.end(); return reject(err) }
          const chunks: Buffer[] = []
          const stream = sftp.createReadStream(filePath)
          stream.on('data', (c: Buffer) => chunks.push(c))
          stream.on('end', () => { conn.end(); resolve(Buffer.concat(chunks)) })
          stream.on('error', (e: Error) => { conn.end(); reject(e) })
        })
      })
      .on('error', reject)
      .connect({
        host:     fs.host as string,
        port:     (fs.port as number) || 22,
        username: fs.username as string,
        password,
      })
    })
  }
  // SMB still unimplemented
  throw new Error(`Direct file reading for ${transport.toUpperCase()} requires native client (samba/smbclient).`)
}

// -- Parse file content by extension --------------------------
async function parseFileContent(
  buf: Buffer,
  filename: string,
  maxRows: number,
  extract?: string
): Promise<Record<string, unknown>> {
  const ext = filename.split('.').pop()?.toLowerCase() || ''

  if (ext === 'csv') {
    const text  = buf.toString('utf8')
    const lines = text.split('\n').filter(l => l.trim())
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''))
    const rows = lines.slice(1, maxRows + 1).map(line => {
      const vals = line.split(',')
      return Object.fromEntries(headers.map((h, i) => [h, vals[i]?.trim().replace(/^"|"$/g, '') ?? '']))
    })
    return { content_type: 'tabular', rows, row_count: rows.length, columns: headers }
  }

  if (ext === 'json') {
    const data = JSON.parse(buf.toString('utf8'))
    if (extract) {
      const parts  = extract.split('.')
      let current: unknown = data
      for (const p of parts) current = (current as Record<string, unknown>)[p]
      const arr = Array.isArray(current) ? current.slice(0, maxRows) : current
      return { content_type: 'json', data: arr }
    }
    return { content_type: 'json', data: Array.isArray(data) ? data.slice(0, maxRows) : data }
  }

  if (ext === 'xml') {
    const text = buf.toString('utf8')
    // Return trimmed XML text -- agent can parse element names from it
    return { content_type: 'xml', text: text.slice(0, 8000), size_chars: text.length }
  }

  if (ext === 'pdf') {
    // Real PDF text extraction via pdf-parse 1.x. We import 'pdf-parse/lib/pdf-parse.js'
    // directly to bypass the package's index.js, which has a debug block that
    // tries to read a hardcoded test PDF when module.parent is undefined
    // (always the case under dynamic import / bundled environments). Going
    // straight to lib/pdf-parse.js gives us the parser function with no init
    // side effects, no worker file resolution, and no native bindings — runs
    // identically in local dev, Docker, and Vercel.
    try {
      const pdfParseMod = await import('pdf-parse/lib/pdf-parse.js').catch(() => null) as { default?: (b: Buffer) => Promise<{ text: string; numpages: number }> } | null
      const pdfParse = pdfParseMod?.default
      if (!pdfParse) throw new Error('pdf-parse not installed')
      const result = await pdfParse(buf)
      const text = (result.text || '').trim()
      if (!text) {
        return {
          content_type: 'pdf',
          size_bytes:   buf.length,
          page_count:   result.numpages,
          note:         'PDF parsed but no extractable text found — likely an image-only / scanned PDF.',
        }
      }
      return {
        content_type: 'pdf',
        size_bytes:   buf.length,
        page_count:   result.numpages,
        text:         text.slice(0, 12000),
        text_truncated: text.length > 12000,
        size_chars:   text.length,
      }
    } catch (e) {
      return {
        content_type: 'pdf',
        size_bytes:   buf.length,
        note:         `PDF text extraction failed: ${e instanceof Error ? e.message : String(e)}`,
      }
    }
  }

  if (ext === 'xlsx' || ext === 'xls') {
    // Real Excel parsing via SheetJS xlsx. Returns up to maxRows from each
    // sheet, with header inference. Multi-sheet workbooks return a sheets[]
    // array; single-sheet workbooks return rows/columns directly for
    // simpler downstream handling.
    try {
      const xlsxMod = await import('xlsx').catch(() => null) as typeof import('xlsx') | null
      if (!xlsxMod) throw new Error('xlsx package not installed')
      const wb = xlsxMod.read(buf, { type: 'buffer', cellDates: true })
      const sheetNames = wb.SheetNames
      const sheets = sheetNames.map(name => {
        const ws = wb.Sheets[name]
        const json = xlsxMod.utils.sheet_to_json(ws, { defval: null, raw: false }) as Record<string, unknown>[]
        const capped = json.slice(0, maxRows)
        const columns = capped.length ? Object.keys(capped[0]) : []
        return { sheet: name, row_count: json.length, columns, rows: capped, truncated: json.length > maxRows }
      })
      if (sheets.length === 1) {
        const only = sheets[0]
        return {
          content_type: 'excel',
          size_bytes:   buf.length,
          sheet:        only.sheet,
          row_count:    only.row_count,
          columns:      only.columns,
          rows:         only.rows,
          truncated:    only.truncated,
        }
      }
      return {
        content_type: 'excel',
        size_bytes:   buf.length,
        sheet_count:  sheets.length,
        sheets,
      }
    } catch (e) {
      return {
        content_type: 'excel',
        size_bytes:   buf.length,
        note:         `Excel parsing failed: ${e instanceof Error ? e.message : String(e)}`,
      }
    }
  }

  if (['jpeg', 'jpg', 'png', 'webp'].includes(ext)) {
    return {
      content_type: 'image',
      format:       ext,
      size_bytes:   buf.length,
      base64:       buf.toString('base64').slice(0, 100000), // first 100KB of base64
    }
  }

  // Default: return as text
  const text = buf.toString('utf8')
  return { content_type: 'text', text: text.slice(0, 8000), size_chars: text.length }
}

// -- Airbyte tool -----------------------------------------------
async function queryAirbyte(action: string, instanceId?: string, connectionId?: string): Promise<unknown> {
  const sql = getDb()

  // Get instance
  let instances: Record<string, unknown>[]
  try {
    instances = await sql`SELECT id, label, url, username, password_enc, workspace_id FROM airbyte_instances WHERE active = 1 ORDER BY created_at ASC`
  } catch {
    return { error: 'No Airbyte instances configured. Go to Settings > Airbyte to connect one.' }
  }

  if (!instances.length) return { error: 'No Airbyte instances configured. Go to Settings > Airbyte to connect one.' }

  const inst = instanceId ? instances.find(i => i.id === instanceId) || instances[0] : instances[0]
  const base = (inst.url as string).replace(/\/$/, '')
  const password = inst.password_enc ? decrypt(inst.password_enc as string) : 'password'

  // Detect abctl (OAuth2) vs Docker Compose (Basic auth) — same logic as airbyte/route.ts
  const looksLikeAbctl = (inst.username as string).includes('@') || (password.length > 20 && password !== 'password')

  async function getAirbyteAuthHeader(): Promise<string> {
    if (!looksLikeAbctl) {
      return 'Basic ' + Buffer.from(`${inst.username}:${password}`).toString('base64')
    }
    // OAuth2 token exchange for abctl
    const clientId = (inst as Record<string,unknown>).client_id as string || inst.username as string
    const clientSecret = (inst as Record<string,unknown>).client_secret_enc
      ? decrypt((inst as Record<string,unknown>).client_secret_enc as string)
      : password
    const urls = [
      `${base}/api/v1/applications/token`,
      `${base}/api/public/v1/applications/token`,
    ]
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: clientId, client_secret: clientSecret }),
          signal: AbortSignal.timeout(8000),
        })
        if (res.ok) {
          const data = await res.json() as { access_token: string }
          return `Bearer ${data.access_token}`
        }
      } catch {}
    }
    // Fall back to basic auth if OAuth fails
    return 'Basic ' + Buffer.from(`${inst.username}:${password}`).toString('base64')
  }

  const authHeader = await getAirbyteAuthHeader()

  async function ab(path: string, body?: unknown) {
    const urls = [`${base}/api/public/v1${path}`, `${base}/api/v1${path}`]
    for (const url of urls) {
      try {
        const r = await fetch(url, {
          method: body !== undefined ? 'POST' : 'GET',
          headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(8000),
        })
        if (r.ok) return r.json()
      } catch {}
    }
    throw new Error(`Cannot reach Airbyte at ${base}`)
  }

  const workspaceId = inst.workspace_id as string | null

  if (action === 'list_sources') {
    const data = await ab('/sources/list', { workspaceId: workspaceId || '' })
    const sources = data.sources || data.data || []
    return {
      airbyte_instance: inst.label,
      source_count: sources.length,
      sources: sources.map((s: Record<string, unknown>) => ({
        id: s.sourceId || s.id,
        name: s.name,
        type: s.sourceName || s.sourceDefinitionId,
        status: s.status || 'active',
      }))
    }
  }

  if (action === 'list_connections') {
    const data = await ab('/connections/list', { workspaceId: workspaceId || '' })
    const conns = data.connections || data.data || []
    return {
      airbyte_instance: inst.label,
      connection_count: conns.length,
      connections: conns.map((c: Record<string, unknown>) => ({
        id: c.connectionId || c.id,
        name: c.name,
        status: c.status,
        schedule: (c.schedule as Record<string, unknown>)?.scheduleType || 'manual',
        streams: ((c.syncCatalog as Record<string, unknown>)?.streams as unknown[] || []).length,
      }))
    }
  }

  if (action === 'check_jobs') {
    const body: Record<string, unknown> = { configTypes: ['sync'], pagination: { pageSize: 5, rowOffset: 0 } }
    if (connectionId) body.connectionId = connectionId
    const data = await ab('/jobs/list', body)
    const jobs = data.jobs || data.data || []
    return {
      airbyte_instance: inst.label,
      recent_jobs: jobs.map((j: Record<string, unknown>) => {
        const job = (j.job || j) as Record<string, unknown>
        return {
          id: job.id,
          status: job.status,
          created: new Date((job.createdAt as number) * 1000).toISOString(),
          duration_min: Math.round(((job.updatedAt as number) - (job.createdAt as number)) / 60),
        }
      })
    }
  }

  if (action === 'trigger_sync') {
    if (!connectionId) return { error: 'connection_id required for trigger_sync' }
    const data = await ab('/connections/sync', { connectionId })
    return { ok: true, message: 'Sync triggered', job: data.job || data }
  }

  return { error: `Unknown action: ${action}` }
}

// ============================================================
// Schema cache + introspection (Bug 4.5 fix)
// ============================================================
//
// Pre-computes a lightweight schema summary per connection so the chat
// system prompt can include table/column hints — eliminating the 3-7
// schema-discovery tool calls Claude used to burn at the start of every
// conversation.
//
// Storage: app DB table `connection_schemas (connection_id TEXT PK,
// schema_json TEXT, fetched_at TEXT)` (created in lib/setup.ts).
//
// Refresh policy:
//   - Lazy: chat route calls getOrFetchSchema(); if stale (>24h) it
//     kicks off a background refresh and returns the stale copy.
//   - Eager: connections route calls refreshSchemaInBackground() on
//     create/update.
//   - Invalidation: connections route calls invalidateSchema() on
//     update/delete.

export type CachedSchema = {
  connection_id: string
  dialect: string
  fetched_at: string
  tables?: Array<{
    schema?: string
    name: string
    columns: Array<{ name: string; type: string; pk?: boolean }>
  }>
  measurements?: Array<{ name: string; tag_keys: string[]; field_keys: Array<{ name: string; type: string }> }>
  collections?: Array<{ name: string; sample_keys: Array<{ name: string; type: string }> }>
  truncated?: boolean
  error?: string
}

const SCHEMA_TTL_MS    = 24 * 60 * 60 * 1000
const MAX_TABLES       = 40
const MAX_COLS_PER_TBL = 30
const MAX_MEASUREMENTS = 30
const MAX_COLLECTIONS  = 30
const MAX_TAG_KEYS     = 20
const MAX_FIELD_KEYS   = 30

// Track in-flight refreshes so concurrent chat requests don't all kick
// off the same introspection.
const inFlight = new Map<string, Promise<CachedSchema>>()

export async function getCachedSchema(connectionId: string): Promise<CachedSchema | null> {
  const sql = getDb()
  try {
    const rows = await sql`SELECT schema_json, fetched_at FROM connection_schemas WHERE connection_id = ${connectionId}`
    if (!rows.length) return null
    const r = rows[0] as { schema_json: string | CachedSchema; fetched_at: string }
    // lib/db.ts auto-parses TEXT columns that look like JSON on the SQLite path,
    // so schema_json may arrive as a string (Postgres/Neon) or a pre-parsed
    // object (SQLite local). Handle both.
    try {
      const parsed = (typeof r.schema_json === 'string'
        ? JSON.parse(r.schema_json)
        : r.schema_json) as CachedSchema
      parsed.fetched_at = r.fetched_at
      return parsed
    } catch { return null }
  } catch { return null }
}

async function saveCachedSchema(schema: CachedSchema): Promise<void> {
  const sql = getDb()
  const payload = JSON.stringify(schema)
  const now = new Date().toISOString()
  // Portable upsert (works in SQLite + Neon): delete then insert.
  try {
    await sql`DELETE FROM connection_schemas WHERE connection_id = ${schema.connection_id}`
    await sql`INSERT INTO connection_schemas (connection_id, schema_json, fetched_at) VALUES (${schema.connection_id}, ${payload}, ${now})`
  } catch { /* table might not exist yet */ }
}

export async function invalidateSchema(connectionId: string): Promise<void> {
  const sql = getDb()
  try { await sql`DELETE FROM connection_schemas WHERE connection_id = ${connectionId}` }
  catch { /* ignore */ }
  inFlight.delete(connectionId)
}

function isFresh(s: CachedSchema | null): boolean {
  if (!s || !s.fetched_at) return false
  const ts = Date.parse(s.fetched_at)
  if (isNaN(ts)) return false
  return Date.now() - ts < SCHEMA_TTL_MS
}

/**
 * Returns the cached schema if fresh; otherwise returns the stale copy
 * (or null) and kicks off a background refresh. Never blocks the caller
 * for long. Safe to call from request hot paths.
 */
export async function getOrFetchSchema(connectionId: string): Promise<CachedSchema | null> {
  const cached = await getCachedSchema(connectionId)
  if (isFresh(cached)) return cached

  // Stale or missing — kick off background refresh (deduped).
  if (!inFlight.has(connectionId)) {
    const p = introspectSchema(connectionId)
      .then(async s => { await saveCachedSchema(s); return s })
      .catch(e => ({
        connection_id: connectionId,
        dialect: 'unknown',
        fetched_at: new Date().toISOString(),
        error: String(e?.message || e),
      } as CachedSchema))
      .finally(() => { inFlight.delete(connectionId) })
    inFlight.set(connectionId, p)
  }
  // Return whatever we have (stale or null) — don't block the chat request.
  return cached
}

/**
 * Eager refresh — fire-and-forget. Called from the connections route on
 * create/update so the cache is warm by the time the user opens chat.
 */
export function refreshSchemaInBackground(connectionId: string): void {
  if (inFlight.has(connectionId)) return
  const p = introspectSchema(connectionId)
    .then(async s => { await saveCachedSchema(s); return s })
    .catch(e => ({
      connection_id: connectionId,
      dialect: 'unknown',
      fetched_at: new Date().toISOString(),
      error: String(e?.message || e),
    } as CachedSchema))
    .finally(() => { inFlight.delete(connectionId) })
  inFlight.set(connectionId, p)
}

/**
 * Discover the schema of a single connection. Dispatches per dialect using
 * the same connection-loading conventions as queryDatabase().
 */
export async function introspectSchema(connectionId: string): Promise<CachedSchema> {
  const db = getDb()
  const rows = await db`SELECT * FROM db_connections WHERE id=${connectionId}`
  if (!rows.length) {
    return {
      connection_id: connectionId, dialect: 'unknown',
      fetched_at: new Date().toISOString(), error: 'connection not found',
    }
  }
  const conn = rows[0] as Record<string, unknown>
  const dialect = (conn.dialect as string) || 'postgres'
  const stamp = () => new Date().toISOString()

  try {
    // -- PostgreSQL ---------------------------------------------
    if (dialect === 'postgres') {
      let entry = pgPools.get(connectionId)
      if (!entry) {
        const connStr = decryptConnStr(conn) ||
          `postgresql://${conn.username}:${decrypt(conn.password_enc as string)}@${conn.host}:${conn.port}/${conn.database_name}`
        const pool = new Pool({
          connectionString: connStr,
          max: (conn.pool_max as number) || 5,
          connectionTimeoutMillis: (conn.connect_timeout_ms as number) || 5000,
          statement_timeout: (conn.query_timeout_ms as number) || 30000,
          ssl: getSslConfig(conn),
        })
        entry = { pool, lastUsed: Date.now() }
        pgPools.set(connectionId, entry)
      }
      entry.lastUsed = Date.now()
      const schemaName = (conn.schema_name as string) || 'public'
      const tables = await entry.pool.query(
        `SELECT table_schema, table_name
           FROM information_schema.tables
          WHERE table_type='BASE TABLE'
            AND table_schema NOT IN ('pg_catalog','information_schema')
            AND ($1='*' OR table_schema=$1)
          ORDER BY table_schema, table_name LIMIT ${MAX_TABLES + 1}`,
        [schemaName],
      )
      const truncated = tables.rows.length > MAX_TABLES
      const out: CachedSchema['tables'] = []
      for (const t of tables.rows.slice(0, MAX_TABLES)) {
        const cols = await entry.pool.query(
          `SELECT c.column_name, c.data_type,
                  EXISTS(
                    SELECT 1 FROM information_schema.table_constraints tc
                    JOIN information_schema.key_column_usage kcu
                      ON tc.constraint_name=kcu.constraint_name AND tc.table_schema=kcu.table_schema
                    WHERE tc.constraint_type='PRIMARY KEY'
                      AND tc.table_schema=c.table_schema AND tc.table_name=c.table_name
                      AND kcu.column_name=c.column_name
                  ) AS is_pk
             FROM information_schema.columns c
            WHERE c.table_schema=$1 AND c.table_name=$2
            ORDER BY c.ordinal_position LIMIT ${MAX_COLS_PER_TBL}`,
          [t.table_schema, t.table_name],
        )
        out.push({
          schema: t.table_schema, name: t.table_name,
          columns: cols.rows.map((r: { column_name: string; data_type: string; is_pk: boolean }) => ({
            name: r.column_name, type: r.data_type, pk: !!r.is_pk,
          })),
        })
      }
      return { connection_id: connectionId, dialect, fetched_at: stamp(), tables: out, truncated }
    }

    // -- MySQL --------------------------------------------------
    if (dialect === 'mysql') {
      const pool = await getMysqlPool(connectionId, conn)
      const dbName = conn.database_name as string
      const [tRowsRaw] = await pool.execute(
        `SELECT TABLE_NAME FROM information_schema.tables
          WHERE TABLE_SCHEMA = ? AND TABLE_TYPE='BASE TABLE'
          ORDER BY TABLE_NAME LIMIT ${MAX_TABLES + 1}`,
        [dbName],
      )
      const tRows = tRowsRaw as Array<{ TABLE_NAME: string }>
      const truncated = tRows.length > MAX_TABLES
      const out: CachedSchema['tables'] = []
      for (const t of tRows.slice(0, MAX_TABLES)) {
        const [cRowsRaw] = await pool.execute(
          `SELECT COLUMN_NAME, DATA_TYPE, COLUMN_KEY
             FROM information_schema.columns
            WHERE TABLE_SCHEMA=? AND TABLE_NAME=?
            ORDER BY ORDINAL_POSITION LIMIT ${MAX_COLS_PER_TBL}`,
          [dbName, t.TABLE_NAME],
        )
        const cRows = cRowsRaw as Array<{ COLUMN_NAME: string; DATA_TYPE: string; COLUMN_KEY: string }>
        out.push({
          schema: dbName, name: t.TABLE_NAME,
          columns: cRows.map(c => ({ name: c.COLUMN_NAME, type: c.DATA_TYPE, pk: c.COLUMN_KEY === 'PRI' })),
        })
      }
      return { connection_id: connectionId, dialect, fetched_at: stamp(), tables: out, truncated }
    }

    // -- SQL Server ---------------------------------------------
    if (dialect === 'mssql') {
      const mssql = await import('mssql')
      const pass = decrypt((conn.password_enc as string) || '')
      const config = {
        user: conn.username as string, password: pass,
        server: conn.host as string, port: (conn.port as number) || 1433,
        database: conn.database_name as string,
        options: {
          encrypt: (conn.ssl_mode as string) !== 'disable',
          trustServerCertificate: (conn.ssl_mode as string) !== 'verify-full',
        },
        connectionTimeout: (conn.connect_timeout_ms as number) || 5000,
        requestTimeout: (conn.query_timeout_ms as number) || 30000,
      }
      const pool = decryptConnStr(conn)
        ? await mssql.connect(decryptConnStr(conn)!)
        : await mssql.connect(config as Parameters<typeof mssql.connect>[0])
      try {
        const tRes = await pool.request().query(
          `SELECT TOP ${MAX_TABLES + 1} TABLE_SCHEMA, TABLE_NAME
             FROM information_schema.tables
            WHERE TABLE_TYPE='BASE TABLE'
            ORDER BY TABLE_SCHEMA, TABLE_NAME`,
        )
        const tRows = tRes.recordset as Array<{ TABLE_SCHEMA: string; TABLE_NAME: string }>
        const truncated = tRows.length > MAX_TABLES
        const out: CachedSchema['tables'] = []
        for (const t of tRows.slice(0, MAX_TABLES)) {
          const cRes = await pool.request()
            .input('s', t.TABLE_SCHEMA).input('n', t.TABLE_NAME)
            .query(
              `SELECT TOP ${MAX_COLS_PER_TBL} COLUMN_NAME, DATA_TYPE
                 FROM information_schema.columns
                WHERE TABLE_SCHEMA=@s AND TABLE_NAME=@n
                ORDER BY ORDINAL_POSITION`,
            )
          const cRows = cRes.recordset as Array<{ COLUMN_NAME: string; DATA_TYPE: string }>
          out.push({
            schema: t.TABLE_SCHEMA, name: t.TABLE_NAME,
            columns: cRows.map(c => ({ name: c.COLUMN_NAME, type: c.DATA_TYPE })),
          })
        }
        return { connection_id: connectionId, dialect, fetched_at: stamp(), tables: out, truncated }
      } finally { await pool.close() }
    }

    // -- SQLite -------------------------------------------------
    if (dialect === 'sqlite') {
      const Database = (await import('better-sqlite3')).default
      const rawPath = (decryptConnStr(conn) || conn.database_name) as string
      // Skip introspecting the in-memory sandbox — it's regenerated per-query
      // and its schema is already implicit in the system prompt.
      if (rawPath === '__sandbox__') {
        return {
          connection_id: connectionId, dialect, fetched_at: stamp(),
          tables: [
            { name: 'machines',         columns: [{ name: 'id', type: 'INTEGER', pk: true }, { name: 'name', type: 'TEXT' }, { name: 'type', type: 'TEXT' }, { name: 'line', type: 'TEXT' }, { name: 'status', type: 'TEXT' }] },
            { name: 'production_logs',  columns: [{ name: 'id', type: 'INTEGER', pk: true }, { name: 'machine_id', type: 'INTEGER' }, { name: 'shift_date', type: 'TEXT' }, { name: 'shift', type: 'TEXT' }, { name: 'units_produced', type: 'INTEGER' }, { name: 'units_target', type: 'INTEGER' }, { name: 'cycle_time_s', type: 'REAL' }, { name: 'oee_pct', type: 'REAL' }] },
            { name: 'downtime_events',  columns: [{ name: 'id', type: 'INTEGER', pk: true }, { name: 'machine_id', type: 'INTEGER' }, { name: 'started_at', type: 'TEXT' }, { name: 'duration_min', type: 'INTEGER' }, { name: 'reason', type: 'TEXT' }, { name: 'category', type: 'TEXT' }] },
            { name: 'quality_checks',   columns: [{ name: 'id', type: 'INTEGER', pk: true }, { name: 'machine_id', type: 'INTEGER' }, { name: 'check_date', type: 'TEXT' }, { name: 'defect_rate_pct', type: 'REAL' }, { name: 'inspector', type: 'TEXT' }] },
          ],
        }
      }
      const db2 = new Database(rawPath, { readonly: true })
      try {
        const tRows = db2.prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name LIMIT ${MAX_TABLES + 1}`
        ).all() as Array<{ name: string }>
        const truncated = tRows.length > MAX_TABLES
        const out: CachedSchema['tables'] = []
        for (const t of tRows.slice(0, MAX_TABLES)) {
          const cRows = db2.prepare(`PRAGMA table_info("${t.name.replace(/"/g, '""')}")`).all() as Array<{ name: string; type: string; pk: number }>
          out.push({
            name: t.name,
            columns: cRows.slice(0, MAX_COLS_PER_TBL).map(c => ({ name: c.name, type: c.type || 'ANY', pk: !!c.pk })),
          })
        }
        return { connection_id: connectionId, dialect, fetched_at: stamp(), tables: out, truncated }
      } finally { db2.close() }
    }

    // -- MongoDB ------------------------------------------------
    if (dialect === 'mongodb') {
      const { MongoClient } = await import('mongodb')
      const connStr = decryptConnStr(conn) ||
        `mongodb://${conn.username}:${decrypt((conn.password_enc as string) || '')}@${conn.host}:${conn.port}/${conn.database_name}`
      const client = new MongoClient(connStr, { serverSelectionTimeoutMS: (conn.connect_timeout_ms as number) || 5000 })
      try {
        await client.connect()
        const db2 = client.db(conn.database_name as string)
        const cols = await db2.listCollections({}, { nameOnly: true }).toArray()
        const truncated = cols.length > MAX_COLLECTIONS
        const out: CachedSchema['collections'] = []
        for (const c of cols.slice(0, MAX_COLLECTIONS)) {
          // Sample one doc per collection to extract top-level keys + types.
          const sample = await db2.collection(c.name).findOne({})
          const sample_keys = sample
            ? Object.entries(sample).slice(0, MAX_COLS_PER_TBL).map(([k, v]) => ({
                name: k,
                type: Array.isArray(v) ? 'array' : (v === null ? 'null' : typeof v),
              }))
            : []
          out.push({ name: c.name, sample_keys })
        }
        return { connection_id: connectionId, dialect, fetched_at: stamp(), collections: out, truncated }
      } finally { await client.close() }
    }

    // -- ClickHouse ---------------------------------------------
    if (dialect === 'clickhouse') {
      const protocol = (conn.ssl_mode as string) === 'disable' ? 'http' : 'https'
      const base = decryptConnStr(conn) || `${protocol}://${conn.host}:${conn.port || 8123}`
      const headers: Record<string, string> = { 'Accept': 'application/json' }
      if (conn.username) {
        headers['Authorization'] = 'Basic ' + Buffer.from(`${conn.username}:${decrypt((conn.password_enc as string) || '')}`).toString('base64')
      }
      const dbName = (conn.database_name as string) || 'default'
      const runQ = async (q: string) => {
        const url = new URL('/', base)
        url.searchParams.set('query', q)
        url.searchParams.set('default_format', 'JSONEachRow')
        const res = await fetch(url.toString(), { headers, signal: AbortSignal.timeout(10000) })
        if (!res.ok) throw new Error(`ClickHouse ${res.status}: ${(await res.text()).slice(0, 200)}`)
        return (await res.text()).trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
      }
      const tRows = await runQ(
        `SELECT name FROM system.tables WHERE database='${dbName.replace(/'/g, "''")}' ORDER BY name LIMIT ${MAX_TABLES + 1}`,
      ) as Array<{ name: string }>
      const truncated = tRows.length > MAX_TABLES
      const out: CachedSchema['tables'] = []
      for (const t of tRows.slice(0, MAX_TABLES)) {
        const cRows = await runQ(
          `SELECT name, type FROM system.columns WHERE database='${dbName.replace(/'/g, "''")}' AND table='${t.name.replace(/'/g, "''")}' ORDER BY position LIMIT ${MAX_COLS_PER_TBL}`,
        ) as Array<{ name: string; type: string }>
        out.push({ schema: dbName, name: t.name, columns: cRows.map(c => ({ name: c.name, type: c.type })) })
      }
      return { connection_id: connectionId, dialect, fetched_at: stamp(), tables: out, truncated }
    }

    // -- InfluxDB v1 --------------------------------------------
    if (dialect === 'influxdb') {
      // We only introspect v1 (InfluxQL). v2/Flux schema discovery is more
      // involved (buckets, schema.measurements()) — skip for now and rely on
      // the dialectHint in the system prompt for v2.
      const protocol = (conn.ssl_mode as string) === 'disable' ? 'http' : 'https'
      const base = decryptConnStr(conn) || `${protocol}://${conn.host}:${conn.port || 8086}`
      const token = decrypt((conn.password_enc as string) || '')
      const dbName = (conn.database_name as string) || 'default'
      const auth = conn.username
        ? 'Basic ' + Buffer.from(`${conn.username}:${token}`).toString('base64')
        : token ? `Token ${token}` : ''
      const runQ = async (q: string) => {
        const url = new URL('/query', base)
        url.searchParams.set('db', dbName)
        url.searchParams.set('q', q)
        const res = await fetch(url.toString(), {
          headers: { ...(auth ? { 'Authorization': auth } : {}), 'Accept': 'application/json' },
          signal: AbortSignal.timeout(10000),
        })
        if (!res.ok) throw new Error(`Influx ${res.status}: ${(await res.text()).slice(0, 200)}`)
        const j = await res.json() as { results?: Array<{ series?: Array<{ values: unknown[][] }> }> }
        return j.results?.[0]?.series?.[0]?.values || []
      }
      const measRows = await runQ('SHOW MEASUREMENTS') as Array<[string]>
      const truncated = measRows.length > MAX_MEASUREMENTS
      const out: CachedSchema['measurements'] = []
      for (const [name] of measRows.slice(0, MAX_MEASUREMENTS)) {
        const safe = String(name).replace(/"/g, '\\"')
        const tagRows = await runQ(`SHOW TAG KEYS FROM "${safe}"`) as Array<[string]>
        const fldRows = await runQ(`SHOW FIELD KEYS FROM "${safe}"`) as Array<[string, string]>
        out.push({
          name: String(name),
          tag_keys:    tagRows.slice(0, MAX_TAG_KEYS).map(r => String(r[0])),
          field_keys:  fldRows.slice(0, MAX_FIELD_KEYS).map(r => ({ name: String(r[0]), type: String(r[1]) })),
        })
      }
      return { connection_id: connectionId, dialect, fetched_at: stamp(), measurements: out, truncated }
    }

    return {
      connection_id: connectionId, dialect,
      fetched_at: stamp(),
      error: `dialect ${dialect} not supported by schema introspection`,
    }
  } catch (e) {
    return {
      connection_id: connectionId, dialect,
      fetched_at: stamp(),
      error: String((e as Error)?.message || e),
    }
  }
}

/**
 * Render a cached schema into a compact string for injection into the chat
 * system prompt. One line per table/measurement/collection; truncated where
 * needed to stay under a reasonable token budget per connection.
 */
export function formatSchemaForPrompt(schema: CachedSchema | null, opts: { maxChars?: number } = {}): string {
  if (!schema) return ''
  if (schema.error) return `    schema: (introspection failed: ${schema.error})`
  const max = opts.maxChars ?? 2500
  const lines: string[] = []

  if (schema.tables?.length) {
    lines.push(`    tables (${schema.tables.length}${schema.truncated ? '+' : ''}):`)
    for (const t of schema.tables) {
      const cols = t.columns.map(c => c.pk ? `${c.name}*:${c.type}` : `${c.name}:${c.type}`).join(', ')
      const qualified = t.schema && t.schema !== 'public' && t.schema !== schema.dialect ? `${t.schema}.${t.name}` : t.name
      lines.push(`      ${qualified}(${cols})`)
    }
  }
  if (schema.measurements?.length) {
    lines.push(`    measurements (${schema.measurements.length}${schema.truncated ? '+' : ''}):`)
    for (const m of schema.measurements) {
      const fields = m.field_keys.map(f => `${f.name}:${f.type}`).join(',')
      const tags = m.tag_keys.join(',')
      lines.push(`      ${m.name} | tags=[${tags}] fields=[${fields}]`)
    }
  }
  if (schema.collections?.length) {
    lines.push(`    collections (${schema.collections.length}${schema.truncated ? '+' : ''}):`)
    for (const c of schema.collections) {
      const keys = c.sample_keys.map(k => `${k.name}:${k.type}`).join(', ')
      lines.push(`      ${c.name}(${keys})`)
    }
  }

  let out = lines.join('\n')
  if (out.length > max) {
    out = out.slice(0, max - 20) + '\n      … (truncated)'
  }
  return out
}


// -- Chart artifact ---------------------------------------------
//
// renderChart is a pure passthrough -- it validates the input shape and
// wraps it in a { kind: 'chart_artifact', spec } envelope. The chat UI
// (components/ChartArtifact.tsx) recognises this envelope in tool results
// and renders an actual chart instead of stringifying the JSON.
//
// We do NOT generate any chart server-side; the spec is the contract
// between Claude and the renderer. Adding a new chart type means
// updating both: this schema and the renderer component.

export interface ChartSpec {
  type: 'bar' | 'line' | 'pie' | 'kpi' | 'table'
  title: string
  subtitle?: string
  data?: Array<Record<string, unknown>>
  value?: string | number
  label?: string
  delta?: { value: number; direction: 'up' | 'down'; label?: string }
  columns?: Array<{ key: string; label: string; format?: 'number' | 'currency' | 'percent' | 'text' }>
  rows?: Array<Record<string, unknown>>
}

export interface ChartArtifact {
  kind: 'chart_artifact'
  spec: ChartSpec
}

function renderChart(input: Record<string, unknown>): ChartArtifact {
  const spec = input as unknown as ChartSpec
  if (!spec.type || !spec.title) {
    throw new Error('render_chart requires type and title')
  }
  return { kind: 'chart_artifact', spec }
}
