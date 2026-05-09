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

import { decrypt } from '@/lib/encrypt'
import { getDb } from '@/lib/db'

// -- Types -------------------------------------------------------

export type AuthType = 'bearer' | 'api_key_header' | 'basic' | 'oauth2_client' | 'custom_headers'

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
      console.error(`OAuth2 token fetch failed (service=${serviceId}): ${error}`)
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
    console.error(`OAuth2 token fetch error (service=${serviceId}):`, e)
    return { ok: false, error }
  }
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
    console.error('Failed to record auth status:', e)
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
  headers: Record<string, string>
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
      void recordAuthStatus(serviceId, false, result.error)
      return { ok: false, error: `OAuth2 token fetch failed: ${result.error}` }
    }
    void recordAuthStatus(serviceId, true, null)
    const prefix = authConfig.header_prefix || 'Bearer'
    headers['Authorization'] = `${prefix} ${result.token}`
    return { ok: true }
  }

  // Unknown / no auth / partial config: leave headers as-is.
  return { ok: true }
}
