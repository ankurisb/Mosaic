import { getSession } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { parseAuthConfig, type AuthConfig } from '@/lib/api-auth'
import { runCandidateProbe, type ProbeInput } from '@/lib/api-probe'
export const runtime = 'nodejs'

// Run a single live API call for admins. Two modes, one execution path
// (runCandidateProbe):
//   candidate : an inline, unsaved draft (the AI builder's probe) — SSRF-guarded
//               in 'lan' mode (on-prem APIs allowed; loopback + metadata blocked).
//   by-id     : a saved service (+ optional connection) — trusted config, may
//               legitimately point at on-prem hosts, so SSRF re-check is off.

function validatePath(path: string): string {
  if (typeof path !== 'string') return '/'
  const cleaned = path
    .replace(/^https?:\/\/[^/]*/i, '')
    .replace(/\.\.\//g, '')
    .replace(/@/g, '')
    .replace(/\/\//g, '/')
  const blocked = ['169.254', 'metadata', '127.0.0.1', '::1', '0.0.0.0']
  if (blocked.some(b => cleaned.toLowerCase().includes(b))) throw new Error('Path not allowed')
  return cleaned.startsWith('/') ? cleaned : '/' + cleaned
}

export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  if (session.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 })

  const body = await req.json()
  const { method = 'GET', path = '/', query_params = {}, body: reqBody, custom_headers = {} } = body

  const allowedMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']
  if (!allowedMethods.includes(method)) return Response.json({ error: 'Invalid method' }, { status: 400 })

  let safePath: string
  try { safePath = validatePath(path) }
  catch (e) { return Response.json({ ok: false, error: (e instanceof Error ? e.message : 'Invalid path') }, { status: 400 }) }

  // ── Candidate (probe) mode ────────────────────────────────────────────────
  const candidate = body.candidate as
    | { service?: Record<string, unknown>; connection?: Record<string, unknown>; probe_id?: string }
    | undefined
  if (candidate && candidate.service) {
    const svc = candidate.service
    const baseUrl = String(svc.base_url || '')
    if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
      return Response.json({ ok: false, error: 'Service base URL must be http or https' }, { status: 400 })
    }
    const input: ProbeInput = {
      cacheKey: String(candidate.probe_id || `probe:${baseUrl}`),
      baseUrl,
      basePath: String(candidate.connection?.base_path || ''),
      authType: String(svc.auth_type || ''),
      authConfig: (svc.auth_config && typeof svc.auth_config === 'object' ? svc.auth_config : {}) as AuthConfig,
      defaultHeaders: (svc.default_headers && typeof svc.default_headers === 'object' ? svc.default_headers : {}) as Record<string, string>,
      apiVersion: svc.api_version ? String(svc.api_version) : undefined,
      versionHeader: svc.version_header ? String(svc.version_header) : undefined,
      timeoutMs: Number(svc.request_timeout_ms) || 30000,
      method, path: safePath, queryParams: query_params as Record<string, string>, reqBody,
      customHeaders: custom_headers as Record<string, string>,
      ssrf: 'lan',
    }
    return Response.json(await runCandidateProbe(input))
  }

  // ── By-id mode (saved service) ────────────────────────────────────────────
  const { service_id, connection_id } = body
  const sql = getDb()
  const svcRows = await sql`SELECT * FROM api_services WHERE id = ${service_id}`
  if (!svcRows.length) return Response.json({ ok: false, error: 'Service not found' }, { status: 404 })
  const svc = svcRows[0]
  const baseUrl = svc.base_url as string
  if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
    return Response.json({ ok: false, error: 'Service base URL must be http or https' }, { status: 400 })
  }
  let basePath = ''
  if (connection_id) {
    const connRows = await sql`SELECT * FROM api_connections WHERE id = ${connection_id}`
    if (connRows.length) basePath = (connRows[0].base_path as string) || ''
  }
  let defaultHeaders: Record<string, string> = {}
  try { defaultHeaders = JSON.parse((svc.default_headers as string) || '{}') } catch {}

  const input: ProbeInput = {
    cacheKey: svc.id as string,
    baseUrl,
    basePath,
    authType: svc.auth_type as string,
    authConfig: parseAuthConfig(svc.auth_config as string),
    defaultHeaders,
    apiVersion: svc.api_version ? String(svc.api_version) : undefined,
    versionHeader: svc.version_header ? String(svc.version_header) : undefined,
    timeoutMs: (svc.request_timeout_ms as number) || 30000,
    method, path: safePath, queryParams: query_params as Record<string, string>, reqBody,
    customHeaders: custom_headers as Record<string, string>,
    ssrf: 'off',
  }
  return Response.json(await runCandidateProbe(input))
}
