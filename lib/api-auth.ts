// API service auth: types, parsing, and header application.
//
// Single source of truth for "given a stored auth_config, set the right
// headers on an outgoing request to a customer's API". Both lib/tools.ts
// (chat-driven calls) and app/api/test-api (manual Try-It) share this code.
//
// Supported auth_type values:
//   - bearer            (Authorization: Bearer <token>)
//   - api_key_header    (X-Custom-Header: <key>)
//   - basic             (Authorization: Basic <base64(user:pass)>)
//   - oauth2_client     (mints access tokens via refresh_token or
//                        client_credentials grant; configurable header prefix)
//   - session_token     (generic username/password login endpoint that returns
//                        a token in its JSON body; configurable login URL, body
//                        shape, token JSON-path and header — covers APIs like
//                        Terralayr: POST creds -> {access_token} -> Bearer)
//   - custom_headers    (arbitrary headers JSON, no further interpretation)
//
// OAuth2 grant flows handled inside getOAuth2AccessToken:
//   - refresh_token (long-lived refresh token mints short-lived access tokens)
//   - client_credentials (machine-to-machine, no user context)

import { decrypt, encrypt } from '@/lib/encrypt'
import { log } from './logger'
import { getDb, nowExpr } from '@/lib/db'

// -- Types -------------------------------------------------------

export type AuthType = 'bearer' | 'api_key_header' | 'basic' | 'oauth2_client' | 'session_token' | 'custom_headers' | 'prism'

export interface BearerAuth { token: string }
export interface ApiKeyHeaderAuth { header: string; key: string }
export interface BasicAuth { username: string; password: string }
export interface OAuth2ClientAuth {
  client_id: string
  client_secret: string
  token_url: string
  refresh_token?: string
  header_prefix?: string
}
/**
 * Generic login-endpoint auth: POST credentials to a login URL, read a token
 * out of the JSON response, and send it on every request. Everything about the
 * shape is configurable so one auth type covers the long tail of bespoke login
 * flows. Only `login_url`, `username` and `password` are required; the rest
 * default to the most common conventions.
 */
export interface SessionTokenAuth {
  login_url: string              // absolute, or relative to the service base_url
  username: string
  password: string
  username_field?: string        // body key for the username (default 'username')
  password_field?: string        // body key for the password (default 'password')
  login_body_format?: 'json' | 'form' // default 'json'
  login_body_extra?: string      // JSON object string merged into the login body (e.g. {"grant_type":"password"})
  token_path?: string            // dot-path to the token in the response (default 'access_token')
  token_header?: string          // header to set the token on (default 'Authorization')
  token_prefix?: string          // value prefix (default 'Bearer'; '' for a bare token)
  expiry_path?: string           // dot-path to a lifetime-in-seconds field, if the API returns one
  token_ttl_seconds?: string     // fallback lifetime when no expiry is discoverable (default 3600)
}
export type CustomHeadersAuth = Record<string, string>

// Loose union -- auth_config blobs are user-provided JSON; runtime checks
// inside applyAuth narrow per auth_type.
export type AuthConfig = Partial<BearerAuth & ApiKeyHeaderAuth & BasicAuth & OAuth2ClientAuth & SessionTokenAuth> & Record<string, string | undefined>

// -- Parsing -----------------------------------------------------

export function parseAuthConfig(encrypted: string | null | undefined): AuthConfig {
  if (!encrypted) return {}
  try {
    return JSON.parse(decrypt(encrypted)) as AuthConfig
  } catch {
    return {}
  }
}

// -- OAuth2 token cache & fetcher -------------------------------

const oauth2TokenCache = new Map<string, { token: string; expiresAt: number }>()

export type OAuth2TokenResult =
  | { ok: true; token: string }
  | { ok: false; error: string }

/**
 * Mints an OAuth2 access token. Returns ok:true with the token on success,
 * or ok:false with a descriptive error from the upstream provider on failure.
 *
 * The error field tries to surface the most actionable info: for standard
 * RFC 6749 errors (invalid_grant, invalid_client, etc.) it returns the
 * error code with description; for non-standard responses it falls back
 * to the raw response body.
 */
export async function getOAuth2AccessToken(
  serviceId: string,
  authConfig: AuthConfig
): Promise<OAuth2TokenResult> {
  const cached = oauth2TokenCache.get(serviceId)
  if (cached && cached.expiresAt > Date.now() + 60_000) return { ok: true, token: cached.token }

  if (!authConfig.token_url || !authConfig.client_id || !authConfig.client_secret) {
    return { ok: false, error: 'Missing required fields: client_id, client_secret, or token_url' }
  }

  const params = new URLSearchParams()
  params.set('client_id', authConfig.client_id)
  params.set('client_secret', authConfig.client_secret)
  if (authConfig.refresh_token) {
    params.set('grant_type', 'refresh_token')
    params.set('refresh_token', authConfig.refresh_token)
  } else {
    params.set('grant_type', 'client_credentials')
  }

  try {
    const res = await fetch(authConfig.token_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: AbortSignal.timeout(10000),
    })
    const bodyText = await res.text()
    if (!res.ok) {
      // RFC 6749: error responses are JSON with 'error' and optional 'error_description'
      let parsed: { error?: string; error_description?: string } | null = null
      try { parsed = JSON.parse(bodyText) } catch {}
      const errCode = parsed?.error || `HTTP ${res.status}`
      const errDesc = parsed?.error_description ? `: ${parsed.error_description}` : ''
      const truncated = !parsed && bodyText.length > 200 ? bodyText.slice(0, 200) + '...' : bodyText
      const error = parsed ? `${errCode}${errDesc}` : `${errCode}: ${truncated}`
      log.error({ service: 'api-auth' }, `OAuth2 token fetch failed (service=${serviceId}): ${error}`)
      // Revocation signals (invalid_grant, invalid_token) mean any cached token
      // is now dead — evict it so the next call retries immediately rather than
      // serving a stale token for the remainder of its TTL (up to 59 min).
      const REVOCATION_CODES = ['invalid_grant', 'invalid_token', 'token_expired', 'access_denied']
      if (errCode && REVOCATION_CODES.some(c => errCode.toLowerCase().includes(c))) {
        oauth2TokenCache.delete(serviceId)
      }
      return { ok: false, error }
    }
    const data = JSON.parse(bodyText) as { access_token: string; expires_in?: number }
    if (!data.access_token) {
      return { ok: false, error: 'Token endpoint returned no access_token' }
    }
    const expiresIn = (data.expires_in || 3600) * 1000
    oauth2TokenCache.set(serviceId, { token: data.access_token, expiresAt: Date.now() + expiresIn })
    return { ok: true, token: data.access_token }
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Network error contacting token endpoint'
    log.error({ service: 'api-auth', err: e }, `OAuth2 token fetch error (service=${serviceId}):`)
    return { ok: false, error }
  }
}

// -- Generic session-token (login endpoint) auth ----------------
// POST credentials to a login URL, read the token out of the JSON body at a
// configurable path, cache it until it expires, and re-login when it does.
// No refresh-token dance (that's oauth2_client / prism) — login APIs of this
// shape are cheap to re-hit, so expiry just triggers a fresh login.

const sessionTokenCache = new Map<string, { token: string; expiresAt: number }>()

/** Read a nested value by dot-path (e.g. "data.access_token"); undefined if absent. */
function getByPath(obj: unknown, path: string): unknown {
  if (!path) return undefined
  return path.split('.').reduce<unknown>(
    (acc, k) => (acc && typeof acc === 'object') ? (acc as Record<string, unknown>)[k] : undefined,
    obj,
  )
}

export type SessionTokenResult =
  | { ok: true; token: string; header: string; prefix: string }
  | { ok: false; error: string }

export async function getSessionToken(
  serviceId: string,
  baseUrl: string | undefined,
  authConfig: AuthConfig,
): Promise<SessionTokenResult> {
  const header = authConfig.token_header || 'Authorization'
  const prefix = authConfig.token_prefix ?? 'Bearer'
  const now = Date.now()

  const cached = sessionTokenCache.get(serviceId)
  if (cached && cached.expiresAt > now + 60_000) {
    return { ok: true, token: cached.token, header, prefix }
  }

  if (!authConfig.login_url) return { ok: false, error: 'session_token auth requires login_url' }
  const { username, password } = authConfig
  if (!username || !password) return { ok: false, error: 'session_token auth requires username and password' }

  // Resolve a relative login_url against the service base URL.
  let loginUrl = authConfig.login_url
  if (!/^https?:\/\//i.test(loginUrl)) {
    const base = (baseUrl || '').replace(/\/$/, '')
    if (!base) return { ok: false, error: 'session_token login_url is relative but no base_url is set' }
    loginUrl = base + (loginUrl.startsWith('/') ? loginUrl : '/' + loginUrl)
  }

  const userField = authConfig.username_field || 'username'
  const passField = authConfig.password_field || 'password'
  let extra: Record<string, unknown> = {}
  if (authConfig.login_body_extra) {
    try { extra = JSON.parse(authConfig.login_body_extra) as Record<string, unknown> } catch {}
  }
  const bodyObj: Record<string, unknown> = { ...extra, [userField]: username, [passField]: password }
  const format = authConfig.login_body_format === 'form' ? 'form' : 'json'

  try {
    const res = await fetch(loginUrl, {
      method: 'POST',
      headers: {
        'Content-Type': format === 'form' ? 'application/x-www-form-urlencoded' : 'application/json',
        Accept: 'application/json',
      },
      body: format === 'form'
        ? new URLSearchParams(bodyObj as Record<string, string>).toString()
        : JSON.stringify(bodyObj),
      signal: AbortSignal.timeout(10000),
    })
    const bodyText = await res.text()
    if (!res.ok) {
      let msg = `HTTP ${res.status}`
      try {
        const j = JSON.parse(bodyText)
        msg = j.message || j.error_description || j.error || j.errorCode || msg
      } catch { if (bodyText) msg = `${msg}: ${bodyText.slice(0, 200)}` }
      sessionTokenCache.delete(serviceId)
      return { ok: false, error: `Login failed: ${msg}` }
    }

    let data: unknown
    try { data = JSON.parse(bodyText) } catch { return { ok: false, error: 'Login response was not JSON' } }

    const tokenPath = authConfig.token_path || 'access_token'
    const token = getByPath(data, tokenPath)
    if (typeof token !== 'string' || !token) {
      return { ok: false, error: `No token found at path "${tokenPath}" in the login response` }
    }

    // Expiry precedence: an explicit lifetime field -> the JWT's own exp -> a
    // configured fallback TTL -> 1 hour.
    let expiresAt: number
    const expVal = authConfig.expiry_path ? getByPath(data, authConfig.expiry_path) : undefined
    if (typeof expVal === 'number' && expVal > 0) expiresAt = now + expVal * 1000
    else if (typeof expVal === 'string' && /^\d+$/.test(expVal)) expiresAt = now + Number(expVal) * 1000
    else {
      const jwtExp = jwtExpiry(token)
      if (jwtExp) expiresAt = jwtExp
      else {
        const ttl = authConfig.token_ttl_seconds && /^\d+$/.test(authConfig.token_ttl_seconds)
          ? Number(authConfig.token_ttl_seconds) : 3600
        expiresAt = now + ttl * 1000
      }
    }

    sessionTokenCache.set(serviceId, { token, expiresAt })
    return { ok: true, token, header, prefix }
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Network error contacting login endpoint'
    log.error({ service: 'api-auth', err: e }, `session_token login error (service=${serviceId}):`)
    return { ok: false, error }
  }
}

/** Invalidate a cached session token — call after a 401 so the next call re-logs in. */
export function invalidateSessionToken(serviceId: string): void {
  sessionTokenCache.delete(serviceId)
}

// -- Prism IoT platform JWT auth --------------------------------
// Prism uses username/password → JWT (not OAuth2).
// POST {baseUrl}/api/auth/login → { token, refreshToken }
// token is a JWT with exp field; default lifetime ~2.5h.
// refreshToken lifetime ~1 week; POST /api/auth/token to re-mint.
// Header used: X-Authorization: Bearer <token>

interface PrismTokenCache {
  token: string
  refreshToken: string
  expiresAt: number        // access token expiry ms
  refreshExpiresAt: number // refresh token expiry ms
}
const prismTokenCache = new Map<string, PrismTokenCache>()

export type PrismTokenResult = { ok: true; token: string } | { ok: false; error: string }

/** Decode JWT exp claim without a library — just base64-decode the payload. */
function jwtExpiry(token: string): number | null {
  try {
    const payload = token.split('.')[1]
    const padded = payload + '='.repeat((4 - payload.length % 4) % 4)
    const data = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'))
    return data.exp ? data.exp * 1000 : null
  } catch { return null }
}

export async function getPrismToken(
  instanceId: string,
  baseUrl: string,
  authConfig: AuthConfig
): Promise<PrismTokenResult> {
  let cached = prismTokenCache.get(instanceId)
  const now = Date.now()

  // On cold start (no in-memory cache), try seeding from DB-stored tokens
  if (!cached) {
    try {
      const sql = getDb()
      const rows = await sql`SELECT token_enc, refresh_token_enc, token_expiry FROM prism_instances WHERE id=${instanceId} AND active = true`
      if (rows.length && rows[0].token_enc && rows[0].token_expiry) {
        const storedExpiry = Number(rows[0].token_expiry)
        const storedToken = decrypt(rows[0].token_enc as string)
        const storedRefresh = rows[0].refresh_token_enc ? decrypt(rows[0].refresh_token_enc as string) : ''
        if (storedToken && storedExpiry > now + 60_000) {
          // Token still valid — seed cache and return immediately (no network call)
          const entry: PrismTokenCache = {
            token: storedToken,
            refreshToken: storedRefresh,
            expiresAt: storedExpiry,
            refreshExpiresAt: now + 7 * 24 * 60 * 60 * 1000,
          }
          prismTokenCache.set(instanceId, entry)
          cached = entry
        } else if (storedRefresh) {
          // Access token stale but refresh token present — seed cache so refresh path fires
          prismTokenCache.set(instanceId, {
            token: '',
            refreshToken: storedRefresh,
            expiresAt: 0,
            refreshExpiresAt: now + 7 * 24 * 60 * 60 * 1000,
          })
          cached = prismTokenCache.get(instanceId)!
        }
      }
    } catch { /* non-blocking — fall through to fresh login */ }
  }

  // Valid access token still in cache
  if (cached && cached.expiresAt > now + 60_000) {
    return { ok: true, token: cached.token }
  }

  // Access token expired but refresh token valid — re-mint silently
  if (cached && cached.refreshExpiresAt > now + 60_000) {
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/auth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: cached.refreshToken }),
        signal: AbortSignal.timeout(10000),
      })
      if (res.ok) {
        const data = await res.json() as { token: string; refreshToken: string }
        const expiry = jwtExpiry(data.token) ?? now + 2.5 * 60 * 60 * 1000
        const newRefresh = data.refreshToken || cached.refreshToken
        prismTokenCache.set(instanceId, {
          token: data.token,
          refreshToken: newRefresh,
          expiresAt: expiry,
          refreshExpiresAt: now + 7 * 24 * 60 * 60 * 1000,
        })
        persistPrismTokens(instanceId, data.token, newRefresh, expiry)
        return { ok: true, token: data.token }
      }
      prismTokenCache.delete(instanceId)
    } catch {
      prismTokenCache.delete(instanceId)
    }
  }

  // Full login
  const { username, password } = authConfig
  if (!username || !password) {
    return { ok: false, error: 'Prism auth requires username and password' }
  }
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      signal: AbortSignal.timeout(10000),
    })
    const bodyText = await res.text()
    if (!res.ok) {
      let msg = `HTTP ${res.status}`
      try { const j = JSON.parse(bodyText); msg = j.message || j.errorCode || msg } catch {}
      return { ok: false, error: `Prism login failed: ${msg}` }
    }
    const data = JSON.parse(bodyText) as { token: string; refreshToken: string }
    if (!data.token) return { ok: false, error: 'Prism login: no token in response' }
    const expiry = jwtExpiry(data.token) ?? now + 2.5 * 60 * 60 * 1000
    const refreshToken = data.refreshToken || ''
    prismTokenCache.set(instanceId, {
      token: data.token,
      refreshToken,
      expiresAt: expiry,
      refreshExpiresAt: now + 7 * 24 * 60 * 60 * 1000,
    })
    persistPrismTokens(instanceId, data.token, refreshToken, expiry)
    return { ok: true, token: data.token }
  } catch (e) {
    const error = e instanceof Error ? e.message : 'Network error connecting to Prism'
    log.error({ service: 'api-auth', err: e }, `Prism login error (instance=${instanceId}):`)
    return { ok: false, error }
  }
}

/** Invalidate a cached Prism token — call after 401 responses. */
export function invalidatePrismToken(instanceId: string): void {
  prismTokenCache.delete(instanceId)
}

/**
 * Persist encrypted tokens back to prism_instances so the in-memory cache
 * can be seeded on the next server start, avoiding an unnecessary re-login.
 * Fire-and-forget — token writeback failures must never block the request.
 */
function persistPrismTokens(instanceId: string, token: string, refreshToken: string, expiresAt: number): void {
  try {
    const sql = getDb()
    const token_enc = encrypt(token)
    const refresh_token_enc = refreshToken ? encrypt(refreshToken) : null
    void sql`
      UPDATE prism_instances
      SET token_enc=${token_enc}, refresh_token_enc=${refresh_token_enc},
          token_expiry=${expiresAt}, updated_at=${nowExpr()}
      WHERE id=${instanceId}
    `.catch(() => {}) // swallow — table may not exist in test environments
  } catch { /* non-blocking */ }
}

// -- Auth application -------------------------------------------

export type ApplyAuthResult = { ok: true } | { ok: false; error: string }

/**
 * Records the result of an OAuth2 token-fetch attempt against api_services.
 * Fire-and-forget: errors writing to the DB are swallowed so the auth flow
 * is never blocked by status tracking.
 */
async function recordAuthStatus(serviceId: string, ok: boolean, error: string | null): Promise<void> {
  try {
    const sql = getDb()
    const status = ok ? 'ok' : 'broken'
    const now = Date.now()
    await sql`UPDATE api_services SET auth_status=${status}, last_auth_error=${error}, last_auth_check=${now} WHERE id=${serviceId}`
  } catch (e) {
    log.error({ service: 'api-auth', err: e }, 'Failed to record auth status:')
  }
}

/**
 * Mutates `headers` to include authentication for the given service.
 * Returns ok:true on success, ok:false with an error message if auth could
 * not be applied (e.g. OAuth2 token fetch failed). Missing fields for an
 * auth_type are treated as "no auth applied" and return ok:true silently --
 * this matches existing behaviour where partially-configured services
 * still try the request and let the upstream API reject.
 */
export async function applyAuth(
  serviceId: string,
  authType: string,
  authConfig: AuthConfig,
  headers: Record<string, string>,
  baseUrl?: string
): Promise<ApplyAuthResult> {
  if (authType === 'bearer' && authConfig.token) {
    headers['Authorization'] = `Bearer ${authConfig.token}`
    return { ok: true }
  }

  if (authType === 'api_key_header' && authConfig.header && authConfig.key) {
    headers[authConfig.header] = authConfig.key
    return { ok: true }
  }

  if (authType === 'basic' && authConfig.username && authConfig.password) {
    const encoded = Buffer.from(`${authConfig.username}:${authConfig.password}`).toString('base64')
    headers['Authorization'] = `Basic ${encoded}`
    return { ok: true }
  }

  if (authType === 'oauth2_client') {
    const result = await getOAuth2AccessToken(serviceId, authConfig)
    if (!result.ok) {
      const err = (result as { ok: false; error: string }).error
      void recordAuthStatus(serviceId, false, err)
      return { ok: false, error: `OAuth2 token fetch failed: ${err}` }
    }
    void recordAuthStatus(serviceId, true, null)
    const prefix = authConfig.header_prefix || 'Bearer'
    headers['Authorization'] = `${prefix} ${result.token}`
    return { ok: true }
  }

  if (authType === 'session_token') {
    const result = await getSessionToken(serviceId, baseUrl || authConfig.base_url, authConfig)
    if (!result.ok) {
      const err = (result as { ok: false; error: string }).error
      void recordAuthStatus(serviceId, false, err)
      return { ok: false, error: err }
    }
    void recordAuthStatus(serviceId, true, null)
    headers[result.header] = result.prefix ? `${result.prefix} ${result.token}` : result.token
    return { ok: true }
  }

  if (authType === 'prism') {
    const prismBase = baseUrl || authConfig.base_url || ''
    if (!prismBase) return { ok: false, error: 'Prism auth requires base_url' }
    const result = await getPrismToken(serviceId, prismBase, authConfig)
    if (!result.ok) {
      const err = (result as { ok: false; error: string }).error
      void recordAuthStatus(serviceId, false, err)
      return { ok: false, error: err }
    }
    void recordAuthStatus(serviceId, true, null)
    // Prism uses X-Authorization, not Authorization
    headers['X-Authorization'] = `Bearer ${result.token}`
    return { ok: true }
  }

  // Unknown / no auth / partial config: leave headers as-is.
  return { ok: true }
}
