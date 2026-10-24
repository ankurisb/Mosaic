// lib/api-probe.ts
// Shared, SSRF-guarded execution of a live API call against an inline candidate
// (unsaved service + connection + auth). One code path for: the Try-It / probe
// route, and the agentic builder's own probing — so what the agent verifies is
// exactly what runs in production. Also exposes inspectLogin: a raw POST to a
// login endpoint that returns the untouched response body, which is how the
// agent discovers WHERE the token lives (e.g. tokens.access vs access_token).
import { applyAuth, type AuthConfig } from '@/lib/api-auth'
import { assertUrlSafe } from '@/lib/ssrf-guard'
import { buildMtlsDispatcher, fetchWithDispatcher } from '@/lib/api-mtls'

export interface ProbeInput {
  cacheKey: string
  baseUrl: string
  basePath?: string
  authType: string
  authConfig: AuthConfig
  defaultHeaders?: Record<string, string>
  apiVersion?: string
  versionHeader?: string
  timeoutMs?: number
  method: string
  path: string
  queryParams?: Record<string, string>
  reqBody?: unknown
  customHeaders?: Record<string, string>
  // 'lan' (default for unsaved candidates): allow on-prem/LAN hosts, block
  // loopback + cloud metadata. 'off': trusted saved service, skip the re-check.
  ssrf?: 'lan' | 'strict' | 'off'
}

export interface ProbeOutcome {
  ok: boolean
  status: number
  latencyMs: number
  url: string
  headers?: Record<string, string>
  body?: unknown
  error?: string
}

const BLOCKED_HEADERS = ['host', 'authorization', 'cookie', 'x-forwarded-for']

function buildUrl(baseUrl: string, basePath: string, path: string, queryParams?: Record<string, string>): string {
  const base = baseUrl.replace(/\/$/, '')
  const bp = (basePath || '').replace(/\/$/, '')
  let p = path || ''
  if (p && !p.startsWith('/') && !p.startsWith('?')) p = '/' + p
  let url = base + bp + p
  const qp = Object.entries(queryParams || {}).filter(([k, v]) => k && String(v).trim() !== '').slice(0, 30)
  if (qp.length) url += (url.includes('?') ? '&' : '?') + qp.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&')
  return url
}

/** Resolve a session_token login URL (absolute, or relative to base) for SSRF-checking. */
export function resolveLoginUrl(loginUrl: string, baseUrl: string): string | null {
  if (!loginUrl) return null
  if (/^https?:\/\//i.test(loginUrl)) return loginUrl
  const base = baseUrl.replace(/\/$/, '')
  if (!base) return null
  return base + (loginUrl.startsWith('/') ? loginUrl : '/' + loginUrl)
}

/** Run a single live API call against an inline candidate, returning a structured outcome. */
export async function runCandidateProbe(input: ProbeInput): Promise<ProbeOutcome> {
  const mode = input.ssrf ?? 'lan'
  const url = buildUrl(input.baseUrl, input.basePath || '', input.path, input.queryParams)

  if (mode !== 'off') {
    const safe = await assertUrlSafe(url, mode)
    if (!safe.ok) return { ok: false, status: 0, latencyMs: 0, url, error: `Blocked: ${safe.reason}` }
    if (input.authType === 'session_token') {
      const lu = resolveLoginUrl(String(input.authConfig.login_url || ''), input.baseUrl)
      if (lu) {
        const ls = await assertUrlSafe(lu, mode)
        if (!ls.ok) return { ok: false, status: 0, latencyMs: 0, url, error: `Blocked login URL: ${ls.reason}` }
      }
    }
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json', ...(input.defaultHeaders || {}) }
  const auth = await applyAuth(input.cacheKey, input.authType, input.authConfig, headers, input.baseUrl)
  if (!auth.ok) return { ok: false, status: 0, latencyMs: 0, url, error: (auth as { ok: false; error: string }).error }
  if (input.apiVersion && input.versionHeader) headers[input.versionHeader] = input.apiVersion
  for (const [k, v] of Object.entries(input.customHeaders || {})) {
    if (!BLOCKED_HEADERS.includes(k.toLowerCase())) headers[k] = v
  }

  const start = Date.now()
  try {
    const opts: RequestInit = { method: input.method, headers, signal: AbortSignal.timeout(input.timeoutMs || 30000) }
    if (['POST', 'PUT', 'PATCH'].includes(input.method) && input.reqBody) {
      opts.body = typeof input.reqBody === 'string' ? input.reqBody : JSON.stringify(input.reqBody)
    }
    // x509 / mTLS: present the client cert during the TLS handshake via an
    // undici dispatcher. Undefined for every non-mTLS service → plain fetch.
    const dispatcher = buildMtlsDispatcher(input.authType, input.authConfig)
    const res = await fetchWithDispatcher(url, opts as unknown as Record<string, unknown>, dispatcher)
    const latencyMs = Date.now() - start
    const ct = res.headers.get('content-type') || ''
    const outHeaders: Record<string, string> = {}
    res.headers.forEach((v, k) => { outHeaders[k] = v })
    let body: unknown
    const text = await res.text()
    if (ct.includes('application/json')) { try { body = JSON.parse(text) } catch { body = text } }
    else body = text
    return { ok: res.ok, status: res.status, latencyMs, url, headers: outHeaders, body }
  } catch (e) {
    return { ok: false, status: 0, latencyMs: Date.now() - start, url, error: e instanceof Error ? e.message : 'Request failed' }
  }
}

// ── Endpoint validation classifier ──────────────────────────────────────────
// Given a probe outcome for an endpoint group's root, decide what it actually
// is. This is the deterministic backbone behind best-effort discovery: whatever
// endpoints were registered (from a spec, a 404 pattern dump, or the model's
// guesses), this says which truly serve data — catching both the "module prefix
// that 404s / returns HTML" case and the "reachable but empty" case, with no LLM
// in the loop. Classes:
//   data  — 2xx with a non-empty record list (or a non-list object body)
//   empty — 2xx but the list is empty (often a missing required param)
//   dead  — 404, or 2xx HTML: not a real data endpoint (usually a module prefix)
//   auth  — 401/403: credentials/permission problem for this endpoint
//   error — 5xx / network / timeout
export type EpClass = 'data' | 'empty' | 'dead' | 'auth' | 'error'
export function classifyProbe(out: ProbeOutcome): { cls: EpClass; rows?: number; dataKey?: string; detail: string } {
  const status = out.status
  if (!status && out.error) return { cls: 'error', detail: out.error.slice(0, 140) }
  if (status === 401 || status === 403) return { cls: 'auth', detail: `HTTP ${status} — auth or permission` }
  if (status === 404) return { cls: 'dead', detail: 'HTTP 404 — not a data endpoint (likely a module prefix)' }
  if (status >= 500) return { cls: 'error', detail: `HTTP ${status}` }
  if (status >= 200 && status < 300) {
    let body: unknown = out.body
    if (typeof body === 'string') {
      if (/^\s*<(?:!doctype|html)/i.test(body)) return { cls: 'dead', detail: 'Returned an HTML page, not JSON data' }
      try { body = JSON.parse(body) } catch { return body.trim() ? { cls: 'data', detail: 'Returned text' } : { cls: 'empty', detail: 'Empty response' } }
    }
    if (Array.isArray(body)) return body.length ? { cls: 'data', rows: body.length, dataKey: '(root array)', detail: `${body.length} record${body.length === 1 ? '' : 's'}` } : { cls: 'empty', rows: 0, detail: 'Empty array' }
    if (body && typeof body === 'object') {
      const obj = body as Record<string, unknown>
      const key = Object.keys(obj).find(k => Array.isArray(obj[k]))
      if (key) { const n = (obj[key] as unknown[]).length; return n ? { cls: 'data', rows: n, dataKey: key, detail: `${n} record${n === 1 ? '' : 's'} under "${key}"` } : { cls: 'empty', rows: 0, dataKey: key, detail: `Empty "${key}" list` } }
      return { cls: 'data', dataKey: '(object)', detail: 'Object response (not a list)' }
    }
    return { cls: 'empty', detail: `HTTP ${status} — no data` }
  }
  return { cls: 'error', detail: `HTTP ${status}` }
}

export interface LoginInspect {
  baseUrl?: string
  login_url: string
  username: string
  password: string
  username_field?: string
  password_field?: string
  login_body_format?: 'json' | 'form'
  login_body_extra?: Record<string, unknown>
  ssrf?: 'lan' | 'strict' | 'off'
}

/**
 * POST credentials to a login endpoint and return the RAW response body — no
 * token extraction. This is how the agent learns the token's JSON path by
 * looking, instead of guessing 'access_token'.
 */
export async function inspectLogin(p: LoginInspect): Promise<{ ok: boolean; status: number; body: unknown; error?: string; resolvedUrl: string }> {
  const resolved = resolveLoginUrl(p.login_url, p.baseUrl || '') || p.login_url
  const mode = p.ssrf ?? 'lan'
  if (mode !== 'off') {
    const safe = await assertUrlSafe(resolved, mode)
    if (!safe.ok) return { ok: false, status: 0, body: null, error: `Blocked: ${safe.reason}`, resolvedUrl: resolved }
  }
  const userField = p.username_field || 'username'
  const passField = p.password_field || 'password'
  const bodyObj: Record<string, unknown> = { ...(p.login_body_extra || {}), [userField]: p.username, [passField]: p.password }
  const format = p.login_body_format === 'form' ? 'form' : 'json'
  try {
    const res = await fetch(resolved, {
      method: 'POST',
      headers: { 'Content-Type': format === 'form' ? 'application/x-www-form-urlencoded' : 'application/json', Accept: 'application/json' },
      body: format === 'form' ? new URLSearchParams(bodyObj as Record<string, string>).toString() : JSON.stringify(bodyObj),
      signal: AbortSignal.timeout(10000),
    })
    const text = await res.text()
    let body: unknown
    try { body = JSON.parse(text) } catch { body = text.slice(0, 2000) }
    return { ok: res.ok, status: res.status, body, resolvedUrl: resolved }
  } catch (e) {
    return { ok: false, status: 0, body: null, error: e instanceof Error ? e.message : 'Request failed', resolvedUrl: resolved }
  }
}
