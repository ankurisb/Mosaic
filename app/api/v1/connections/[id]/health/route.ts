import { validateDevApiKey, logDevApiUsage } from '@/lib/dev-api-auth'
import { getDb } from '@/lib/db'
export const runtime = 'nodejs'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const start = Date.now()
  const auth = await validateDevApiKey(req, ['read'])
  if (!auth.ok) return auth.response

  const { id } = await params
  const sql = getDb()

  // Try db_connections first, then api_services
  const dbRows = await sql`SELECT * FROM db_connections WHERE id = ${id} LIMIT 1`
  const apiRows = dbRows.length ? [] :
    await sql`SELECT * FROM api_services WHERE id = ${id} LIMIT 1`

  if (!dbRows.length && !apiRows.length) {
    return Response.json({ error: 'Connection not found' }, { status: 404 })
  }

  if (dbRows.length) {
    const conn = dbRows[0] as Record<string, unknown>
    try {
      // Use the existing test-db endpoint internally
      const res = await fetch(`${new URL(req.url).origin}/api/test-db`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: req.headers.get('cookie') || '' },
        body: JSON.stringify({ id }),
        signal: AbortSignal.timeout(10000),
      })
      const data = await res.json() as { ok?: boolean; error?: string; latency_ms?: number }
      const latency = data.latency_ms || (Date.now() - start)
      await logDevApiUsage(auth.keyId, `/api/v1/connections/${id}/health`, 'GET', 200, latency)
      return Response.json({
        id, type: 'database', label: conn.label,
        dialect: conn.dialect,
        status: data.ok ? 'ok' : 'error',
        latency_ms: latency,
        ...(data.error ? { error: data.error } : {}),
      })
    } catch (err) {
      const latency = Date.now() - start
      await logDevApiUsage(auth.keyId, `/api/v1/connections/${id}/health`, 'GET', 200, latency)
      return Response.json({
        id, type: 'database', label: conn.label,
        dialect: conn.dialect, status: 'error',
        error: (err as Error).message, latency_ms: latency,
      })
    }
  }

  // API service health check — ping base URL
  const svc = apiRows[0] as Record<string, unknown>
  try {
    const res = await fetch(svc.base_url as string, {
      signal: AbortSignal.timeout(5000), method: 'HEAD',
    })
    const latency = Date.now() - start
    await logDevApiUsage(auth.keyId, `/api/v1/connections/${id}/health`, 'GET', 200, latency)
    return Response.json({
      id, type: 'api', label: svc.label,
      status: res.ok ? 'ok' : 'degraded',
      http_status: res.status, latency_ms: latency,
    })
  } catch (err) {
    const latency = Date.now() - start
    await logDevApiUsage(auth.keyId, `/api/v1/connections/${id}/health`, 'GET', 200, latency)
    return Response.json({
      id, type: 'api', label: svc.label,
      status: 'error', error: (err as Error).message,
      latency_ms: latency,
    })
  }
}
