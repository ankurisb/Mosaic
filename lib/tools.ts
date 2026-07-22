import type Anthropic from '@anthropic-ai/sdk'
import { log } from './logger'
import { getDb } from './db'
import { getKey } from './keys'
import { emitToolCall, type MeteringEventData } from './metering'
import {
  applyDataAccessRules,
  checkActionAllowed,
  isHITLRequired,
  wrapQueryResultsForSafety,
  stripBlockedColumnsFromResult,
  type GuardrailAuditCtx,
} from './guardrails'
import { decrypt } from './encrypt'
import { getPrismToken, invalidatePrismToken } from './api-auth'
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
    name: 'run_statistical_analysis',
    description: `Run statistical analysis on data retrieved from a previous query_database call.
Use AFTER fetching data when the question requires mathematical computation beyond simple aggregation.
Available: control_chart, process_capability, trend, anomaly_detection, changepoint_detection, pareto, correlation, regression, weibull, mtbf, oee_decomposition, hypothesis_test.
Pass the rows array directly from the previous query result as the data parameter.
IMPORTANT: After running statistical analysis, present results as narrative or table — do NOT call render_chart unless the user explicitly asks for a chart. Exceptions: pareto benefits from a bar chart; control_chart benefits from a line chart showing UCL/LCL. All other types should be text/table only.`,
    input_schema: {
      type: 'object',
      properties: {
        analysis_type: {
          type: 'string',
          description: 'Type of analysis. One of: control_chart, process_capability, trend, anomaly_detection, changepoint_detection, pareto, correlation, regression, weibull, mtbf, oee_decomposition, hypothesis_test',
        },
        data: {
          type: 'array',
          description: 'Array of data points from a previous query_database call. Can be numbers or objects.',
        },
        params: {
          type: 'object',
          description: 'Analysis-specific parameters e.g. {lsl:9.95, usl:10.05} for process_capability; {threshold:7.5} for trend; {group_labels:[...]} for hypothesis_test',
        },
      },
      required: ['analysis_type', 'data'],
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
  {
    name: 'query_prism',
    description: `Query a connected Prism IoT platform instance for device data, asset information, telemetry, alarms, or dashboards.
Use this tool when the user asks about IoT devices, sensors, real-time or historical telemetry, energy assets, alarms, or anything relating to a Prism instance.

Operations:
- telemetry_latest    — Latest values for one or more telemetry keys on a device. Use when user asks "what is the current X".
- telemetry_history   — Historical timeseries for keys over a time range. Use when user asks for trends, charts, or historical data.
- attributes          — Server-scope attributes for a device (configuration, rated capacity, tariffs, etc).
- devices             — List all devices, optionally filtered by customer or asset.
- assets              — List all assets in the platform.
- customers           — List all customers/tenants.
- alarms              — Active or recent alarms for a device or the whole instance.
- dashboards          — List available dashboards.

Always use telemetry_latest before telemetry_history when the user just wants the current value.
For time ranges use Unix ms timestamps (startTs/endTs). If not given, default to last 24 hours.`,
    input_schema: {
      type: 'object',
      properties: {
        instance_id: { type: 'string', description: 'Prism instance ID from settings. If only one is configured, omit this and the tool will use it automatically.' },
        operation: { type: 'string', enum: ['telemetry_latest', 'telemetry_history', 'attributes', 'devices', 'assets', 'customers', 'alarms', 'dashboards'], description: 'What to fetch.' },
        entity_id: { type: 'string', description: 'Device or asset UUID. Required for telemetry_latest, telemetry_history, attributes, alarms.' },
        entity_type: { type: 'string', enum: ['DEVICE', 'ASSET'], description: 'Entity type. Defaults to DEVICE for telemetry operations.' },
        keys: { type: 'array', items: { type: 'string' }, description: 'Telemetry keys to fetch, e.g. ["stack_soc", "stack_power"]. For telemetry_latest and telemetry_history.' },
        startTs: { type: 'number', description: 'Start timestamp in Unix ms. For telemetry_history.' },
        endTs: { type: 'number', description: 'End timestamp in Unix ms. For telemetry_history.' },
        limit: { type: 'number', description: 'Max data points to return. Default 1000 for history, 1 for latest.' },
        agg: { type: 'string', enum: ['NONE', 'AVG', 'MIN', 'MAX', 'SUM', 'COUNT'], description: 'Aggregation function for telemetry_history. Default NONE.' },
        interval: { type: 'number', description: 'Aggregation interval in ms. Only used with agg != NONE.' },
        customer_id: { type: 'string', description: 'Filter devices/assets by customer ID.' },
        page_size: { type: 'number', description: 'Page size for list operations (devices, assets, customers). Default 100.' },
      },
      required: ['operation']
    },
  },
  {
    name: 'query_mcp',
    description: `Call a tool on a connected MCP (Model Context Protocol) server. Use this for bespoke/custom data sources registered under Settings → Data sources → MCP servers.

The system prompt lists each MCP server (by connection_id) and the tools it exposes. To use one:
1. Pick the connection_id of the server whose data you need.
2. Pick the tool_name from that server's listed tools.
3. Pass the tool's arguments as an object.

Only use tool names that are listed for that connection. If unsure what a server offers, the available tools are shown in the MCP servers section of the system prompt.`,
    input_schema: {
      type: 'object',
      properties: {
        connection_id: { type: 'string', description: 'The MCP connection id (from the MCP servers list in the system prompt).' },
        tool_name: { type: 'string', description: 'The name of the tool to call on that MCP server.' },
        arguments: { type: 'object', description: 'Arguments object for the tool, matching that tool\'s input schema. Use {} if the tool takes no arguments.' },
      },
      required: ['connection_id', 'tool_name']
    },
  },
]

export async function runTool(
  name: string,
  input: Record<string, unknown>,
  guardrailCtx?: { userId: string; userEmail: string; userRole: string; conversationId?: string }
): Promise<unknown> {
  const role = guardrailCtx?.userRole || 'user'
  const auditCtx: GuardrailAuditCtx | undefined = guardrailCtx
    ? { userId: guardrailCtx.userId, userEmail: guardrailCtx.userEmail, userRole: role, conversationId: guardrailCtx.conversationId }
    : undefined

  // Type 3 — Action controls: check before every tool call
  try {
    const method = name === 'call_api' ? String(input.method || 'GET') : undefined
    const sqlQ = name === 'query_database' ? String(input.sql || '') : undefined
    const srcId = String(input.connection_id || input.server_id || input.service_id || '')
    const actionCheck = await checkActionAllowed(name, method, sqlQ, srcId, role, auditCtx)
    if (!actionCheck.allowed) {
      return { error: actionCheck.reason, blocked: true }
    }
  } catch { /* non-blocking */ }

  // Per-tool metering: emit one tool_call event per invocation, so billing can
  // meter individual tool use (per database query, API call, etc.) — not just
  // the aggregate chat_completion. Fire-and-forget; no-op unless OPENMETER_URL
  // is set. Keyed on user_id (the billable subject).
  if (guardrailCtx?.userId) {
    const srcMap: Record<string, MeteringEventData['source_type']> = {
      query_database: 'database', call_api: 'api', read_file_server: 'file_server',
      query_prism: 'prism', web_search: 'web_search', run_statistical_analysis: 'stats',
    }
    emitToolCall(guardrailCtx.userId, name, srcMap[name], {
      conversation_id: guardrailCtx.conversationId,
      source_id: String(input.connection_id || input.server_id || input.service_id || '') || undefined,
    })
  }

  switch (name) {
    case 'web_search': return webSearch(String(input.query))

    case 'query_database': {
      const srcId = String(input.connection_id || '')
      // Type 2 — data access rules (pre-query: table whitelist, column block, row filter)
      try {
        const accessCheck = await applyDataAccessRules(String(input.sql || ''), srcId, 'database', role, auditCtx)
        if (!accessCheck.allowed) return { error: accessCheck.reason, blocked: true }
        if (accessCheck.modified && accessCheck.modifiedQuery) input = { ...input, sql: accessCheck.modifiedQuery }
      } catch { }
      // Execute
      const result = await queryDatabase(srcId, String(input.sql))
      // Post-query: strip any blocked columns from returned results (defence-in-depth)
      try { return await stripBlockedColumnsFromResult(result, srcId, 'database', role) } catch { return result }
    }

    case 'call_api': {
      const srcId = String(input.connection_id || input.service_id || '')
      // Type 2 — data access rules for API sources
      try {
        const accessCheck = await applyDataAccessRules(String(input.path || ''), srcId, 'api', role, auditCtx)
        if (!accessCheck.allowed) return { error: accessCheck.reason, blocked: true }
      } catch { }
      // Type 7 — HITL: require confirmation for write API calls
      try {
        if (guardrailCtx && await isHITLRequired('call_api', String(input.method || 'GET'))) {
          return {
            __hitl_required: true,
            pending_description: `API call: ${String(input.method || 'GET').toUpperCase()} ${String(input.path || '/')}`,
            tool_name: name,
            tool_input: input,
          }
        }
      } catch { }
      return callApi(srcId, String(input.method), String(input.path), input.body as Record<string, unknown> | undefined)
    }

    case 'read_file_server': {
      const srcId = String(input.server_id || '')
      // Type 2 — data access rules for file server sources
      try {
        const accessCheck = await applyDataAccessRules(String(input.file_hint || ''), srcId, 'file_server', role, auditCtx)
        if (!accessCheck.allowed) return { error: accessCheck.reason, blocked: true }
      } catch { }
      const result = await readFileServer(srcId, String(input.file_hint), { ts_strategy: input.ts_strategy, extract: input.extract, max_rows: input.max_rows, file_type: input.file_type } as Record<string, unknown>)
      // Post-read: strip blocked columns from file results
      try { return await stripBlockedColumnsFromResult(result, srcId, 'file_server', role) } catch { return result }
    }

    case 'query_prism': {
      const srcId = String((input as Record<string, unknown>).instance_id || '')
      // Type 2 — data access rules for Prism IoT sources
      try {
        const accessCheck = await applyDataAccessRules(String(input.query || JSON.stringify(input)), srcId, 'api', role, auditCtx)
        if (!accessCheck.allowed) return { error: accessCheck.reason, blocked: true }
      } catch { }
      const result = await queryPrism(input)
      try { return await stripBlockedColumnsFromResult(result, srcId, 'api', role) } catch { return result }
    }

    case 'query_airbyte': return queryAirbyte(String(input.action), input.instance_id as string | undefined, input.connection_id as string | undefined)
    case 'query_mcp': {
      const srcId = String(input.connection_id || '')
      // Data-access rules apply to MCP sources too (governance parity with other types).
      try {
        const accessCheck = await applyDataAccessRules(JSON.stringify(input.arguments || {}), srcId, 'api', role, auditCtx)
        if (!accessCheck.allowed) return { error: accessCheck.reason, blocked: true }
      } catch { }
      return queryMcpConnection(srcId, String(input.tool_name), (input.arguments as Record<string, unknown>) || {})
    }
    case 'run_statistical_analysis': return runStatisticalAnalysis(input.analysis_type as string, input.data as unknown[], input.params as Record<string,unknown> | undefined)
    case 'render_chart': return renderChart(input)
    default: throw new Error(`Unknown tool: ${name}`)
  }
}

// -- Web search ------------------------------------------------
// Provider-aware. SEARCH_PROVIDER selects the backend; each provider's key is
// read via getKey so it can be set at runtime in Settings -> API Keys (not just
// .env). Both providers are normalised to the same {title, url, snippet} shape
// the tool caller expects, even though their raw responses differ: Tavily
// returns ranked result snippets; Perplexity (Sonar) returns a synthesised
// answer plus source citations.
type SearchHit = { title: string; url: string; snippet: string }

async function tavilySearch(query: string, apiKey: string): Promise<SearchHit[]> {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, query, max_results: 5 }),
  })
  if (!res.ok) throw new Error(`Tavily error ${res.status}`)
  const data = await res.json()
  return (data.results || []).map((r: { title: string; url: string; content: string }) => ({
    title: r.title, url: r.url, snippet: String(r.content || '').slice(0, 400),
  }))
}

async function perplexitySearch(query: string, apiKey: string): Promise<SearchHit[]> {
  // Sonar is an OpenAI-compatible chat endpoint with built-in web grounding;
  // the answer comes back as message content and the sources as citations.
  const res = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'sonar',
      messages: [
        { role: 'system', content: 'Answer concisely using current web information.' },
        { role: 'user', content: query },
      ],
    }),
  })
  if (!res.ok) throw new Error(`Perplexity error ${res.status}`)
  const data = await res.json()
  const answer = String(data.choices?.[0]?.message?.content || '').trim()
  // search_results (title+url) is richer than the bare citations array; fall
  // back to citations if only those are present.
  const results: SearchHit[] = Array.isArray(data.search_results)
    ? data.search_results.slice(0, 5).map((r: { title?: string; url: string }) => ({
        title: r.title || r.url, url: r.url, snippet: '',
      }))
    : (data.citations || []).slice(0, 5).map((url: string) => ({ title: url, url, snippet: '' }))
  // Lead with the synthesised answer as the first "hit" so the model gets the
  // grounded summary, then the sources for attribution.
  return [{ title: 'Answer', url: '', snippet: answer.slice(0, 800) }, ...results]
}

async function webSearch(query: string): Promise<SearchHit[]> {
  const provider = ((await getKey('SEARCH_PROVIDER')) || 'tavily').toLowerCase()

  if (provider === 'perplexity') {
    const key = await getKey('PERPLEXITY_API_KEY')
    if (key) return perplexitySearch(query, key)
    return [{ title: 'Search not configured', url: '', snippet: 'Perplexity is selected as the search provider but no PERPLEXITY_API_KEY is set. Add one in Settings → API Keys, or switch the provider to Tavily.' }]
  }

  // Default: Tavily
  const key = await getKey('TAVILY_API_KEY')
  if (key) return tavilySearch(query, key)
  return [{ title: 'Search not configured', url: '', snippet: 'No web search key is set. Add a Tavily or Perplexity key in Settings → API Keys.' }]
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


// -- Generic MCP connection executor -----------------------------------------
// Calls an arbitrary tool on a registered MCP connection (from the
// mcp_connections table). Unlike queryViaMcp above (which is SQL-over-MCP for
// database dialects), this is transport for ANY MCP server: the AI supplies a
// tool name and arguments, we call tools/call, and normalise the result.
// -- Production MCP client (Streamable HTTP transport) ------------------------
// Real remote MCP servers require the full lifecycle, not a bare tools/list:
//   1. initialize  -> server returns capabilities + an Mcp-Session-Id header
//   2. notifications/initialized (ack; no response body)
//   3. tools/list / tools/call  -- every call carries the Mcp-Session-Id
// Servers may reply with application/json OR text/event-stream (SSE), so we
// send both in Accept and parse either. This is what makes MCP connections
// work against spec-compliant servers (hf.co/mcp, Cloudflare, etc.), not just
// trivial single-POST mocks.

const MCP_PROTOCOL_VERSION = '2025-06-18'

// Parse an MCP HTTP response body that may be JSON or an SSE stream. For SSE we
// take the last `data:` line's JSON (the JSON-RPC response for our id).
function parseMcpBody(contentType: string, text: string): Record<string, unknown> | null {
  if (contentType.includes('text/event-stream')) {
    const dataLines = text.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).filter(Boolean)
    for (let i = dataLines.length - 1; i >= 0; i--) {
      try { const j = JSON.parse(dataLines[i]); if (j && (j.result !== undefined || j.error !== undefined)) return j } catch { /* keep scanning */ }
    }
    return null
  }
  try { return JSON.parse(text) } catch { return null }
}

interface McpSession { endpoint: string; token?: string; sessionId?: string }

async function mcpRpc(session: McpSession, method: string, params: Record<string, unknown>, isNotification = false, timeoutMs = 30000): Promise<Record<string, unknown> | null> {
  const msg: Record<string, unknown> = { jsonrpc: '2.0', method, params }
  if (!isNotification) msg.id = 1
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
  }
  if (session.token) headers['Authorization'] = `Bearer ${session.token}`
  if (session.sessionId) headers['Mcp-Session-Id'] = session.sessionId

  const res = await fetch(session.endpoint, {
    method: 'POST', headers, body: JSON.stringify(msg), signal: AbortSignal.timeout(timeoutMs),
  })
  const sid = res.headers.get('mcp-session-id')
  if (sid) session.sessionId = sid

  if (isNotification) return null
  if (!res.ok) throw new Error(`MCP server returned HTTP ${res.status}`)
  const text = await res.text()
  const body = parseMcpBody(res.headers.get('content-type') || '', text)
  if (!body) throw new Error('MCP server returned an unparseable response')
  if (body.error) throw new Error(`MCP error: ${(body.error as { message?: string }).message || JSON.stringify(body.error)}`)
  return body
}

async function mcpConnect(endpoint: string, token?: string, timeoutMs = 15000): Promise<McpSession> {
  const session: McpSession = { endpoint, token }
  await mcpRpc(session, 'initialize', {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'mosaic', version: '1.0' },
  }, false, timeoutMs)
  try { await mcpRpc(session, 'notifications/initialized', {}, true, timeoutMs) } catch { /* non-fatal */ }
  return session
}

// -- Generic MCP connection executor -----------------------------------------
async function queryMcpConnection(connectionId: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
  const sql = getDb()
  const rows = await sql`SELECT label, endpoint_url, token_enc, enabled FROM mcp_connections WHERE id=${connectionId}`
  if (!rows.length) throw new Error('MCP connection not found')
  const conn = rows[0] as { label: string; endpoint_url: string; token_enc: string | null; enabled: number | boolean }
  if (!conn.enabled) throw new Error(`MCP connection "${conn.label}" is disabled`)

  const token = conn.token_enc ? decrypt(conn.token_enc) : undefined
  const session = await mcpConnect(conn.endpoint_url, token)
  const body = await mcpRpc(session, 'tools/call', { name: toolName, arguments: args || {} })
  const result = (body?.result ?? null) as Record<string, unknown> | null
  if (!result) throw new Error('MCP server returned no result')

  const content = result.content as Array<{ type: string; text?: string }> | undefined
  if (content && Array.isArray(content)) {
    const textBlock = content.find(c => c.type === 'text')
    if (textBlock?.text) {
      try { return { result: JSON.parse(textBlock.text), via: 'mcp', connection: conn.label } }
      catch { return { result: textBlock.text, via: 'mcp', connection: conn.label } }
    }
    return { result: content, via: 'mcp', connection: conn.label }
  }
  return { result, via: 'mcp', connection: conn.label }
}

async function listMcpConnectionTools(endpoint: string, token?: string): Promise<Array<{ name: string; description?: string; input_schema?: unknown }>> {
  try {
    const session = await mcpConnect(endpoint, token, 10000)
    const body = await mcpRpc(session, 'tools/list', {}, false, 10000)
    const tools = ((body?.result as { tools?: Array<{ name: string; description?: string; inputSchema?: unknown }> })?.tools) || []
    return tools.map(t => ({ name: t.name, description: t.description, input_schema: t.inputSchema }))
  } catch { return [] }
}

export async function getMcpTools(connectionId: string, endpoint: string): Promise<Array<{ name: string; description?: string; input_schema?: unknown }>> {
  try {
    const sql = getDb()
    const rows = await sql`SELECT token_enc FROM mcp_connections WHERE id=${connectionId}`
    const enc = rows.length ? (rows[0] as { token_enc: string | null }).token_enc : null
    const token = enc ? decrypt(enc) : undefined
    return listMcpConnectionTools(endpoint, token)
  } catch { return [] }
}

export async function testMcpEndpoint(endpoint: string, token?: string): Promise<{ ok: boolean; tools?: string[]; error?: string }> {
  try {
    // Do the handshake directly (not via listMcpConnectionTools, which swallows
    // errors into []) so a 401/404/405/timeout surfaces as a real failure rather
    // than a misleading "ok, no tools".
    const session = await mcpConnect(endpoint, token, 12000)
    const body = await mcpRpc(session, 'tools/list', {}, false, 12000)
    const tools = ((body?.result as { tools?: Array<{ name: string }> })?.tools) || []
    return { ok: true, tools: tools.map(t => t.name) }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// Truncate individual cell values that are excessively long (e.g. CLOB columns,
// base64 blobs, HTML bodies) to prevent single rows from blowing out context.
const MAX_CELL_CHARS = 500
const MAX_RESULT_ROWS = 200

function sanitiseRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  if (!rows.length) return rows
  return rows.slice(0, MAX_RESULT_ROWS).map(row => {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(row)) {
      if (typeof v === 'string' && v.length > MAX_CELL_CHARS) {
        out[k] = v.slice(0, MAX_CELL_CHARS) + `…[${v.length - MAX_CELL_CHARS} chars truncated]`
      } else {
        out[k] = v
      }
    }
    return out
  })
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
  if (dialect !== 'mongodb' && dialect !== 'elasticsearch') {
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
    return { rows: sanitiseRows(result.rows), rowCount: result.rowCount, fields: result.fields.map(f => f.name) }
  }

  // -- MySQL ----------------------------------------------------
  if (dialect === 'mysql') {
    const pool = await getMysqlPool(connectionId, conn)
    const [results, fields] = await pool.execute(`SELECT * FROM (${trimmed}) _q LIMIT 200`)
    return {
      rows: sanitiseRows(results as Record<string,unknown>[]),
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
      const results = sanitiseRows(stmt.all() as Record<string,unknown>[])
      const fields = results.length > 0 ? Object.keys(results[0]) : []
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
      const rawResults = await cursor.toArray()
      const results = sanitiseRows(rawResults as Record<string,unknown>[])
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


  // -- Elasticsearch -------------------------------------------
  if (dialect === 'elasticsearch') {
    const protocol = (conn.ssl_mode as string) === 'disable' ? 'http' : 'https'
    const base = decryptConnStr(conn) || `${protocol}://${conn.host}:${conn.port || 9200}`

    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Accept': 'application/json' }

    // Auth: API key (sentinel: username === '__apikey__') or Basic
    if (conn.username === '__apikey__') {
      headers['Authorization'] = `ApiKey ${decrypt((conn.password_enc as string) || '')}`
    } else if (conn.username) {
      headers['Authorization'] = 'Basic ' + Buffer.from(`${conn.username}:${decrypt((conn.password_enc as string) || '')}`).toString('base64')
    }

    // GET requests: schema/index discovery
    // Claude uses these before querying:
    //   GET /_cat/indices?format=json       -> list all indices
    //   GET /{index}/_mapping               -> field structure
    //   GET /_cluster/health                -> cluster status
    if (trimmed.toUpperCase().startsWith('GET ')) {
      const path = trimmed.slice(4).trim()
      const res = await fetch(`${base}${path.startsWith('/') ? '' : '/'}${path}`, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout((conn.query_timeout_ms as number) || 30000),
      })
      if (!res.ok) {
        const err = await res.text()
        throw new Error(`Elasticsearch error ${res.status}: ${err.slice(0, 200)}`)
      }
      const data = await res.json()
      const rows = Array.isArray(data) ? data : [data]
      return { rows, rowCount: rows.length, fields: rows.length > 0 ? Object.keys(rows[0]) : [] }
    }

    // Query DSL: JSON body posted to /{index}/_search
    let queryBody: Record<string, unknown>
    try {
      queryBody = JSON.parse(trimmed)
    } catch {
      throw new Error('Elasticsearch queries must be JSON Query DSL, e.g. {"query":{"match_all":{}}} or start with GET for discovery.')
    }

    const index = (conn.database_name as string) || '_all'
    const searchUrl = `${base}/${index}/_search`

    const res = await fetch(searchUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ size: 100, ...queryBody }),
      signal: AbortSignal.timeout((conn.query_timeout_ms as number) || 30000),
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Elasticsearch error ${res.status}: ${err.slice(0, 200)}`)
    }

    const data = await res.json()

    if (data.error) {
      throw new Error(`Elasticsearch query error: ${data.error.reason || JSON.stringify(data.error).slice(0, 200)}`)
    }

    // Aggregations: return directly without hits
    if (data.aggregations) {
      const rows = [{ aggregations: data.aggregations, took_ms: data.took, total: data.hits?.total?.value }]
      return { rows, rowCount: 1, fields: ['aggregations', 'took_ms', 'total'] }
    }

    const hits = (data.hits?.hits || []).map((h: Record<string, unknown>) => ({
      _id: h._id,
      _score: h._score,
      ...(h._source as object),
    }))
    const fields = hits.length > 0 ? Object.keys(hits[0]) : []
    return { rows: hits, rowCount: data.hits?.total?.value ?? hits.length, fields }
  }

  throw new Error(`Unsupported dialect: ${dialect}. Supported: postgres, mysql, mssql, sqlite, mongodb, clickhouse, influxdb, elasticsearch.`)
}

// -- Statistical Analysis ------------------------------------
async function runStatisticalAnalysis(
  analysisType: string,
  data: unknown[],
  params?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const statsUrl = process.env.STATS_SIDECAR_URL || 'http://localhost:8001'
  const res = await fetch(`${statsUrl}/analyse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ analysis_type: analysisType, data, params: params || {} }),
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Stats sidecar error ${res.status}: ${err.slice(0, 200)}`)
  }
  const result = await res.json()
  if (!result.ok) {
    throw new Error(`Statistical analysis failed: ${result.error || 'unknown error'}`)
  }
  return result
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
  const authResult = await applyAuth(conn.service_id as string, authType, authConfig, headers, conn.base_url as string)
  if (!authResult.ok) throw new Error((authResult as { ok: false; error: string }).error)
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
    // Hard cap: never return more than 200 records to Claude's context
    const MAX_RECORDS = 200
    if (Array.isArray(data) && data.length > MAX_RECORDS) {
      return { _capped: true, _total: data.length, _returned: MAX_RECORDS, data: data.slice(0, MAX_RECORDS) }
    }
    if (data && typeof data === 'object') {
      const obj = data as Record<string, unknown>
      // Auto-detect the array key (handles any envelope: invoices, contacts, equipment, purchase_orders, etc.)
      const arrayKey = Object.keys(obj).find(k => Array.isArray(obj[k]) && (obj[k] as unknown[]).length > 0 && typeof (obj[k] as unknown[])[0] === 'object')
      if (arrayKey && (obj[arrayKey] as unknown[]).length > MAX_RECORDS) {
        return { ...obj, [arrayKey]: (obj[arrayKey] as unknown[]).slice(0, MAX_RECORDS), _capped: true, _total: (obj[arrayKey] as unknown[]).length, _returned: MAX_RECORDS }
      }
    }
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


// -- SharePoint / Microsoft Graph helpers ---------------------
async function getSharePointToken(fs: Record<string, unknown>): Promise<string> {
  const tenantId    = fs.tenant_id    as string
  const clientId    = fs.client_id    as string
  const clientSecret = fs.password_enc ? decrypt(fs.password_enc as string) : (fs.password as string || '')

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error('SharePoint auth requires tenant_id, client_id, and client secret (password field)')
  }

  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     clientId,
      client_secret: clientSecret,
      scope:         'https://graph.microsoft.com/.default',
    }).toString(),
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`SharePoint auth failed (${res.status}): ${err.slice(0, 200)}`)
  }
  const data = await res.json() as { access_token: string }
  return data.access_token
}

// Resolve SharePoint site ID from a site URL like https://tenant.sharepoint.com/sites/MySite
async function getSharePointSiteId(token: string, siteUrl: string): Promise<string> {
  // Graph API: GET /v1.0/sites/{hostname}:/{server-relative-path}
  const url = new URL(siteUrl)
  const hostname = url.hostname
  const sitePath = url.pathname // e.g. /sites/MySite
  const graphUrl = `https://graph.microsoft.com/v1.0/sites/${hostname}:${sitePath}`
  const res = await fetch(graphUrl, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`SharePoint site lookup failed (${res.status}) for ${siteUrl}`)
  const data = await res.json() as { id: string }
  return data.id
}

// List files in a SharePoint document library / folder path
async function listSharePointFiles(
  token: string, siteId: string, folderPath: string,
  allowedExts: string[], maxCount: number
): Promise<FileEntry[]> {
  // GET /v1.0/sites/{site-id}/drive/root:/{folder}:/children
  const encoded = folderPath ? encodeURIComponent(folderPath) : ''
  const graphUrl = encoded
    ? `https://graph.microsoft.com/v1.0/sites/${siteId}/drive/root:/${encoded}:/children`
    : `https://graph.microsoft.com/v1.0/sites/${siteId}/drive/root/children`

  const res = await fetch(`${graphUrl}?$top=${maxCount}&$select=name,size,lastModifiedDateTime,@microsoft.graph.downloadUrl,file`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`SharePoint list failed (${res.status}): ${err.slice(0, 200)}`)
  }

  const data = await res.json() as { value: Array<{ name: string; size: number; lastModifiedDateTime: string; file?: unknown; '@microsoft.graph.downloadUrl'?: string }> }
  const files: FileEntry[] = []

  for (const item of data.value || []) {
    if (!item.file) continue // skip folders
    const ext = '.' + (item.name.split('.').pop()?.toLowerCase() || '')
    if (allowedExts.length && !allowedExts.includes(ext)) continue
    files.push({
      name:      item.name,
      path:      item['@microsoft.graph.downloadUrl'] || item.name,
      size:      item.size || 0,
      modified:  item.lastModifiedDateTime || '',
      timestamp: item.lastModifiedDateTime ? new Date(item.lastModifiedDateTime) : undefined,
    })
    if (files.length >= maxCount) break
  }
  return files
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


  if (transport === 'sharepoint') {
    try {
      const token   = await getSharePointToken(fs)
      const siteUrl = (fs.endpoint_url as string) || (fs.host as string) || ''
      if (!siteUrl) return []
      const siteId  = await getSharePointSiteId(token, siteUrl)
      const folder  = (fs.sub_path as string) || (fs.share_path as string) || ''
      const maxF = (fs.max_files as number) || 20
      const exts  = filterExt ? [filterExt.toLowerCase()] : fileTypes.map(t => '.' + t.replace(/^\./, ''))
      return await listSharePointFiles(token, siteId, folder, exts, maxF)
    } catch (e) {
      log.error({ service: 'tools', err: (e as Error).message }, 'sharepoint listFiles error')
      return []
    }
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
  if (transport === 'sharepoint') {
    // filePath here is the pre-signed download URL returned by listSharePointFiles
    const token = await getSharePointToken(fs)
    // If filePath is a full URL (download URL), fetch directly; otherwise resolve via Graph
    const isUrl = filePath.startsWith('https://')
    const fetchUrl = isUrl
      ? filePath
      : (() => {
          const siteUrl = (fs.endpoint_url as string) || (fs.host as string) || ''
          const folder  = (fs.sub_path as string) || (fs.share_path as string) || ''
          const relativePath = folder ? `${folder}/${filePath}` : filePath
          return `https://graph.microsoft.com/v1.0/sites/__placeholder__/drive/root:/${encodeURIComponent(relativePath)}:/content`
        })()
    const res = await fetch(fetchUrl, {
      headers: isUrl ? {} : { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) throw new Error(`SharePoint file fetch failed (${res.status}): ${filePath}`)
    return Buffer.from(await res.arrayBuffer())
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
    instances = await sql`SELECT id, label, url, username, password_enc, workspace_id FROM airbyte_instances WHERE active = true ORDER BY created_at ASC`
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

    // -- Elasticsearch ----------------------------------------
    if (dialect === 'elasticsearch') {
      const protocol = (conn.ssl_mode as string) === 'disable' ? 'http' : 'https'
      const base = decryptConnStr(conn) || `${protocol}://${conn.host}:${conn.port || 9200}`
      const headers: Record<string, string> = { 'Accept': 'application/json', 'Content-Type': 'application/json' }
      if (conn.username === '__apikey__') {
        headers['Authorization'] = `ApiKey ${decrypt((conn.password_enc as string) || '')}`
      } else if (conn.username) {
        headers['Authorization'] = 'Basic ' + Buffer.from(`${conn.username}:${decrypt((conn.password_enc as string) || '')}`).toString('base64')
      }

      // Get all indices (exclude hidden .* indices)
      const catRes = await fetch(`${base}/_cat/indices?format=json&expand_wildcards=open`, {
        headers, signal: AbortSignal.timeout(10000),
      })
      if (!catRes.ok) throw new Error(`Elasticsearch ${catRes.status}: ${(await catRes.text()).slice(0, 200)}`)
      const indices = await catRes.json() as Array<{ index: string; 'docs.count': string }>
      const visible = indices.filter(i => !i.index.startsWith('.')).slice(0, MAX_TABLES)
      const truncated = visible.length < indices.filter(i => !i.index.startsWith('.')).length

      const out: CachedSchema['collections'] = []
      for (const idx of visible) {
        // Fetch mapping for each index to get field names + types
        const mapRes = await fetch(`${base}/${idx.index}/_mapping`, {
          headers, signal: AbortSignal.timeout(10000),
        })
        if (!mapRes.ok) continue
        const mapData = await mapRes.json() as Record<string, { mappings: { properties?: Record<string, { type?: string }> } }>
        const props = mapData[idx.index]?.mappings?.properties || {}
        const sample_keys = Object.entries(props).slice(0, MAX_COLS_PER_TBL).map(([k, v]) => ({
          name: k,
          type: (v.type || 'object') + (v.type === 'text' ? ' (full-text searchable)' : v.type === 'keyword' ? ' (exact match/aggregations)' : ''),
        }))
        out.push({
          name: `${idx.index} (${idx['docs.count'] || '?'} docs)`,
          sample_keys,
        })
      }
      return { connection_id: connectionId, dialect, fetched_at: stamp(), collections: out, truncated }
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

  // Generate dialect-aware example query using actual field names
  const exampleQuery = generateExampleQuery(schema)
  if (exampleQuery) lines.push(exampleQuery)

  let out = lines.join('\n')
  if (out.length > max) {
    out = out.slice(0, max - 20) + '\n      … (truncated)'
  }
  return out
}

function generateExampleQuery(schema: CachedSchema): string {
  const d = schema.dialect

  // SQL dialects — use first table with a numeric column
  if (['postgres','mysql','mssql','sqlite','clickhouse'].includes(d) && schema.tables?.length) {
    const t = schema.tables[0]
    const numCol = t.columns.find(c => /int|float|real|double|decimal|numeric|number/i.test(c.type) && !c.pk)
    const dateCol = t.columns.find(c => /date|time|timestamp/i.test(c.name) || /date|time|timestamp/i.test(c.type))
    const pkCol = t.columns.find(c => c.pk)
    const qualified = t.schema && t.schema !== 'public' ? `${t.schema}.${t.name}` : t.name
    if (numCol && dateCol) {
      return `    example: SELECT ${pkCol?.name || t.columns[0]?.name}, ${dateCol.name}, ${numCol.name} FROM ${qualified} WHERE ${dateCol.name} >= datetime('now','-7 days') ORDER BY ${dateCol.name} DESC LIMIT 100`
    } else if (numCol) {
      return `    example: SELECT ${t.columns.slice(0,4).map(c=>c.name).join(', ')} FROM ${qualified} ORDER BY ${numCol.name} DESC LIMIT 100`
    }
    return `    example: SELECT ${t.columns.slice(0,4).map(c=>c.name).join(', ')} FROM ${qualified} LIMIT 100`
  }

  // InfluxDB — use first measurement with field keys
  if (d === 'influxdb' && schema.measurements?.length) {
    const m = schema.measurements[0]
    const field = m.field_keys[0]?.name
    const tag = m.tag_keys[0]
    if (field && tag) {
      return `    example: SELECT mean("${field}") FROM "${m.name}" WHERE time > now()-7d GROUP BY time(1h), "${tag}"`
    } else if (field) {
      return `    example: SELECT mean("${field}") FROM "${m.name}" WHERE time > now()-24h GROUP BY time(1h)`
    }
  }

  // MongoDB — use first collection with sample keys
  if (d === 'mongodb' && schema.collections?.length) {
    const c = schema.collections[0]
    const dateKey = c.sample_keys.find(k => /date|time|created|updated/i.test(k.name))
    const projection = c.sample_keys.slice(0,4).map(k => `"${k.name}":1`).join(', ')
    if (dateKey) {
      return `    example: {"collection":"${c.name}","filter":{"${dateKey.name}":{"$gte":"now-7d"}},"projection":{${projection}},"limit":20}`
    }
    return `    example: {"collection":"${c.name}","filter":{},"projection":{${projection}},"limit":20}`
  }

  // Elasticsearch — use first index with text/keyword fields
  if (d === 'elasticsearch' && schema.collections?.length) {
    const idx = schema.collections[0]
    // strip " (N docs)" suffix to get index name
    const idxName = idx.name.split(' (')[0]
    const textField = idx.sample_keys.find(k => k.type?.includes('full-text'))
    const dateField = idx.sample_keys.find(k => k.type?.includes('date') || /time|date/i.test(k.name))
    const kwField = idx.sample_keys.find(k => k.type?.includes('exact match'))
    if (textField && dateField) {
      return `    example: {"query":{"bool":{"must":[{"match":{"${textField.name}":"keyword"}},{"range":{"${dateField.name}":{"gte":"now-7d"}}}]}},"size":20}`
    } else if (kwField) {
      return `    example: {"query":{"term":{"${kwField.name}":"value"}},"size":20}`
    }
    return `    example: GET /${idxName}/_mapping (discover fields first)`
  }

  return ''
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

// -- Prism IoT query -------------------------------------------

async function queryPrism(input: Record<string, unknown>): Promise<unknown> {
  const db = getDb()

  // Resolve instance — use explicit id or fall back to single active instance
  let instance: Record<string, unknown> | null = null
  if (input.instance_id) {
    const rows = await db`SELECT * FROM prism_instances WHERE id = ${String(input.instance_id)} AND active = true`
    instance = rows[0] ?? null
  } else {
    const rows = await db`SELECT * FROM prism_instances WHERE active = true ORDER BY created_at ASC LIMIT 1`
    instance = rows[0] ?? null
  }
  if (!instance) return { error: 'No active Prism instance found. Add one in Settings → Data sources → Prism.' }

  const base = (instance.base_url as string).replace(/\/$/, '')
  const username = instance.username as string
  const password = instance.password_enc ? decrypt(instance.password_enc as string) : ''
  const instanceId = instance.id as string

  // getPrismToken handles in-memory cache, DB-seeded cold-start, and refresh automatically
  const authConfig: Record<string, string> = { username, password }
  const tokenResult = await getPrismToken(instanceId, base, authConfig)
  if (!tokenResult.ok) return { error: (tokenResult as { ok: false; error: string }).error }
  const token = (tokenResult as { ok: true; token: string }).token
  const hdr = { 'X-Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }

  const op = String(input.operation || '')
  const entityId = input.entity_id ? String(input.entity_id) : null
  const entityType = String(input.entity_type || 'DEVICE')
  const pageSize = Number(input.page_size || 100)

  async function tbGet(path: string): Promise<unknown> {
    const res = await fetch(`${base}${path}`, { headers: hdr, signal: AbortSignal.timeout(30000) })
    if (res.status === 401) {
      invalidatePrismToken(instanceId)
      return { error: 'Prism session expired — retry the request' }
    }
    if (!res.ok) {
      const text = await res.text()
      return { error: `Prism API error ${res.status}: ${text.slice(0, 200)}` }
    }
    return res.json()
  }

  switch (op) {

    case 'telemetry_latest': {
      if (!entityId) return { error: 'entity_id required for telemetry_latest' }
      const keys = Array.isArray(input.keys) && input.keys.length ? (input.keys as string[]).join(',') : ''
      const path = `/api/plugins/telemetry/${entityType}/${entityId}/values/timeseries`
        + (keys ? `?keys=${encodeURIComponent(keys)}&useStrictDataTypes=true` : '?useStrictDataTypes=true')
      const data = await tbGet(path) as Record<string, { ts: number; value: unknown }[]>
      if ('error' in (data as Record<string,unknown>)) return data
      // Flatten to { key: { value, timestamp } }
      const result: Record<string, { value: unknown; timestamp: string }> = {}
      for (const [k, pts] of Object.entries(data)) {
        if (pts?.length) result[k] = { value: pts[0].value, timestamp: new Date(pts[0].ts).toISOString() }
      }
      return { entity_id: entityId, entity_type: entityType, telemetry: result }
    }

    case 'telemetry_history': {
      if (!entityId) return { error: 'entity_id required for telemetry_history' }
      const keys = Array.isArray(input.keys) && input.keys.length ? (input.keys as string[]).join(',') : ''
      if (!keys) return { error: 'keys required for telemetry_history' }
      const endTs = Number(input.endTs || Date.now())
      const startTs = Number(input.startTs || endTs - 86400000)
      const limit = Number(input.limit || 1000)
      const agg = String(input.agg || 'NONE')
      const interval = input.interval ? `&interval=${input.interval}` : ''
      const path = `/api/plugins/telemetry/${entityType}/${entityId}/values/timeseries`
        + `?keys=${encodeURIComponent(keys)}&startTs=${startTs}&endTs=${endTs}`
        + `&limit=${limit}&agg=${agg}&orderBy=ASC&useStrictDataTypes=true${interval}`
      const data = await tbGet(path) as Record<string, { ts: number; value: unknown }[]>
      if ('error' in (data as Record<string,unknown>)) return data
      // Return condensed series: { key: [{ts, value},...] }
      return { entity_id: entityId, entity_type: entityType, startTs, endTs, series: data }
    }

    case 'attributes': {
      if (!entityId) return { error: 'entity_id required for attributes' }
      const scopes = ['SERVER_SCOPE', 'SHARED_SCOPE', 'CLIENT_SCOPE']
      const results: Record<string, unknown> = {}
      for (const scope of scopes) {
        const data = await tbGet(`/api/plugins/telemetry/${entityType}/${entityId}/values/attributes/${scope}`) as unknown[]
        if (Array.isArray(data)) {
          for (const attr of data as { key: string; value: unknown }[]) {
            results[attr.key] = attr.value
          }
        }
      }
      return { entity_id: entityId, entity_type: entityType, attributes: results }
    }

    case 'devices': {
      const customerFilter = input.customer_id ? `/customer/${input.customer_id}` : ''
      const path = `/api${customerFilter}/tenant/devices?pageSize=${pageSize}&page=0`
      const data = await tbGet(path) as { data: unknown[]; totalElements: number }
      if ('error' in (data as Record<string,unknown>)) return data
      return {
        total: data.totalElements,
        devices: (data.data || []).map((d: Record<string,unknown>) => ({
          id: (d.id as Record<string,unknown>)?.id,
          name: d.name,
          type: d.type,
          label: d.label,
          active: d.active,
        }))
      }
    }

    case 'assets': {
      const customerFilter = input.customer_id ? `/customer/${input.customer_id}` : ''
      const path = `/api${customerFilter}/tenant/assets?pageSize=${pageSize}&page=0`
      const data = await tbGet(path) as { data: unknown[]; totalElements: number }
      if ('error' in (data as Record<string,unknown>)) return data
      return {
        total: data.totalElements,
        assets: (data.data || []).map((a: Record<string,unknown>) => ({
          id: (a.id as Record<string,unknown>)?.id,
          name: a.name,
          type: a.type,
          label: a.label,
        }))
      }
    }

    case 'customers': {
      const data = await tbGet(`/api/customers?pageSize=${pageSize}&page=0`) as { data: unknown[]; totalElements: number }
      if ('error' in (data as Record<string,unknown>)) return data
      return {
        total: data.totalElements,
        customers: (data.data || []).map((c: Record<string,unknown>) => ({
          id: (c.id as Record<string,unknown>)?.id,
          title: c.title,
          email: c.email,
          phone: c.phone,
        }))
      }
    }

    case 'alarms': {
      const entityPath = entityId ? `/${entityType}/${entityId}` : ''
      const path = entityId
        ? `/api/alarm${entityPath}?pageSize=${pageSize}&page=0&searchStatus=ANY&fetchOriginator=true`
        : `/api/alarms?pageSize=${pageSize}&page=0&searchStatus=ACTIVE&fetchOriginator=true`
      const data = await tbGet(path) as { data: unknown[]; totalElements: number }
      if ('error' in (data as Record<string,unknown>)) return data
      return {
        total: data.totalElements,
        alarms: (data.data || []).map((a: Record<string,unknown>) => ({
          id: (a.id as Record<string,unknown>)?.id,
          type: a.type,
          severity: a.severity,
          status: a.status,
          originator: (a.originator as Record<string,unknown>)?.entityType + ':' + (a.originator as Record<string,unknown>)?.id,
          originatorName: a.originatorName,
          createdTime: a.createdTime ? new Date(a.createdTime as number).toISOString() : null,
          details: a.details,
        }))
      }
    }

    case 'dashboards': {
      const data = await tbGet(`/api/tenant/dashboards?pageSize=${pageSize}&page=0`) as { data: unknown[]; totalElements: number }
      if ('error' in (data as Record<string,unknown>)) return data
      return {
        total: data.totalElements,
        dashboards: (data.data || []).map((d: Record<string,unknown>) => ({
          id: (d.id as Record<string,unknown>)?.id,
          title: d.title,
          assignedCustomers: d.assignedCustomers,
        }))
      }
    }

    default:
      return { error: `Unknown Prism operation: ${op}` }
  }
}

function renderChart(input: Record<string, unknown>): ChartArtifact {
  const spec = input as unknown as ChartSpec
  if (!spec.type || !spec.title) {
    throw new Error('render_chart requires type and title')
  }
  return { kind: 'chart_artifact', spec }
}
