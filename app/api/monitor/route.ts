import { getSession } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { getKey } from '@/lib/keys'
import { Pool } from 'pg'
import { decrypt } from '@/lib/encrypt'
export const runtime = 'nodejs'

export async function GET() {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  const sql = getDb()

  // Static infrastructure services
  const infra = [
    { id: 'app', label: 'Next.js App', category: 'infrastructure', icon: 'N' },
    { id: 'db', label: 'Settings DB (Neon)', category: 'infrastructure', icon: 'D' },
    { id: 'anthropic', label: 'AI Engine', category: 'api', icon: 'A' },
    { id: 'tavily', label: 'Tavily Search', category: 'api', icon: 'T' },
  ]

  // Database connections
  const dbConns = await sql`SELECT id,label,dialect,host,port,password_enc,username,database_name,connection_string,ssl_mode FROM db_connections`

  // API services
  const apiSvcs = await sql`SELECT id,label,base_url FROM api_services`

  const results = []

  // Check Next.js (always healthy if we're running)
  results.push({ id: 'app', label: 'Next.js App', category: 'infrastructure', status: 'healthy', latencyMs: 1 })

  // Check settings DB
  try {
    const start = Date.now()
    await sql`SELECT 1`
    results.push({ id: 'db', label: 'Settings DB', category: 'infrastructure', status: 'healthy', latencyMs: Date.now() - start })
  } catch {
    results.push({ id: 'db', label: 'Settings DB', category: 'infrastructure', status: 'down', latencyMs: null })
  }

  // Check AI Engine
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const start = Date.now()
      const res = await fetch('https://api.anthropic.com/v1/models', {
        headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        signal: AbortSignal.timeout(5000),
      })
      results.push({ id: 'anthropic', label: 'AI Engine', category: 'api', status: res.ok ? 'healthy' : 'degraded', latencyMs: Date.now() - start })
    } catch {
      results.push({ id: 'anthropic', label: 'AI Engine', category: 'api', status: 'down', latencyMs: null })
    }
  } else {
    results.push({ id: 'anthropic', label: 'AI Engine', category: 'api', status: 'unknown', latencyMs: null, message: 'API key not configured' })
  }

  // Check the configured web-search provider (Tavily or Perplexity), reading
  // keys via getKey so a runtime-set key in Settings is honoured.
  const searchProvider = ((await getKey('SEARCH_PROVIDER')) || 'tavily').toLowerCase()
  const isPplx = searchProvider === 'perplexity'
  const searchKey = await getKey(isPplx ? 'PERPLEXITY_API_KEY' : 'TAVILY_API_KEY')
  const searchLabel = isPplx ? 'Perplexity Search' : 'Tavily Search'
  const searchHost = isPplx ? 'https://api.perplexity.ai' : 'https://api.tavily.com'
  if (searchKey) {
    try {
      const start = Date.now()
      const res = await fetch(searchHost, { signal: AbortSignal.timeout(5000) })
      results.push({ id: 'search', label: searchLabel, category: 'api', status: res.status < 500 ? 'healthy' : 'degraded', latencyMs: Date.now() - start })
    } catch {
      results.push({ id: 'search', label: searchLabel, category: 'api', status: 'down', latencyMs: null })
    }
  } else {
    results.push({ id: 'search', label: searchLabel, category: 'api', status: 'unknown', latencyMs: null, message: 'API key not configured' })
  }

  // Fix #10: dialect-aware DB health check.
  // Probes run concurrently: each is an independent network round-trip with its
  // own timeout, so running them in parallel makes total time ~= the slowest
  // single probe instead of the sum of all of them.
  const dbResults = await Promise.all(dbConns.map(async (conn) => {
    const dialect = (conn.dialect as string) || 'postgres'
    const start = Date.now()
    try {
      if (dialect === 'sqlite') {
        // SQLite: just check file/sandbox marker exists
        const path = conn.connection_string ? decrypt(conn.connection_string as string) : conn.database_name as string
        if (path && path !== '__sandbox__') {
          const fs = await import('fs')
          if (!fs.existsSync(path)) throw new Error('File not found: ' + path)
        }
        return { id: conn.id, label: conn.label, category: 'database', status: 'healthy', latencyMs: Date.now() - start }
      } else if (dialect === 'mysql') {
        const mysql = await import('mysql2/promise')
        const connStr = conn.connection_string
          ? decrypt(conn.connection_string as string)
          : `mysql://${conn.username}:${decrypt(conn.password_enc as string||'')}@${conn.host}:${conn.port}/${conn.database_name}`
        const connection = await mysql.createConnection(connStr)
        await connection.execute('SELECT 1')
        await connection.end()
        return { id: conn.id, label: conn.label, category: 'database', status: 'healthy', latencyMs: Date.now() - start }
      } else if (dialect === 'mssql') {
        const mssql = await import('mssql')
        const cfg: any = {
          user: conn.username as string, password: decrypt(conn.password_enc as string||''),
          server: conn.host as string, port: (conn.port as number)||1433,
          database: conn.database_name as string,
          options: { encrypt: conn.ssl_mode !== 'disable', trustServerCertificate: true },
          connectionTimeout: 4000,
        }
        const pool = conn.connection_string ? await mssql.connect(decrypt(conn.connection_string as string)) : await mssql.connect(cfg as any)
        await pool.request().query('SELECT 1')
        await pool.close()
        return { id: conn.id, label: conn.label, category: 'database', status: 'healthy', latencyMs: Date.now() - start }
      } else if (dialect === 'mongodb') {
        const { MongoClient } = await import('mongodb')
        const uri = conn.connection_string
          ? decrypt(conn.connection_string as string)
          : `mongodb://${conn.username}:${decrypt(conn.password_enc as string||'')}@${conn.host}:${conn.port}/${conn.database_name}`
        const client = new MongoClient(uri, { serverSelectionTimeoutMS: 4000 })
        await client.connect()
        await client.db('admin').command({ ping: 1 })
        await client.close()
        return { id: conn.id, label: conn.label, category: 'database', status: 'healthy', latencyMs: Date.now() - start }
      } else if (dialect === 'clickhouse') {
        const protocol = (conn.ssl_mode as string) === 'disable' ? 'http' : 'https'
        const base = conn.connection_string ? decrypt(conn.connection_string as string) : `${protocol}://${conn.host}:${conn.port || 8123}`
        const url = new URL('/?query=SELECT+1&default_format=JSONEachRow', base)
        const headers: Record<string,string> = {}
        if (conn.username) headers['Authorization'] = 'Basic ' + Buffer.from(`${conn.username}:${decrypt(conn.password_enc as string||'')}`).toString('base64')
        const res = await fetch(url.toString(), { headers, signal: AbortSignal.timeout(4000) })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return { id: conn.id, label: conn.label, category: 'database', status: 'healthy', latencyMs: Date.now() - start }
      } else if (dialect === 'influxdb') {
        const protocol = (conn.ssl_mode as string) === 'disable' ? 'http' : 'https'
        const base = conn.connection_string ? decrypt(conn.connection_string as string) : `${protocol}://${conn.host}:${conn.port || 8086}`
        const token = decrypt(conn.password_enc as string || '')
        const pingUrl = new URL('/ping', base)
        const res = await fetch(pingUrl.toString(), {
          headers: token ? { 'Authorization': `Token ${token}` } : {},
          signal: AbortSignal.timeout(4000),
        })
        if (res.status !== 204 && !res.ok) throw new Error(`Ping returned ${res.status}`)
        return { id: conn.id, label: conn.label, category: 'database', status: 'healthy', latencyMs: Date.now() - start }
      } else {
        // postgres default
        const connStr = conn.connection_string ? decrypt(conn.connection_string as string) :
          `postgresql://${conn.username}:${decrypt(conn.password_enc as string||'')}@${conn.host}:${conn.port}/${conn.database_name}`
        const pool = new Pool({ connectionString: connStr, max: 1, connectionTimeoutMillis: 4000,
          ssl: conn.ssl_mode === 'disable' ? false : { rejectUnauthorized: false } })
        const client = await pool.connect()
        await client.query('SELECT 1')
        client.release(); await pool.end()
        return { id: conn.id, label: conn.label, category: 'database', status: 'healthy', latencyMs: Date.now() - start }
      }
    } catch (e) {
      return { id: conn.id, label: conn.label, category: 'database', status: 'down', latencyMs: null, message: (e instanceof Error ? e.message : 'Failed') }
    }
  }))
  results.push(...dbResults)

  // Check each API service (concurrently — see note on the DB probes above)
  const apiResults = await Promise.all(apiSvcs.map(async (svc) => {
    try {
      const start = Date.now()
      const res = await fetch(svc.base_url as string, { method: 'HEAD', signal: AbortSignal.timeout(4000) })
      return { id: svc.id, label: svc.label, category: 'api_service', status: res.status < 500 ? 'healthy' : 'degraded', latencyMs: Date.now() - start }
    } catch (e) {
      return { id: svc.id, label: svc.label, category: 'api_service', status: 'down', latencyMs: null }
    }
  }))
  results.push(...apiResults)

  // Infra checks run concurrently — each is an independent probe with its own
  // timeout, so a down service no longer blocks the others (was the main cost).
  const infraResults = await Promise.all([
    (async () => {
    // Check n8n
      try {
        // Distinguish a saved BYO n8n from the compose scaffolding default. If only
        // the default (n8n:5678 / localhost:5678) exists and it's unreachable, n8n
        // isn't part of this deployment -> report 'unknown/not configured', not a
        // scary 'down'. Same treatment as Superset/CISO/Airbyte.
        let byo: string | null = null
        try {
          const rows = await sql`SELECT value_enc FROM kv_settings WHERE key = 'N8N_URL'`
          if (rows.length) { const { decrypt } = await import('@/lib/encrypt'); byo = decrypt(rows[0].value_enc as string) || null }
        } catch {}
        const n8nUrl = byo || process.env.N8N_URL
        if (!n8nUrl) {
          return ({ id: 'n8n', label: 'n8n Automation', category: 'infrastructure', status: 'unknown', latencyMs: null, message: 'Not configured' })
        }
        const start = Date.now()
        try {
          const res = await fetch(`${n8nUrl}/healthz`, { signal: AbortSignal.timeout(8000) })
          return ({ id: 'n8n', label: 'n8n Automation', category: 'infrastructure', status: res.ok ? 'healthy' : 'degraded', latencyMs: Date.now() - start, url: n8nUrl })
        } catch {
          // Unreachable + only the scaffolding default => not configured for this deployment.
          if (!byo) return ({ id: 'n8n', label: 'n8n Automation', category: 'infrastructure', status: 'unknown', latencyMs: null, message: 'Not configured' })
          return ({ id: 'n8n', label: 'n8n Automation', category: 'infrastructure', status: 'down', latencyMs: null, message: 'Not reachable' })
        }
      } catch {
        return ({ id: 'n8n', label: 'n8n Automation', category: 'infrastructure', status: 'unknown', latencyMs: null, message: 'Not configured' })
      }
    
      
    })(),
    (async () => {
    // Check Airbyte — probe ALL active instances (there may be a dead bundled one
    // plus a reachable Cloud one) across the flavour-specific health paths (Cloud:
    // /v1, abctl: /api/public/v1, older: /api/v1). 401/403 = reachable-but-auth-
    // gated = healthy. Report healthy if ANY instance answers.
      try {
        const airbytes = await sql`SELECT url FROM airbyte_instances WHERE active = true`
        if (!airbytes.length) {
          return ({ id: 'airbyte', label: 'Airbyte', category: 'infrastructure', status: 'unknown', latencyMs: null, message: 'Not configured' })
        }
        const paths = ['/v1/health', '/api/public/v1/health', '/api/v1/health', '/health']
        const start = Date.now()
        let anyDegraded = false
        for (const inst of airbytes) {
          const base = (inst.url as string).replace(/\/$/, '')
          for (const p of paths) {
            try {
              const res = await fetch(`${base}${p}`, { signal: AbortSignal.timeout(8000) })
              if (res.ok || res.status === 401 || res.status === 403) {
                return ({ id: 'airbyte', label: 'Airbyte', category: 'infrastructure', status: 'healthy', latencyMs: Date.now() - start, url: inst.url })
              }
              anyDegraded = true
            } catch { /* try next */ }
          }
        }
        return ({ id: 'airbyte', label: 'Airbyte', category: 'infrastructure', status: anyDegraded ? 'degraded' : 'down', latencyMs: Date.now() - start })
      } catch {
        return ({ id: 'airbyte', label: 'Airbyte', category: 'infrastructure', status: 'down', latencyMs: null })
      }
    
    
      
    })(),
    (async () => {
    // Check Stats Sidecar
      const statsUrl = process.env.STATS_SIDECAR_URL || 'http://localhost:8001'
      try {
        const start = Date.now()
        const res = await fetch(`${statsUrl}/health`, { signal: AbortSignal.timeout(3000) })
        const data = await res.json()
        return ({ id: 'stats_sidecar', label: 'Stats Engine', category: 'infrastructure', status: res.ok && data.ok ? 'healthy' : 'degraded', latencyMs: Date.now() - start, message: res.ok && data.ok ? '12 analysis types available' : 'Health check failed' })
      } catch {
        return ({ id: 'stats_sidecar', label: 'Stats Engine', category: 'infrastructure', status: 'down', latencyMs: null, message: 'Not running — start with: cd services/stats-sidecar && python3 main.py' })
      }
    
      
    })(),
    (async () => {
    // Check OpenMeter (Usage Metering)
      const openMeterUrl = process.env.OPENMETER_URL || 'http://localhost:8888'
      try {
        const start = Date.now()
        // OpenMeter health is on the telemetry port (10000), not the ingest port (8888)
        const telemetryUrl = openMeterUrl.replace(':8888', ':10000')
        const res = await fetch(`${telemetryUrl}/healthz`, { signal: AbortSignal.timeout(3000) })
        if (res.ok) {
          // Also fetch 24h ingest count for operational visibility
          let eventsMsg = 'Running'
          try {
            const metricsRes = await fetch(`${telemetryUrl}/metrics`, { signal: AbortSignal.timeout(2000) })
            if (metricsRes.ok) {
              const metricsText = await metricsRes.text()
              const match = metricsText.match(/openmeter_ingest_events_total[^\n]*\s+([\d.]+)/)
              if (match) eventsMsg = `${Number(match[1]).toLocaleString()} events ingested total`
            }
          } catch { /* metrics fetch optional */ }
          return ({ id: 'openmeter', label: 'Usage Metering', category: 'infrastructure', status: 'healthy', latencyMs: Date.now() - start, message: eventsMsg, url: 'http://localhost:10000' })
        } else {
          return ({ id: 'openmeter', label: 'Usage Metering', category: 'infrastructure', status: 'degraded', latencyMs: Date.now() - start, message: `HTTP ${res.status}` })
        }
      } catch {
        return ({ id: 'openmeter', label: 'Usage Metering', category: 'infrastructure', status: 'down', latencyMs: null, message: 'Not running — start with: docker compose up -d openmeter' })
      }
    
      
    })(),
    (async () => {
    // Check Superset
      const supersetUrl = process.env.SUPERSET_URL || 'http://localhost:8088'
      try {
        const start = Date.now()
        const res = await fetch(`${supersetUrl}/health`, { signal: AbortSignal.timeout(4000) })
        return ({ id: 'superset', label: 'Superset Analytics', category: 'infrastructure', status: res.ok ? 'healthy' : 'degraded', latencyMs: Date.now() - start, url: supersetUrl })
      } catch {
        return ({ id: 'superset', label: 'Superset Analytics', category: 'infrastructure', status: 'down', latencyMs: null })
      }
    
      
    })(),
    (async () => {
    // Check Keycloak (SSO) — only shown when SSO_ENABLED=true or a keycloak config exists in sso_config
      const keycloakUrl = process.env.KEYCLOAK_URL || 'http://localhost:8080'
      const ssoEnabled = process.env.SSO_ENABLED === 'true'
      const keycloakRows = await sql`SELECT server_url FROM sso_config WHERE provider='keycloak' AND enabled = true LIMIT 1`.catch(() => [])
      const configuredUrl = (keycloakRows[0] as { server_url?: string } | undefined)?.server_url
      const effectiveKcUrl = configuredUrl || (ssoEnabled ? keycloakUrl : null)
    
      if (effectiveKcUrl) {
        try {
          const start = Date.now()
          const res = await fetch(`${effectiveKcUrl}/health/ready`, { signal: AbortSignal.timeout(4000) })
          return ({ id: 'keycloak', label: 'Keycloak SSO', category: 'infrastructure', status: res.ok ? 'healthy' : 'degraded', latencyMs: Date.now() - start, message: res.ok ? `Realm: ${configuredUrl ? 'configured' : 'pending setup'}` : `HTTP ${res.status}` })
        } catch {
          return ({ id: 'keycloak', label: 'Keycloak SSO', category: 'infrastructure', status: 'down', latencyMs: null, message: ssoEnabled ? 'Not running — start with: docker compose --profile sso up -d keycloak' : 'SSO configured but Keycloak unreachable' })
        }
      } else {
        return ({ id: 'keycloak', label: 'Keycloak SSO', category: 'infrastructure', status: 'unknown', latencyMs: null, message: 'Not configured — set SSO_ENABLED=true or add Keycloak in Settings → Authentication' })
      }
    })(),
  ])
  results.push(...infraResults.filter(Boolean))

  const healthy = results.filter(r => r.status === 'healthy').length
  const degraded = results.filter(r => r.status === 'degraded').length
  const down = results.filter(r => r.status === 'down').length

  return Response.json({ services: results, summary: { healthy, degraded, down, total: results.length } })
}
