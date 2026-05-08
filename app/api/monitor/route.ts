import { getSession } from '@/lib/auth'
import { getDb } from '@/lib/db'
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

  // Check Tavily
  if (process.env.TAVILY_API_KEY) {
    try {
      const start = Date.now()
      const res = await fetch('https://api.tavily.com', { signal: AbortSignal.timeout(5000) })
      results.push({ id: 'tavily', label: 'Tavily Search', category: 'api', status: res.status < 500 ? 'healthy' : 'degraded', latencyMs: Date.now() - start })
    } catch {
      results.push({ id: 'tavily', label: 'Tavily Search', category: 'api', status: 'down', latencyMs: null })
    }
  } else {
    results.push({ id: 'tavily', label: 'Tavily Search', category: 'api', status: 'unknown', latencyMs: null, message: 'API key not configured' })
  }

  // Fix #10: dialect-aware DB health check
  for (const conn of dbConns) {
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
        results.push({ id: conn.id, label: conn.label, category: 'database', status: 'healthy', latencyMs: Date.now() - start })
      } else if (dialect === 'mysql') {
        const mysql = await import('mysql2/promise')
        const connStr = conn.connection_string
          ? decrypt(conn.connection_string as string)
          : `mysql://${conn.username}:${decrypt(conn.password_enc as string||'')}@${conn.host}:${conn.port}/${conn.database_name}`
        const connection = await mysql.createConnection(connStr)
        await connection.execute('SELECT 1')
        await connection.end()
        results.push({ id: conn.id, label: conn.label, category: 'database', status: 'healthy', latencyMs: Date.now() - start })
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
        results.push({ id: conn.id, label: conn.label, category: 'database', status: 'healthy', latencyMs: Date.now() - start })
      } else if (dialect === 'mongodb') {
        const { MongoClient } = await import('mongodb')
        const uri = conn.connection_string
          ? decrypt(conn.connection_string as string)
          : `mongodb://${conn.username}:${decrypt(conn.password_enc as string||'')}@${conn.host}:${conn.port}/${conn.database_name}`
        const client = new MongoClient(uri, { serverSelectionTimeoutMS: 4000 })
        await client.connect()
        await client.db('admin').command({ ping: 1 })
        await client.close()
        results.push({ id: conn.id, label: conn.label, category: 'database', status: 'healthy', latencyMs: Date.now() - start })
      } else if (dialect === 'clickhouse') {
        const protocol = (conn.ssl_mode as string) === 'disable' ? 'http' : 'https'
        const base = conn.connection_string ? decrypt(conn.connection_string as string) : `${protocol}://${conn.host}:${conn.port || 8123}`
        const url = new URL('/?query=SELECT+1&default_format=JSONEachRow', base)
        const headers: Record<string,string> = {}
        if (conn.username) headers['Authorization'] = 'Basic ' + Buffer.from(`${conn.username}:${decrypt(conn.password_enc as string||'')}`).toString('base64')
        const res = await fetch(url.toString(), { headers, signal: AbortSignal.timeout(4000) })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        results.push({ id: conn.id, label: conn.label, category: 'database', status: 'healthy', latencyMs: Date.now() - start })
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
        results.push({ id: conn.id, label: conn.label, category: 'database', status: 'healthy', latencyMs: Date.now() - start })
      } else {
        // postgres default
        const connStr = conn.connection_string ? decrypt(conn.connection_string as string) :
          `postgresql://${conn.username}:${decrypt(conn.password_enc as string||'')}@${conn.host}:${conn.port}/${conn.database_name}`
        const pool = new Pool({ connectionString: connStr, max: 1, connectionTimeoutMillis: 4000,
          ssl: conn.ssl_mode === 'disable' ? false : { rejectUnauthorized: false } })
        const client = await pool.connect()
        await client.query('SELECT 1')
        client.release(); await pool.end()
        results.push({ id: conn.id, label: conn.label, category: 'database', status: 'healthy', latencyMs: Date.now() - start })
      }
    } catch (e) {
      results.push({ id: conn.id, label: conn.label, category: 'database', status: 'down', latencyMs: null, message: (e instanceof Error ? e.message : 'Failed') })
    }
  }

  // Check each API service
  for (const svc of apiSvcs) {
    try {
      const start = Date.now()
      const res = await fetch(svc.base_url as string, { method: 'HEAD', signal: AbortSignal.timeout(4000) })
      results.push({ id: svc.id, label: svc.label, category: 'api_service', status: res.status < 500 ? 'healthy' : 'degraded', latencyMs: Date.now() - start })
    } catch (e) {
      results.push({ id: svc.id, label: svc.label, category: 'api_service', status: 'down', latencyMs: null })
    }
  }

  // Check n8n
  try {
    let n8nUrl = process.env.N8N_URL || 'http://localhost:5678'
    try {
      const rows = await sql`SELECT value_enc FROM kv_settings WHERE key = 'N8N_URL'`
      if (rows.length) { const { decrypt } = await import('@/lib/encrypt'); n8nUrl = decrypt(rows[0].value_enc as string) }
    } catch {}
    const start = Date.now()
    const res = await fetch(`${n8nUrl}/healthz`, { signal: AbortSignal.timeout(3000) })
    results.push({ id: 'n8n', label: 'n8n Automation', category: 'infrastructure', status: res.ok ? 'healthy' : 'degraded', latencyMs: Date.now() - start })
  } catch {
    results.push({ id: 'n8n', label: 'n8n Automation', category: 'infrastructure', status: 'down', latencyMs: null, message: 'Not running' })
  }

  // Check Airbyte
  try {
    const airbytes = await sql`SELECT url FROM airbyte_instances WHERE active = true LIMIT 1`
    if (airbytes.length) {
      const start = Date.now()
      const res = await fetch(`${airbytes[0].url}/api/v1/health`, { signal: AbortSignal.timeout(4000) })
      results.push({ id: 'airbyte', label: 'Airbyte', category: 'infrastructure', status: res.ok ? 'healthy' : 'degraded', latencyMs: Date.now() - start })
    } else {
      results.push({ id: 'airbyte', label: 'Airbyte', category: 'infrastructure', status: 'unknown', latencyMs: null, message: 'Not configured' })
    }
  } catch {
    results.push({ id: 'airbyte', label: 'Airbyte', category: 'infrastructure', status: 'down', latencyMs: null })
  }

  // Check Superset
  const supersetUrl = process.env.SUPERSET_URL || 'http://localhost:8088'
  try {
    const start = Date.now()
    const res = await fetch(`${supersetUrl}/health`, { signal: AbortSignal.timeout(4000) })
    results.push({ id: 'superset', label: 'Superset Analytics', category: 'infrastructure', status: res.ok ? 'healthy' : 'degraded', latencyMs: Date.now() - start })
  } catch {
    results.push({ id: 'superset', label: 'Superset Analytics', category: 'infrastructure', status: 'down', latencyMs: null })
  }

  const healthy = results.filter(r => r.status === 'healthy').length
  const degraded = results.filter(r => r.status === 'degraded').length
  const down = results.filter(r => r.status === 'down').length

  return Response.json({ services: results, summary: { healthy, degraded, down, total: results.length } })
}
