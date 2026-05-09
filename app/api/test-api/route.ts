import { getSession } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { decrypt } from '@/lib/encrypt'
import { getOAuth2AccessToken } from '@/lib/tools'
export const runtime = 'nodejs'

// Fix #6: validate path to prevent SSRF
function validatePath(path: string): string {
  if (typeof path !== 'string') return '/'
  // Strip leading protocol+host attempts and path traversal
  const cleaned = path
    .replace(/^https?:\/\/[^/]*/i, '')  // strip any prepended host
    .replace(/\.\.\//g, '')              // no path traversal
    .replace(/@/g, '')                   // no @ (URL auth bypass)
    .replace(/\/\//g, '/')               // no double slashes
  // Block access to cloud metadata endpoints via query string tricks
  const blocked = ['169.254', 'metadata', 'localhost', '127.0.0.1', '0.0.0.0']
  if (blocked.some(b => cleaned.toLowerCase().includes(b))) {
    throw new Error('Path not allowed')
  }
  return cleaned.startsWith('/') ? cleaned : '/' + cleaned
}

export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  if (session.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 })

  const body = await req.json()
  const { service_id, connection_id, method = 'GET', path = '/', query_params = {}, body: reqBody, custom_headers = {} } = body

  // Validate method
  const allowedMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']
  if (!allowedMethods.includes(method)) return Response.json({ error: 'Invalid method' }, { status: 400 })

  // Validate and sanitise path
  let safePath: string
  try { safePath = validatePath(path) }
  catch (e) { return Response.json({ ok: false, error: (e instanceof Error ? e.message : 'Invalid path') }, { status: 400 }) }

  const sql = getDb()
  const svcRows = await sql`SELECT * FROM api_services WHERE id = ${service_id}`
  if (!svcRows.length) return Response.json({ ok: false, error: 'Service not found' }, { status: 404 })
  const svc = svcRows[0]

  // Validate base_url is http/https only (no file://, ftp://, etc.)
  const baseUrl = svc.base_url as string
  if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
    return Response.json({ ok: false, error: 'Service base URL must be http or https' }, { status: 400 })
  }

  let basePath = ''
  if (connection_id) {
    const connRows = await sql`SELECT * FROM api_connections WHERE id = ${connection_id}`
    if (connRows.length) basePath = (connRows[0].base_path as string) || ''
  }

  const base = baseUrl.replace(/\/$/, '')
  const bp = basePath.replace(/\/$/, '')
  let url = base + bp + safePath

  const qp = Object.entries(query_params as Record<string, string>)
    .filter(([k, v]) => k && String(v).trim() !== '')
    .slice(0, 20) // cap query params
  if (qp.length) url += '?' + qp.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&')

  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Accept': 'application/json' }
  try { Object.assign(headers, JSON.parse((svc.default_headers as string) || '{}')) } catch {}

  let authConfig: Record<string, string> = {}
  try { authConfig = JSON.parse(decrypt(svc.auth_config as string || '')) } catch {}
  const authType = svc.auth_type as string
  if (authType === 'bearer' && authConfig.token) headers['Authorization'] = `Bearer ${authConfig.token}`
  else if (authType === 'api_key_header' && authConfig.header && authConfig.key) headers[authConfig.header] = authConfig.key
  else if (authType === 'basic' && authConfig.username && authConfig.password) headers['Authorization'] = 'Basic ' + Buffer.from(`${authConfig.username}:${authConfig.password}`).toString('base64')
  else if (authType === 'oauth2_client') {
    const accessToken = await getOAuth2AccessToken(svc.id as string, authConfig)
    if (accessToken) {
      const prefix = authConfig.header_prefix || 'Bearer'
      headers['Authorization'] = `${prefix} ${accessToken}`
    } else {
      return Response.json({ ok: false, error: 'OAuth2 token fetch failed. Check client_id, client_secret, token_url, and refresh_token.' }, { status: 400 })
    }
  }

  if (svc.api_version && svc.version_header) headers[svc.version_header as string] = svc.api_version as string

  // Only allow safe custom headers (no auth override, no host spoofing)
  const blockedHeaders = ['host', 'authorization', 'cookie', 'x-forwarded-for']
  for (const [k, v] of Object.entries(custom_headers as Record<string, string>)) {
    if (!blockedHeaders.includes(k.toLowerCase())) headers[k] = v
  }

  const start = Date.now()
  try {
    const fetchOpts: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout((svc.request_timeout_ms as number) || 30000),
    }
    if (['POST', 'PUT', 'PATCH'].includes(method) && reqBody) {
      fetchOpts.body = typeof reqBody === 'string' ? reqBody : JSON.stringify(reqBody)
    }
    const res = await fetch(url, fetchOpts)
    const latencyMs = Date.now() - start
    const contentType = res.headers.get('content-type') || ''
    const responseHeaders: Record<string, string> = {}
    res.headers.forEach((v, k) => { responseHeaders[k] = v })
    let responseBody: unknown
    if (contentType.includes('application/json')) responseBody = await res.json()
    else responseBody = await res.text()
    return Response.json({ ok: res.ok, status: res.status, statusText: res.statusText, latencyMs, url, headers: responseHeaders, body: responseBody })
  } catch (e) {
    return Response.json({ ok: false, status: 0, latencyMs: Date.now() - start, url, error: (e instanceof Error ? e.message : 'Request failed') })
  }
}
