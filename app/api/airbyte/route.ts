// app/api/airbyte/route.ts
// Full Airbyte OSS API integration.
// Public API:  GET/POST http://localhost:8000/api/public/v1/...
// Config API:  POST     http://localhost:8000/api/v1/...  (fallback)

import { getSession }        from '@/lib/auth'
import { canAccessSurface }  from '@/lib/permissions'
import { getDb, nowExpr, isPostgres } from '@/lib/db'
import { encrypt, decrypt }  from '@/lib/encrypt'
export const runtime = 'nodejs'

// ── OAuth2 token cache ────────────────────────────────────────
const tokenCache = new Map<string, { token: string; expiresAt: number }>()

type AirbyteInstance = {
  id: string
  url: string
  username: string
  password_enc?: string | null
  client_id?: string | null
  client_secret_enc?: string | null
  workspace_id?: string | null
  [key: string]: unknown
}

async function getOAuthToken(base: string, clientId: string, clientSecret: string): Promise<string> {
  const cacheKey = `${base}:${clientId}`
  const cached = tokenCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now() + 30000) return cached.token

  // Token endpoint differs by Airbyte flavour:
  //   - Airbyte Cloud (api.airbyte.com):  /v1/applications/token   (no /api prefix)
  //   - Self-hosted abctl / Kubernetes:   /api/v1/applications/token
  //   - Some builds expose the public API: /api/public/v1/applications/token
  // Try all three so the same client works against Cloud and self-hosted.
  const urls = [
    `${base}/v1/applications/token`,
    `${base}/api/v1/applications/token`,
    `${base}/api/public/v1/applications/token`,
  ]
  let lastErr = ''
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret }),
        signal: AbortSignal.timeout(10000),
      })
      if (res.ok) {
        // A 200 isn't enough: some Airbyte flavours (abctl) serve their web UI at
        // /v1/... and return 200 with HTML for a non-API path. Only accept a real
        // JSON token response; otherwise treat it as a miss and try the next URL.
        const ct = res.headers.get('content-type') || ''
        if (ct.includes('application/json')) {
          const data = await res.json() as { access_token: string; expires_in?: number }
          if (data && data.access_token) {
            const expiresAt = Date.now() + ((data.expires_in || 840) * 1000) // 14 min default (tokens expire in 15)
            tokenCache.set(cacheKey, { token: data.access_token, expiresAt })
            return data.access_token
          }
        }
        lastErr = `${res.status} from ${url}: non-JSON or tokenless response (likely a UI route)`
        continue
      }
      const errTxt = await res.text().catch(() => '')
      lastErr = `${res.status} from ${url}: ${errTxt.slice(0, 100)}`
    } catch (e) {
      lastErr = (e as Error).message
    }
  }
  throw new Error(`OAuth token exchange failed: ${lastErr}`)
}

// ── Dual-API client ───────────────────────────────────────────
// Supports both:
//   1. abctl/Kubernetes: OAuth2 client credentials (client_id + client_secret stored as username + password)
//   2. Docker Compose: Basic auth (airbyte:password)
// Tries public API first, falls back to legacy config API
async function ab(
  inst: AirbyteInstance,
  publicPath: string,
  configPath: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'GET',
  body?: unknown,
  timeoutMs = 15000
): Promise<unknown> {
  const base     = inst.url.replace(/\/$/, '')
  const password = inst.password_enc ? decrypt(inst.password_enc) : 'password'

  // Detect abctl mode: if password looks like a long random string (not 'password')
  // and we have a client_id, use OAuth2. Otherwise use Basic auth.
  // We store client_id in the username field and client_secret in password for abctl mode
  // OR: detect by trying OAuth2 token endpoint first
  let authHeader: string

  // Try OAuth2 if credentials look like abctl (long random password, email-style username)
  const looksLikeAbctl = inst.username.includes('@') || (password.length > 20 && password !== 'password')
  
  if (looksLikeAbctl) {
    try {
      // For abctl: username = email (not used for OAuth), 
      // we need client_id and client_secret
      // Store them: client_id in inst.client_id, or derive from known field
      // For now, try to exchange using the stored credentials as client credentials
      const clientId = (inst as any).client_id || inst.username
      const clientSecret = (inst as any).client_secret_enc ? decrypt((inst as any).client_secret_enc) : password
      const token = await getOAuthToken(base, clientId, clientSecret)
      authHeader = `Bearer ${token}`
    } catch {
      // Fall back to basic auth
      authHeader = `Basic ${Buffer.from(`${inst.username}:${password}`).toString('base64')}`
    }
  } else {
    authHeader = `Basic ${Buffer.from(`${inst.username}:${password}`).toString('base64')}`
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': authHeader,
  }

  const attempts = [
    // Airbyte Cloud (api.airbyte.com) serves the public API at /v1 (no /api prefix).
    { url: `${base}/v1${publicPath}`,            method },
    // Self-hosted abctl / public-API builds:
    { url: `${base}/api/public/v1${publicPath}`, method },
    { url: `${base}/api/v1${configPath}`,        method: 'POST' as const },
  ]

  let lastErr = ''
  for (const a of attempts) {
    try {
      const hasBody = ['POST','PUT','PATCH'].includes(a.method) && body !== undefined
      const res = await fetch(a.url, {
        method: a.method,
        headers,
        body: hasBody ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (res.ok) {
        // Guard against a UI route answering 200 with HTML (abctl serves its web
        // app at /v1/...). Only accept JSON; otherwise fall through to the next URL.
        const ct = res.headers.get('content-type') || ''
        const txt = await res.text()
        if (!ct.includes('application/json') && !/^\s*[[{]/.test(txt)) {
          lastErr = `${res.status} from ${a.url}: non-JSON response (likely a UI route)`
          continue
        }
        return txt ? JSON.parse(txt) : {}
      }
      const errTxt = await res.text().catch(() => '')
      lastErr = `${res.status} ${res.statusText}${errTxt ? ': ' + errTxt.slice(0, 120) : ''}`
    } catch (e) {
      lastErr = (e as Error).message
    }
  }
  throw new Error(lastErr || 'Airbyte unreachable')
}

// ── Table setup ───────────────────────────────────────────────
async function ensureTable() {
  const sql = getDb()
  // On Postgres the schema is owned by setup-pg.ts (airbyte_instances is
  // created there with gen_random_uuid ids + BOOLEAN active). This SQLite-
  // specific DDL (hex(randomblob), INTEGER active) would error there, so skip.
  if (isPostgres()) return
  await sql`CREATE TABLE IF NOT EXISTS airbyte_instances (
    id                TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
    label             TEXT NOT NULL DEFAULT 'Local Airbyte',
    url               TEXT NOT NULL DEFAULT 'http://localhost:8000',
    username          TEXT NOT NULL DEFAULT 'airbyte',
    password_enc      TEXT,
    client_id         TEXT,
    client_secret_enc TEXT,
    workspace_id      TEXT,
    active            INTEGER NOT NULL DEFAULT 1,
    last_synced       TEXT,
    created_at        TEXT DEFAULT (datetime('now'))
  )`.catch(() => {})
  // Add new columns if upgrading from older schema
  await sql`ALTER TABLE airbyte_instances ADD COLUMN client_id TEXT`.catch(() => {})
  await sql`ALTER TABLE airbyte_instances ADD COLUMN client_secret_enc TEXT`.catch(() => {})
  return sql
}

// ── Instance helpers ──────────────────────────────────────────
async function getInstance(sql: ReturnType<typeof getDb>, id: string) {
  const rows = await sql`SELECT * FROM airbyte_instances WHERE id = ${id}`
  if (!rows.length) throw new Error('Instance not found')
  return rows[0] as AirbyteInstance
}

async function getWorkspaceId(sql: ReturnType<typeof getDb>, inst: AirbyteInstance): Promise<string> {
  if (inst.workspace_id) return inst.workspace_id as string
  const data = await ab(inst as any, '/workspaces', '/workspaces/list', 'GET') as any
  const ws = data.data || data.workspaces || []
  const wsId = (ws[0]?.workspaceId || ws[0]?.id || '') as string
  if (wsId) {
    await sql`UPDATE airbyte_instances SET workspace_id = ${wsId} WHERE id = ${inst.id}`
    inst.workspace_id = wsId
  }
  return wsId
}

// ── GET ───────────────────────────────────────────────────────
export async function GET(req: Request) {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  if (!(await canAccessSurface({ id: session.id, role: session.role }, 'airbyte')))
    return Response.json({ error: 'No access to data pipelines' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action') || 'list'
  const id     = searchParams.get('id')
  const sql    = await ensureTable()

  // ── List instances
  if (action === 'list') {
    const rows = await sql`SELECT id, label, url, username, workspace_id, active, last_synced, created_at FROM airbyte_instances ORDER BY created_at ASC`
    return Response.json({ instances: rows })
  }

  // All other actions need an instance id
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })
  let inst: AirbyteInstance
  try { inst = await getInstance(sql, id) }
  catch { return Response.json({ error: 'Not found' }, { status: 404 }) }

  // ── Health check using /health endpoint
  if (action === 'ping') {
    try {
      // Use workspaces as health check - /health may not require auth but workspaces confirms full auth works
      const wsData = await ab(inst, '/workspaces', '/workspaces/list', 'GET') as any
      const ws = wsData.data || wsData.workspaces || []
      // Auto-cache workspace_id if we got one
      if (ws.length > 0 && !inst.workspace_id) {
        const wsId = ws[0].workspaceId || ws[0].id
        await sql`UPDATE airbyte_instances SET workspace_id = ${wsId} WHERE id = ${id}`
      }
      return Response.json({ ok: true, workspaceCount: ws.length })
    } catch (e) {
      return Response.json({ ok: false, error: (e as Error).message })
    }
  }

  // ── Workspaces: list all workspaces (id + name) and flag the one Mosaic uses.
  // An Airbyte account can have several workspaces; Mosaic reads sources/
  // connections from ONE (inst.workspace_id). Surfacing them lets the user see
  // and switch which workspace is active, so they don't create sources in a
  // workspace Mosaic isn't looking at.
  if (action === 'workspaces') {
    try {
      const data = await ab(inst, '/workspaces', '/workspaces/list', 'GET') as any
      const ws = (data.data || data.workspaces || []).map((w: any) => ({
        id: w.workspaceId || w.id,
        name: w.name || w.slug || w.workspaceId || w.id,
        active: (w.workspaceId || w.id) === inst.workspace_id,
      }))
      return Response.json({ workspaces: ws, activeWorkspaceId: inst.workspace_id || (ws[0]?.id ?? null) })
    } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 500 })
    }
  }

  // ── Sources list
  if (action === 'sources') {
    try {
      const wsId = await getWorkspaceId(sql, inst)
      const data = await ab(inst, `/sources?workspaceIds=${wsId}&limit=100`, '/sources/list', 'GET', { workspaceId: wsId }) as any
      return Response.json({ sources: data.data || data.sources || [] })
    } catch (e) { return Response.json({ error: (e as Error).message }, { status: 500 }) }
  }

  // ── Source detail
  if (action === 'source' && searchParams.get('sourceId')) {
    try {
      const srcId = searchParams.get('sourceId')
      const data = await ab(inst, `/sources/${srcId}`, '/sources/get', 'GET', { sourceId: srcId }) as any
      return Response.json({ source: data })
    } catch (e) { return Response.json({ error: (e as Error).message }, { status: 500 }) }
  }

  // ── Source definitions (connector catalog from live Airbyte instance)
  if (action === 'source_definitions') {
    try {
      const wsId = await getWorkspaceId(sql, inst)
      const data = await ab(inst,
        '/source_definitions',
        '/source_definitions/list_for_workspace',
        'GET',
        { workspaceId: wsId }
      ) as any
      const defs = data.data || data.sourceDefinitions || []
      return Response.json({ definitions: defs })
    } catch (e) {
      const msg = (e as Error).message || ''
      // Airbyte Cloud's public API does not expose the connector catalog
      // (source_definitions) or the connector builder — those are self-hosted /
      // Enterprise only. Rather than surface a raw "403 Forbidden", explain the
      // boundary so it reads as an intentional edition difference, not a failure.
      const isCloud = /(^|\.)airbyte\.com/i.test(inst.url)
      if (isCloud && /403|forbidden/i.test(msg)) {
        return Response.json({
          error: 'catalog_unavailable_on_cloud',
          message: 'Browsing and creating connectors from the catalog isn\u2019t available on Airbyte Cloud. On Cloud, create your sources in the Airbyte Cloud web app; Mosaic then reads the synced data. To create connectors directly from Mosaic — including the AI custom-connector builder — use a self-hosted Airbyte (the Enterprise edition bundles one).',
          cloud: true,
        }, { status: 409 })
      }
      return Response.json({ error: msg }, { status: 500 })
    }
  }

  // ── Source definition spec (config schema for a connector type)
  if (action === 'source_spec' && searchParams.get('definitionId')) {
    try {
      const defId = searchParams.get('definitionId')
      // Airbyte's /source_definition_specifications/get REQUIRES workspaceId —
      // without it the API returns 500 and the config form comes back empty.
      const wsId = await getWorkspaceId(sql, inst)
      const data = await ab(inst,
        `/source_definitions/${defId}/specification`,
        '/source_definition_specifications/get',
        'GET',
        { sourceDefinitionId: defId, workspaceId: wsId }
      ) as any
      return Response.json({ spec: data.connectionSpecification || data.spec || data })
    } catch (e) { return Response.json({ error: (e as Error).message }, { status: 500 }) }
  }

  // ── Destinations list
  if (action === 'destinations') {
    try {
      const wsId = await getWorkspaceId(sql, inst)
      const data = await ab(inst, `/destinations?workspaceIds=${wsId}&limit=100`, '/destinations/list', 'GET', { workspaceId: wsId }) as any
      return Response.json({ destinations: data.data || data.destinations || [] })
    } catch (e) { return Response.json({ error: (e as Error).message }, { status: 500 }) }
  }

  // ── Connections list
  if (action === 'connections') {
    try {
      const wsId = await getWorkspaceId(sql, inst)
      const data = await ab(inst, `/connections?workspaceIds=${wsId}&limit=100`, '/connections/list', 'GET', { workspaceId: wsId }) as any
      return Response.json({ connections: data.data || data.connections || [] })
    } catch (e) { return Response.json({ error: (e as Error).message }, { status: 500 }) }
  }

  // ── Connection detail
  if (action === 'connection' && searchParams.get('connectionId')) {
    try {
      const cid = searchParams.get('connectionId')
      const data = await ab(inst, `/connections/${cid}`, '/connections/get', 'GET', { connectionId: cid }) as any
      return Response.json({ connection: data })
    } catch (e) { return Response.json({ error: (e as Error).message }, { status: 500 }) }
  }

  // ── Stream schema for a source
  if (action === 'streams' && searchParams.get('sourceId')) {
    try {
      const srcId = searchParams.get('sourceId')
      const data = await ab(inst,
        `/streams?sourceId=${srcId}`,
        '/sources/discover_schema',
        'GET',
        { sourceId: srcId },
        90000
      ) as any
      // Response shape varies by API surface:
      //  - Public API GET /streams: a bare ARRAY of stream configs
      //  - Public API sometimes wraps as { data: [...] }
      //  - Config API discover_schema: { catalog: { streams: [...] } }
      const streams = Array.isArray(data)
        ? data
        : (data.data || data.catalog?.streams || data.streams || data.streams?.streams || [])
      return Response.json({ streams })
    } catch (e) { return Response.json({ error: (e as Error).message }, { status: 500 }) }
  }

  // ── Jobs list
  if (action === 'jobs') {
    try {
      const cid = searchParams.get('connectionId')
      const publicQ = cid ? `/jobs?limit=20&connectionId=${cid}` : `/jobs?limit=20`
      const data = await ab(inst, publicQ, '/jobs/list', 'GET',
        { configTypes: ['sync'], pagination: { pageSize: 20, rowOffset: 0 },
          ...(cid ? { connectionId: cid } : {}) }) as any
      return Response.json({ jobs: data.data || data.jobs || [] })
    } catch (e) { return Response.json({ error: (e as Error).message }, { status: 500 }) }
  }

  // ── Single job status
  if (action === 'job' && searchParams.get('jobId')) {
    try {
      const jobId = searchParams.get('jobId')
      const data = await ab(inst, `/jobs/${jobId}`, '/jobs/get', 'GET', { id: Number(jobId) }) as any
      return Response.json({ job: data.job || data })
    } catch (e) { return Response.json({ error: (e as Error).message }, { status: 500 }) }
  }

  // ── Pipelines: connections enriched with latest job status
  // Returns each connection with source name, destination name, last job
  // Used by the new pipeline cards UI — single call replaces 3 separate fetches
  if (action === 'pipelines') {
    try {
      const wsId = await getWorkspaceId(sql, inst)

      // Fetch connections, sources, destinations in parallel
      const [connData, srcData, destData] = await Promise.all([
        ab(inst, `/connections?workspaceIds=${wsId}&limit=100`, '/connections/list', 'GET', { workspaceId: wsId }),
        ab(inst, `/sources?workspaceIds=${wsId}&limit=100`, '/sources/list', 'GET', { workspaceId: wsId }),
        ab(inst, `/destinations?workspaceIds=${wsId}&limit=100`, '/destinations/list', 'GET', { workspaceId: wsId }),
      ]) as any[]

      const connections = connData.data || connData.connections || []
      const sources     = srcData.data || srcData.sources || []
      const dests       = destData.data || destData.destinations || []

      // Index sources and destinations by id for quick lookup
      const srcMap  = Object.fromEntries(sources.map((s: any) => [s.sourceId || s.id, s]))
      const destMap = Object.fromEntries(dests.map((d: any) => [d.destinationId || d.id, d]))

      // Fetch latest job for each connection in parallel (cap at 20 connections)
      const enriched = await Promise.all(
        connections.slice(0, 20).map(async (c: any) => {
          const cid = c.connectionId || c.id
          const src  = srcMap[c.sourceId] || {}
          const dest = destMap[c.destinationId] || {}
          let lastJob: any = null
          try {
            const jobData = await ab(inst,
              `/jobs?limit=1&connectionId=${cid}`,
              '/jobs/list', 'GET',
              { configTypes: ['sync'], pagination: { pageSize: 1, rowOffset: 0 }, connectionId: cid }
            ) as any
            const jobs = jobData.data || jobData.jobs || []
            if (jobs.length > 0) lastJob = jobs[0]
          } catch { /* skip if jobs fail */ }

          return {
            connectionId:    cid,
            name:            c.name || `${src.name || 'Source'} → ${dest.name || 'Destination'}`,
            status:          c.status || 'unknown',
            schedule:        c.schedule || null,
            sourceId:        c.sourceId,
            sourceName:      src.name || '',
            sourceType:      src.sourceName || src.sourceType || '',
            destinationId:   c.destinationId,
            destinationName: dest.name || '',
            destinationType: dest.destinationName || dest.destinationType || '',
            lastJob: lastJob ? {
              id:         lastJob.jobId || lastJob.id,
              status:     lastJob.status || lastJob.job?.status || 'unknown',
              createdAt:  lastJob.startedAt || lastJob.createdAt || lastJob.job?.createdAt,
              updatedAt:  lastJob.lastUpdatedAt || lastJob.updatedAt || lastJob.job?.updatedAt,
              recordsSynced: lastJob.recordsSynced || lastJob.job?.aggregatedStats?.recordsSynced || null,
            } : null,
          }
        })
      )

      return Response.json({ pipelines: enriched })
    } catch (e) { return Response.json({ error: (e as Error).message }, { status: 500 }) }
  }

  // ── Source definition spec (for dynamic add-source form)
  if (action === 'source_spec' && searchParams.get('definitionId')) {
    const defId = searchParams.get('definitionId') || ''
    // Mock specs for dev/testing
    const MOCK_SPECS: Record<string, unknown> = {
      'mock-postgres':    { required: ['host','port','database','username'], properties: { host: { type: 'string', title: 'Host', examples: ['localhost'] }, port: { type: 'integer', title: 'Port', default: 5432 }, database: { type: 'string', title: 'Database name' }, username: { type: 'string', title: 'Username' }, password: { type: 'string', title: 'Password', airbyte_secret: true }, ssl_mode: { type: 'string', title: 'SSL mode', enum: ['disable','allow','prefer','require'], default: 'prefer' } } },
      'mock-mysql':       { required: ['host','port','database','username'], properties: { host: { type: 'string', title: 'Host' }, port: { type: 'integer', title: 'Port', default: 3306 }, database: { type: 'string', title: 'Database' }, username: { type: 'string', title: 'Username' }, password: { type: 'string', title: 'Password', airbyte_secret: true } } },
      'mock-salesforce':  { required: ['client_id','client_secret','refresh_token'], properties: { client_id: { type: 'string', title: 'Client ID' }, client_secret: { type: 'string', title: 'Client Secret', airbyte_secret: true }, refresh_token: { type: 'string', title: 'Refresh Token', airbyte_secret: true }, is_sandbox: { type: 'boolean', title: 'Sandbox', default: false }, start_date: { type: 'string', title: 'Start Date', examples: ['2024-01-01'] } } },
      'mock-s3':          { required: ['bucket','region'], properties: { bucket: { type: 'string', title: 'Bucket name' }, region: { type: 'string', title: 'AWS Region', examples: ['us-east-1'] }, access_key_id: { type: 'string', title: 'Access Key ID', airbyte_secret: true }, secret_access_key: { type: 'string', title: 'Secret Access Key', airbyte_secret: true }, path_prefix: { type: 'string', title: 'Path prefix' } } },
      'mock-hubspot':     { required: ['credentials'], properties: { start_date: { type: 'string', title: 'Start Date', examples: ['2024-01-01'] }, access_token: { type: 'string', title: 'Access Token', airbyte_secret: true } } },
      'mock-stripe':      { required: ['account_id','client_secret'], properties: { account_id: { type: 'string', title: 'Account ID', examples: ['acct_...'] }, client_secret: { type: 'string', title: 'Secret Key', airbyte_secret: true }, start_date: { type: 'string', title: 'Start Date', examples: ['2024-01-01'] } } },
    }
    if (defId.startsWith('mock-') && MOCK_SPECS[defId]) {
      return Response.json({ spec: MOCK_SPECS[defId], mock: true })
    }
    // For unknown mock IDs, return a generic spec
    if (defId.startsWith('mock-')) {
      return Response.json({ spec: { required: ['host'], properties: { host: { type: 'string', title: 'Host' }, port: { type: 'integer', title: 'Port' }, username: { type: 'string', title: 'Username' }, password: { type: 'string', title: 'Password', airbyte_secret: true } } }, mock: true })
    }
    try {
      const data = await ab(inst,
        `/source_definitions/${defId}/specification`,
        '/source_definition_specifications/get',
        'GET',
        { sourceDefinitionId: defId }
      ) as any
      return Response.json({ spec: data.connectionSpecification || data.spec || data })
    } catch (e) { return Response.json({ error: (e as Error).message }, { status: 500 }) }
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 })
}

// ── POST ──────────────────────────────────────────────────────
export async function POST(req: Request) {
  const session = await getSession()
  if (!session || session.role !== 'admin')
    return Response.json({ error: 'Admin only' }, { status: 403 })

  const sql  = await ensureTable()
  const body = await req.json() as any
  const { action } = body

  // ── Create instance
  if (action === 'create_instance') {
    const enc    = body.password?.trim()       ? encrypt(body.password.trim())       : null
    const csEnc  = body.client_secret?.trim()  ? encrypt(body.client_secret.trim())  : null
    await sql`INSERT INTO airbyte_instances (label, url, username, password_enc, client_id, client_secret_enc)
      VALUES (${body.label || 'Local Airbyte'}, ${body.url || 'http://localhost:8000'},
              ${body.username || 'airbyte'}, ${enc}, ${body.client_id || null}, ${csEnc})`
    return Response.json({ ok: true })
  }

  // ── Update instance
  if (action === 'update_instance') {
    await sql`UPDATE airbyte_instances SET label=${body.label}, url=${body.url}, username=${body.username},
      client_id=${body.client_id || null} WHERE id=${body.id}`
    if (body.password?.trim())
      await sql`UPDATE airbyte_instances SET password_enc=${encrypt(body.password.trim())} WHERE id=${body.id}`
    if (body.client_secret?.trim())
      await sql`UPDATE airbyte_instances SET client_secret_enc=${encrypt(body.client_secret.trim())} WHERE id=${body.id}`
    return Response.json({ ok: true })
  }

  // ── Delete instance
  if (action === 'delete_instance') {
    await sql`DELETE FROM airbyte_instances WHERE id=${body.id}`
    return Response.json({ ok: true })
  }

  // ── Set active workspace: let the user choose which workspace Mosaic reads
  // sources/connections from, for accounts with more than one.
  if (action === 'set_workspace') {
    if (!body.id || !body.workspace_id) return Response.json({ error: 'id and workspace_id required' }, { status: 400 })
    await sql`UPDATE airbyte_instances SET workspace_id = ${body.workspace_id} WHERE id = ${body.id}`
    return Response.json({ ok: true })
  }

  // ── Discover workspace
  if (action === 'discover_workspace') {
    let inst: AirbyteInstance
    try { inst = await getInstance(sql, body.id) }
    catch { return Response.json({ error: 'Not found' }, { status: 404 }) }
    try {
      const data = await ab(inst, '/workspaces', '/workspaces/list', 'GET') as any
      const ws = data.data || data.workspaces || []
      if (!ws.length) return Response.json({ ok: false, error: 'No workspaces found' })
      const wsId = ws[0].workspaceId || ws[0].id
      await sql`UPDATE airbyte_instances SET workspace_id=${wsId} WHERE id=${body.id}`
      return Response.json({ ok: true, workspaceId: wsId, count: ws.length })
    } catch (e) { return Response.json({ error: (e as Error).message }, { status: 500 }) }
  }

  // ── Create source in Airbyte
  if (action === 'create_source') {
    let inst: AirbyteInstance
    try { inst = await getInstance(sql, body.instanceId) }
    catch { return Response.json({ error: 'Instance not found' }, { status: 404 }) }
    try {
      const wsId = await getWorkspaceId(sql, inst)
      const data = await ab(inst, '/sources', '/sources/create', 'POST', {
        workspaceId: wsId,
        name: body.name,
        sourceDefinitionId: body.definitionId,
        connectionConfiguration: body.config,
      }) as any
      return Response.json({ ok: true, sourceId: data.sourceId || data.id, source: data })
    } catch (e) { return Response.json({ error: (e as Error).message }, { status: 500 }) }
  }

  // ── Update source in Airbyte
  if (action === 'update_source') {
    let inst: AirbyteInstance
    try { inst = await getInstance(sql, body.instanceId) }
    catch { return Response.json({ error: 'Instance not found' }, { status: 404 }) }
    try {
      const data = await ab(inst, `/sources/${body.sourceId}`, '/sources/update', 'PATCH', {
        sourceId: body.sourceId,
        name: body.name,
        connectionConfiguration: body.config,
      }) as any
      return Response.json({ ok: true, source: data })
    } catch (e) { return Response.json({ error: (e as Error).message }, { status: 500 }) }
  }

  // ── Delete source in Airbyte
  if (action === 'delete_source') {
    let inst: AirbyteInstance
    try { inst = await getInstance(sql, body.instanceId) }
    catch { return Response.json({ error: 'Instance not found' }, { status: 404 }) }
    try {
      await ab(inst, `/sources/${body.sourceId}`, '/sources/delete', 'DELETE', { sourceId: body.sourceId })
      return Response.json({ ok: true })
    } catch (e) { return Response.json({ error: (e as Error).message }, { status: 500 }) }
  }

  // ── Create connection in Airbyte
  if (action === 'create_connection') {
    let inst: AirbyteInstance
    try { inst = await getInstance(sql, body.instanceId) }
    catch { return Response.json({ error: 'Instance not found' }, { status: 404 }) }
    try {
      const data = await ab(inst, '/connections', '/connections/create', 'POST', {
        sourceId: body.sourceId,
        destinationId: body.destinationId,
        name: body.name,
        status: 'active',
        schedule: body.schedule || { scheduleType: 'manual' },
        syncCatalog: body.syncCatalog,
      }) as any
      return Response.json({ ok: true, connectionId: data.connectionId || data.id, connection: data })
    } catch (e) { return Response.json({ error: (e as Error).message }, { status: 500 }) }
  }

  // ── Update connection (pause/resume/reschedule)
  if (action === 'update_connection') {
    let inst: AirbyteInstance
    try { inst = await getInstance(sql, body.instanceId) }
    catch { return Response.json({ error: 'Instance not found' }, { status: 404 }) }
    try {
      const data = await ab(inst, `/connections/${body.connectionId}`, '/connections/update', 'PATCH', {
        connectionId: body.connectionId,
        ...(body.status   !== undefined ? { status: body.status } : {}),
        ...(body.schedule !== undefined ? { schedule: body.schedule } : {}),
        ...(body.name     !== undefined ? { name: body.name } : {}),
      }) as any
      return Response.json({ ok: true, connection: data })
    } catch (e) { return Response.json({ error: (e as Error).message }, { status: 500 }) }
  }

  // ── Delete connection
  if (action === 'delete_connection') {
    let inst: AirbyteInstance
    try { inst = await getInstance(sql, body.instanceId) }
    catch { return Response.json({ error: 'Instance not found' }, { status: 404 }) }
    try {
      await ab(inst, `/connections/${body.connectionId}`, '/connections/delete', 'DELETE', { connectionId: body.connectionId })
      return Response.json({ ok: true })
    } catch (e) { return Response.json({ error: (e as Error).message }, { status: 500 }) }
  }

  // ── Trigger sync job
  if (action === 'trigger_sync') {
    let inst: AirbyteInstance
    try { inst = await getInstance(sql, body.instanceId) }
    catch { return Response.json({ error: 'Instance not found' }, { status: 404 }) }
    try {
      const data = await ab(inst, '/jobs', '/connections/sync', 'POST',
        { type: 'sync', connectionId: body.connectionId }) as any
      await sql`UPDATE airbyte_instances SET last_synced=${nowExpr()} WHERE id=${body.instanceId}`
      return Response.json({ ok: true, jobId: data.jobId || data.id || data.job?.id || null })
    } catch (e) { return Response.json({ error: (e as Error).message }, { status: 500 }) }
  }

  // ── Trigger reset job
  if (action === 'trigger_reset') {
    let inst: AirbyteInstance
    try { inst = await getInstance(sql, body.instanceId) }
    catch { return Response.json({ error: 'Instance not found' }, { status: 404 }) }
    try {
      const data = await ab(inst, '/jobs', '/connections/reset', 'POST',
        { type: 'reset', connectionId: body.connectionId }) as any
      return Response.json({ ok: true, jobId: data.jobId || data.id || data.job?.id || null })
    } catch (e) { return Response.json({ error: (e as Error).message }, { status: 500 }) }
  }

  // ── Cancel a running job
  if (action === 'cancel_job') {
    let inst: AirbyteInstance
    try { inst = await getInstance(sql, body.instanceId) }
    catch { return Response.json({ error: 'Instance not found' }, { status: 404 }) }
    try {
      await ab(inst, `/jobs/${body.jobId}`, '/jobs/cancel', 'DELETE', { id: body.jobId })
      return Response.json({ ok: true })
    } catch (e) { return Response.json({ error: (e as Error).message }, { status: 500 }) }
  }

  // ── Build a full pipeline from an existing source to a destination.
  // Orchestrates the steps that already exist as individual actions:
  //   discover the source schema -> build a sync catalog (all streams, full
  //   refresh|overwrite) -> create the connection -> trigger the first sync.
  // Reuses the same ab() client + endpoints; adds no new Airbyte machinery.
  // The async sync itself is watched by the existing pipeline UI (which already
  // polls job status), so this returns as soon as the sync is triggered.
  if (action === 'build_pipeline') {
    let inst: AirbyteInstance
    try { inst = await getInstance(sql, body.instanceId) }
    catch { return Response.json({ error: 'Instance not found' }, { status: 404 }) }
    const { sourceId, destinationId, name } = body
    if (!sourceId || !destinationId) return Response.json({ error: 'sourceId and destinationId required' }, { status: 400 })
    try {
      // 0. Pre-flight: verify the chosen destination is actually reachable, so a
      //    misconfigured/unreachable destination fails fast with a clear message
      //    instead of building a connection whose first sync errors after the fact.
      try {
        const chk = await ab(inst,
          `/destinations/${destinationId}/check_connection`,
          '/destinations/check_connection',
          'POST',
          { destinationId },
          30000
        ) as any
        // Airbyte returns the check outcome under one of these shapes depending on
        // API surface: { status: 'succeeded'|'failed' }, { jobInfo: { succeeded } },
        // or a bare { succeeded }. Treat anything not explicitly successful as a
        // failure so a broken destination is caught here, not after the sync.
        const explicitStatus = typeof chk.status === 'string' ? chk.status.toLowerCase() : null
        const succeeded = explicitStatus === 'succeeded'
          || chk.succeeded === true
          || chk.jobInfo?.succeeded === true
        const failed = explicitStatus === 'failed'
          || chk.succeeded === false
          || chk.jobInfo?.succeeded === false
        if (failed || !succeeded) {
          const msg = chk.message || chk.jobInfo?.failureReason?.externalMessage
            || 'The destination is not reachable — check its configuration in Airbyte.'
          return Response.json({ error: `Destination check failed: ${msg}` }, { status: 422 })
        }
      } catch (e) {
        // A timeout or error here means the check itself couldn't complete — which
        // for an unreachable destination is exactly what happens (the check hangs).
        // Treat that as a failure so we don't build a doomed pipeline. (If the
        // endpoint is genuinely missing on some instance, the message still guides
        // the operator to verify the destination.)
        const m = (e as Error).message || ''
        const hint = /timeout|abort/i.test(m)
          ? 'the destination did not respond (likely unreachable)'
          : m
        return Response.json({ error: `Could not verify the destination: ${hint}. Check its configuration in Airbyte.` }, { status: 422 })
      }

      // 1. Discover the source's streams (cold-start container spin-up can take
      //    30s+, so allow a generous timeout for this step specifically).
      const disc = await ab(inst,
        `/streams?sourceId=${sourceId}`,
        '/sources/discover_schema',
        'GET',
        { sourceId },
        90000
      ) as any
      // Public API returns a bare array of stream descriptors ({ streamName, ... });
      // config API nests them under catalog.streams ({ stream: { name } }).
      const rawStreams: any[] = Array.isArray(disc)
        ? disc
        : (disc.data || disc.catalog?.streams || disc.streams || [])
      if (!rawStreams.length) return Response.json({ error: 'No streams discovered on the source' }, { status: 422 })
      const streamNames = rawStreams
        .map(s => s.streamName || s.name || s.stream?.name)
        .filter(Boolean)

      // 2. Build the public-API connection catalog: select every stream, full
      //    refresh|overwrite so the landed tables are complete and self-contained.
      const configurations = {
        streams: streamNames.map((name: string) => ({
          name,
          syncMode: 'full_refresh_overwrite',
        })),
      }

      // 3. Create the connection (manual schedule — operator syncs on demand).
      //    Public API uses `configurations`; config API uses `syncCatalog`. We
      //    send `configurations` since this instance speaks the public API.
      const conn = await ab(inst, '/connections', '/connections/create', 'POST', {
        sourceId,
        destinationId,
        name: name || 'Mosaic pipeline',
        status: 'active',
        configurations,
        schedule: { scheduleType: 'manual' },
      }) as any
      const connectionId = conn.connectionId || conn.id
      if (!connectionId) return Response.json({ error: 'Connection was not created' }, { status: 502 })

      // 4. Trigger the first sync
      const job = await ab(inst, '/jobs', '/connections/sync', 'POST',
        { type: 'sync', connectionId, jobType: 'sync' }) as any
      await sql`UPDATE airbyte_instances SET last_synced=${nowExpr()} WHERE id=${body.instanceId}`

      return Response.json({
        ok: true,
        connectionId,
        jobId: job.jobId || job.id || job.job?.id || null,
        streamCount: streamNames.length,
      })
    } catch (e) { return Response.json({ error: (e as Error).message }, { status: 500 }) }
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 })
}
