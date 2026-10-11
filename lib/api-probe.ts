// lib/api-probe.ts
// Shared, SSRF-guarded execution of a live API call against an inline candidate
// (unsaved service + connection + auth). One code path for: the Try-It / probe
// route, and the agentic builder's own probing — so what the agent verifies is
// exactly what runs in production. Also exposes inspectLogin: a raw POST to a
// login endpoint that returns the untouched response body, which is how the
// agent discovers WHERE the token lives (e.g. tokens.access vs access_token).
import { applyAuth, type AuthConfig } from '@/lib/api-auth'
import { assertUrlSafe } from '@/lib/ssrf-guard'

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
    const res = await fetch(url, opts)
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
