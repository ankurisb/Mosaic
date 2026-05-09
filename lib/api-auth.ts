// OAuth2 token cache and fetcher for API services.
//
// Supports two grant flows:
//   - refresh_token (long-lived refresh token mints short-lived access tokens)
//   - client_credentials (machine-to-machine, no user context)
//
// Tokens are cached in-memory per serviceId until 60s before expiry.
// Cache is process-local; in multi-instance deployments each instance
// will mint its own tokens, which is fine for our deployment model.

const oauth2TokenCache = new Map<string, { token: string; expiresAt: number }>()

export async function getOAuth2AccessToken(
  serviceId: string,
  authConfig: Record<string, string>
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
