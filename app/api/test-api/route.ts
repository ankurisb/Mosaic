import { getSession } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { applyAuth, parseAuthConfig, type AuthConfig } from '@/lib/api-auth'
import { assertUrlSafe } from '@/lib/ssrf-guard'
export const runtime = 'nodejs'

// This route runs a single live API call for admins. Two modes:
//   - by-id       : against a SAVED api_service (+ optional connection). The
//                   Try-It panel in Settings → API sources. Trusted config,
//                   may legitimately point at on-prem/LAN hosts, so no SSRF
//                   re-check (unchanged behaviour).
//   - candidate   : against an UNSAVED draft supplied inline. This is the
//                   ground-truth probe the AI API builder iterates against —
//                   nothing is persisted. Because the URL/creds are being
//                   authored (not yet saved/trusted), it is SSRF-guarded in
//                   'lan' mode: LAN targets are allowed (on-prem APIs are the
//                   point), loopback and cloud-metadata are blocked.
// Both modes share one execution path (performApiCall) so a probe that passes
// behaves identically once registered.

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
  const blocked = ['169.254', 'metadata', '127.0.0.1', '::1', '0.0.0.0']
  if (blocked.some(b => cleaned.toLowerCase().includes(b))) {
    throw new Error('Path not allowed')
  }
  return cleaned.startsWith('/') ? cleaned : '/' + cleaned
}

interface CallCtx {
  cacheKey: string                 // auth cache / status key (service id, or a synthetic probe id)
  baseUrl: string
  basePath: string
  authType: string
  authConfig: AuthConfig
  defaultHeaders: Record<string, string>
  apiVersion?: string
  versionHeader?: string
  timeoutMs: number
}

interface CallArgs {
  method: string
  safePath: string
  queryParams: Record<string, string>
  reqBody?: unknown
  customHeaders: Record<string, string>
}

// Resolve a session_token login URL (absolute, or relative to base_url) so it
// can be SSRF-checked before applyAuth fetches it internally.
function resolveLoginUrl(authConfig: AuthConfig, baseUrl: string): string | null {
  const raw = authConfig.login_url
  if (!raw) return null
  if (/^https?:\/\//i.test(raw)) return raw
  const base = baseUrl.replace(/\/$/, '')
  if (!base) return null
  return base + (raw.startsWith('/') ? raw : '/' + raw)
}

function buildUrl(ctx: CallCtx, args: CallArgs): string {
  const base = ctx.baseUrl.replace(/\/$/, '')
  const bp = ctx.basePath.replace(/\/$/, '')
  let url = base + bp + args.safePath
  const qp = Object.entries(args.queryParams)
    .filter(([k, v]) => k && String(v).trim() !== '')
    .slice(0, 20) // cap query params
  if (qp.length) url += '?' + qp.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&')
  return url
}

async function performApiCall(ctx: CallCtx, args: CallArgs): Promise<Response> {
  const url = buildUrl(ctx, args)

  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Accept': 'application/json', ...ctx.defaultHeaders }

  const authResult = await applyAuth(ctx.cacheKey, ctx.authType, ctx.authConfig, headers, ctx.baseUrl)
  if (!authResult.ok) {
    return Response.json({ ok: false, status: 0, url, error: (authResult as { ok: false; error: string }).error }, { status: 200 })
  }

  if (ctx.apiVersion && ctx.versionHeader) headers[ctx.versionHeader] = ctx.apiVersion

  // Only allow safe custom headers (no auth override, no host spoofing)
  const blockedHeaders = ['host', 'authorization', 'cookie', 'x-forwarded-for']
  for (const [k, v] of Object.entries(args.customHeaders)) {
    if (!blockedHeaders.includes(k.toLowerCase())) headers[k] = v
  }

  const start = Date.now()
  try {
    const fetchOpts: RequestInit = { method: args.method, headers, signal: AbortSignal.timeout(ctx.timeoutMs) }
    if (['POST', 'PUT', 'PATCH'].includes(args.method) && args.reqBody) {
      fetchOpts.body = typeof args.reqBody === 'string' ? args.reqBody : JSON.stringify(args.reqBody)
    }
    const res = await fetch(url, fetchOpts)
    const latencyMs = Date.now() - start
    const contentType = res.headers.get('content-type') || ''
    const responseHeaders: Record<string, string> = {}
    res.headers.forEach((v, k) => { responseHeaders[k] = v })
    let responseBody: unknown
    if (contentType.includes('application/json')) {
      try { responseBody = await res.json() } catch { responseBody = await res.text().catch(() => '') }
    } else {
      responseBody = await res.text()
    }
    return Response.json({ ok: res.ok, status: res.status, statusText: res.statusText, latencyMs, url, headers: responseHeaders, body: responseBody })
  } catch (e) {
    return Response.json({ ok: false, status: 0, latencyMs: Date.now() - start, url, error: (e instanceof Error ? e.message : 'Request failed') })
  }
}

export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  if (session.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 })

  const body = await req.json()
  const { method = 'GET', path = '/', query_params = {}, body: reqBody, custom_headers = {} } = body

  // Validate method
  const allowedMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']
  if (!allowedMethods.includes(method)) return Response.json({ error: 'Invalid method' }, { status: 400 })

  // Validate and sanitise path
  let safePath: string
  try { safePath = validatePath(path) }
  catch (e) { return Response.json({ ok: false, error: (e instanceof Error ? e.message : 'Invalid path') }, { status: 400 }) }

  const args: CallArgs = {
    method,
    safePath,
    queryParams: query_params as Record<string, string>,
    reqBody,
    customHeaders: custom_headers as Record<string, string>,
  }

  // ── Candidate (probe) mode ────────────────────────────────────────────────
  // An inline, unsaved draft from the AI builder. Nothing is persisted.
  const candidate = body.candidate as
    | { service?: Record<string, unknown>; connection?: Record<string, unknown>; probe_id?: string }
    | undefined
  if (candidate && candidate.service) {
    const svc = candidate.service
    const baseUrl = String(svc.base_url || '')
    if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
      return Response.json({ ok: false, error: 'Service base URL must be http or https' }, { status: 400 })
    }
    const authConfig = (svc.auth_config && typeof svc.auth_config === 'object'
      ? svc.auth_config : {}) as AuthConfig
    const authType = String(svc.auth_type || '')
    const defaultHeaders = (svc.default_headers && typeof svc.default_headers === 'object'
      ? svc.default_headers : {}) as Record<string, string>
    const basePath = String(candidate.connection?.base_path || '')

    const ctx: CallCtx = {
      cacheKey: String(candidate.probe_id || `probe:${baseUrl}:${authConfig.login_url || ''}:${authConfig.username || ''}`),
      baseUrl,
      basePath,
      authType,
      authConfig,
      defaultHeaders,
      apiVersion: svc.api_version ? String(svc.api_version) : undefined,
      versionHeader: svc.version_header ? String(svc.version_header) : undefined,
      timeoutMs: Number(svc.request_timeout_ms) || 30000,
    }

    // SSRF-guard the request URL and, for session_token, the login URL — 'lan'
    // mode so legitimate on-prem/LAN APIs work while loopback + cloud metadata
    // stay blocked.
    const reqUrl = buildUrl(ctx, args)
    const reqSafe = await assertUrlSafe(reqUrl, 'lan')
    if (!reqSafe.ok) return Response.json({ ok: false, error: `Blocked: ${reqSafe.reason}` }, { status: 400 })
    if (authType === 'session_token') {
      const loginUrl = resolveLoginUrl(authConfig, baseUrl)
      if (loginUrl) {
        const loginSafe = await assertUrlSafe(loginUrl, 'lan')
        if (!loginSafe.ok) return Response.json({ ok: false, error: `Blocked login URL: ${loginSafe.reason}` }, { status: 400 })
      }
    }

    return performApiCall(ctx, args)
  }

  // ── By-id mode (saved service) — unchanged behaviour ──────────────────────
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

  const ctx: CallCtx = {
    cacheKey: svc.id as string,
    baseUrl,
    basePath,
    authType: svc.auth_type as string,
    authConfig: parseAuthConfig(svc.auth_config as string),
    defaultHeaders,
    apiVersion: svc.api_version ? String(svc.api_version) : undefined,
    versionHeader: svc.version_header ? String(svc.version_header) : undefined,
    timeoutMs: (svc.request_timeout_ms as number) || 30000,
  }

  return performApiCall(ctx, args)
}
