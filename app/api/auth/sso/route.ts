// app/api/auth/sso/route.ts
// Initiates SSO login redirect for Microsoft, Google, Keycloak, or any OIDC provider.
// Fetches the OIDC discovery document for Keycloak/generic so auth endpoints are
// always current without hard-coding per-version URLs.
import { getDb } from '@/lib/db'
import { log } from '@/lib/logger'
import { randomBytes } from 'crypto'
export const runtime = 'nodejs'

// Name of the short-lived cookie holding the OAuth state nonce. The callback
// compares the state returned by the IdP against this; a mismatch or absence
// means the request didn't originate from our own /sso redirect (login CSRF).
export const SSO_STATE_COOKIE = 'sso_state'

const STATIC_PROVIDERS: Record<string, { authUrl: (cfg: Record<string,unknown>) => string; scope: string }> = {
  microsoft: {
    authUrl: (cfg) => `https://login.microsoftonline.com/${cfg.tenant_id || 'common'}/oauth2/v2.0/authorize`,
    scope: 'openid email profile',
  },
  google: {
    authUrl: () => 'https://accounts.google.com/o/oauth2/v2/auth',
    scope: 'openid email profile',
  },
}

// Discover OIDC authorization endpoint from Keycloak or generic provider
async function discoverAuthUrl(cfg: Record<string, unknown>): Promise<{ authUrl: string; scope: string } | null> {
  try {
    let discoveryUrl: string | null = null
    if (cfg.discovery_url) {
      discoveryUrl = cfg.discovery_url as string
    } else if (cfg.server_url && cfg.realm) {
      discoveryUrl = `${String(cfg.server_url).replace(/\/$/, '')}/realms/${cfg.realm}/.well-known/openid-configuration`
    }
    if (!discoveryUrl) return null
    const res = await fetch(discoveryUrl, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) throw new Error(`Discovery returned ${res.status}`)
    const meta = await res.json()
    return { authUrl: meta.authorization_endpoint, scope: 'openid email profile' }
  } catch (e) {
    log.error({ service: 'sso-init', err: e }, 'OIDC discovery failed')
    return null
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const provider = searchParams.get('provider')
    if (!provider) return Response.json({ error: 'provider required' }, { status: 400 })

    const sql = getDb()
    const rows = await sql`SELECT * FROM sso_config WHERE id=${provider} AND enabled = true`
    if (!rows.length) return Response.json({ error: 'SSO not configured or disabled' }, { status: 400 })
    const cfg = rows[0] as Record<string, unknown>

    const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001'
    const redirectUri = `${APP_URL}/api/auth/callback/${provider}`
    // Random nonce carried in the OAuth state and mirrored in a short-lived
    // httpOnly cookie. The callback requires the two to match, which proves the
    // callback was reached via a redirect we initiated (login-CSRF defence).
    const nonce = randomBytes(24).toString('base64url')
    const state = Buffer.from(JSON.stringify({ provider, nonce, ts: Date.now() })).toString('base64url')

    let authUrl: string
    let scope: string

    if (STATIC_PROVIDERS[provider]) {
      const pc = STATIC_PROVIDERS[provider]
      authUrl = pc.authUrl(cfg)
      scope = pc.scope
    } else {
      // Keycloak / generic OIDC
      const discovered = await discoverAuthUrl(cfg)
      if (!discovered) return Response.redirect(`${APP_URL}/login?error=oidc_discovery_failed`)
      authUrl = discovered.authUrl
      scope = discovered.scope
    }

    const params = new URLSearchParams({
      client_id: cfg.client_id as string,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope,
      state,
      response_mode: 'query',
    })

    // Set the state nonce in a short-lived, httpOnly cookie and redirect. We
    // build the Response manually because Response.redirect() can't carry a
    // Set-Cookie. 10 minutes is ample for a login round-trip.
    const secure = process.env.NODE_ENV === 'production'
    const cookie = [
      `${SSO_STATE_COOKIE}=${nonce}`,
      'HttpOnly',
      'Path=/api/auth',
      'SameSite=Lax',
      'Max-Age=600',
      secure ? 'Secure' : '',
    ].filter(Boolean).join('; ')

    return new Response(null, {
      status: 302,
      headers: { Location: authUrl + '?' + params.toString(), 'Set-Cookie': cookie },
    })
  } catch (e) {
    log.error({ service: 'sso-init', err: e }, 'SSO init error')
    return Response.json({ error: String(e) }, { status: 500 })
  }
}
