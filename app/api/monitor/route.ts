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
    { id: 'anthropic', label: 'Anthropic API', category: 'api', icon: 'A' },
    { id: 'tavily', label: 'Tavily Search', category: 'api', icon: 'T' },
  ]

  // Database connections
  const dbConns = await sql`SELECT id,label,host,port,password_enc,username,database_name,connection_string,ssl_mode FROM db_connections`

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

  // Check Anthropic
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const start = Date.now()
      const res = await fetch('https://api.anthropic.com/v1/models', {
        headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        signal: AbortSignal.timeout(5000),
      })
      results.push({ id: 'anthropic', label: 'Anthropic API', category: 'api', status: res.ok ? 'healthy' : 'degraded', latencyMs: Date.now() - start })
    } catch {
      results.push({ id: 'anthropic', label: 'Anthropic API', category: 'api', status: 'down', latencyMs: null })
    }
  } else {
    results.push({ id: 'anthropic', label: 'Anthropic API', category: 'api', status: 'unknown', latencyMs: null, message: 'API key not configured' })
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

  // Check each DB connection
  for (const conn of dbConns) {
    const connStr = conn.connection_string ? decrypt(conn.connection_string) :
      `postgresql://${conn.username}:${decrypt(conn.password_enc||'')}@${conn.host}:${conn.port}/${conn.database_name}`
    try {
      const start = Date.now()
      const pool = new Pool({ connectionString: connStr, max: 1, connectionTimeoutMillis: 4000,
        ssl: conn.ssl_mode === 'disable' ? false : { rejectUnauthorized: false } })
      const client = await pool.connect()
      await client.query('SELECT 1')
      client.release()
      await pool.end()
      results.push({ id: conn.id, label: conn.label, category: 'database', status: 'healthy', latencyMs: Date.now() - start })
    } catch (e) {
      results.push({ id: conn.id, label: conn.label, category: 'database', status: 'down', latencyMs: null, message: e instanceof Error ? e.message : 'Failed' })
    }
  }

  // Check each API service
  for (const svc of apiSvcs) {
    try {
      const start = Date.now()
      const res = await fetch(svc.base_url, { method: 'HEAD', signal: AbortSignal.timeout(4000) })
      results.push({ id: svc.id, label: svc.label, category: 'api_service', status: res.status < 500 ? 'healthy' : 'degraded', latencyMs: Date.now() - start })
    } catch (e) {
      results.push({ id: svc.id, label: svc.label, category: 'api_service', status: 'down', latencyMs: null })
    }
  }

  const healthy = results.filter(r => r.status === 'healthy').length
  const degraded = results.filter(r => r.status === 'degraded').length
  const down = results.filter(r => r.status === 'down').length

  return Response.json({ services: results, summary: { healthy, degraded, down, total: results.length } })
}
