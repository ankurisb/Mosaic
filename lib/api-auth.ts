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
//   - custom_headers    (arbitrary headers JSON, no further interpretation)
//
// OAuth2 grant flows handled inside getOAuth2AccessToken:
//   - refresh_token (long-lived refresh token mints short-lived access tokens)
//   - client_credentials (machine-to-machine, no user context)

import { decrypt, encrypt } from '@/lib/encrypt'
import { log } from './logger'
import { getDb, nowExpr } from '@/lib/db'

// -- Types -------------------------------------------------------

export type AuthType = 'bearer' | 'api_key_header' | 'basic' | 'oauth2_client' | 'custom_headers' | 'prism'

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
export type CustomHeadersAuth = Record<string, string>

// Loose union -- auth_config blobs are user-provided JSON; runtime checks
// inside applyAuth narrow per auth_type.
export type AuthConfig = Partial<BearerAuth & ApiKeyHeaderAuth & BasicAuth & OAuth2ClientAuth> & Record<string, string | undefined>

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
