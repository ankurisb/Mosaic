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

export async function getOAuth2AccessToken(
  serviceId: string,
  authConfig: AuthConfig
): Promise<string | null> {
  const cached = oauth2TokenCache.get(serviceId)
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token

  if (!authConfig.token_url || !authConfig.client_id || !authConfig.client_secret) return null

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
    if (!res.ok) {
      console.error(`OAuth2 token fetch failed: ${res.status} ${await res.text()}`)
      return null
    }
    const data = await res.json() as { access_token: string; expires_in?: number }
    const expiresIn = (data.expires_in || 3600) * 1000
    oauth2TokenCache.set(serviceId, { token: data.access_token, expiresAt: Date.now() + expiresIn })
    return data.access_token
  } catch (e) {
    console.error('OAuth2 token fetch error:', e)
    return null
  }
}

// -- Auth application -------------------------------------------

export type ApplyAuthResult = { ok: true } | { ok: false; error: string }

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
    const accessToken = await getOAuth2AccessToken(serviceId, authConfig)
    if (!accessToken) {
      return {
        ok: false,
        error: 'OAuth2 token fetch failed. Check client_id, client_secret, token_url, and refresh_token.'
      }
    }
    const prefix = authConfig.header_prefix || 'Bearer'
    headers['Authorization'] = `${prefix} ${accessToken}`
    return { ok: true }
  }

  // Unknown / no auth / partial config: leave headers as-is.
  return { ok: true }
}
