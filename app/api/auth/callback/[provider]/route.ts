// app/api/auth/callback/[provider]/route.ts
// Handles OAuth2/OIDC callback for Microsoft, Google, Keycloak, and generic OIDC.
// Flow: exchange auth code → verify id_token via JWKS → look up pre-provisioned user → issue JWT cookie.
import { getDb } from '@/lib/db'
import { log } from '@/lib/logger'
import { decrypt } from '@/lib/encrypt'
import { audit, AUDIT } from '@/lib/audit'
import { createToken, COOKIE_NAME } from '@/lib/auth'
import { cookies } from 'next/headers'
import { jwtVerify, createRemoteJWKSet } from 'jose'
export const runtime = 'nodejs'

interface OidcMeta {
  token_endpoint: string
  jwks_uri: string
  issuer: string
}

// Cache discovery docs in memory — valid for 1h
const metaCache = new Map<string, { meta: OidcMeta; expires: number }>()

async function getOidcMeta(cfg: Record<string, unknown>): Promise<OidcMeta> {
  // Build discovery URL
  let discoveryUrl: string
  if (cfg.discovery_url) {
    discoveryUrl = cfg.discovery_url as string
  } else if (cfg.server_url && cfg.realm) {
    discoveryUrl = `${String(cfg.server_url).replace(/\/$/, '')}/realms/${cfg.realm}/.well-known/openid-configuration`
  } else {
    throw new Error('No OIDC discovery URL configured')
  }

  const cached = metaCache.get(discoveryUrl)
  if (cached && cached.expires > Date.now()) return cached.meta

  const res = await fetch(discoveryUrl, { signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status}`)
  const meta = await res.json() as OidcMeta
  metaCache.set(discoveryUrl, { meta, expires: Date.now() + 3600_000 })
  return meta
}

const STATIC: Record<string, { tokenUrl: (cfg: Record<string,unknown>) => string; jwksUrl: (cfg: Record<string,unknown>) => string; issuer: (cfg: Record<string,unknown>) => string | string[] }> = {
  microsoft: {
    tokenUrl: (c) => `https://login.microsoftonline.com/${c.tenant_id || 'common'}/oauth2/v2.0/token`,
    jwksUrl:  (c) => `https://login.microsoftonline.com/${c.tenant_id || 'common'}/discovery/v2.0/keys`,
    issuer:   (c) => `https://login.microsoftonline.com/${c.tenant_id}/v2.0`,
  },
  google: {
    tokenUrl: () => 'https://oauth2.googleapis.com/token',
    jwksUrl:  () => 'https://www.googleapis.com/oauth2/v3/certs',
    issuer:   () => ['https://accounts.google.com', 'accounts.google.com'],
  },
}

const OPTS = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, maxAge: 60*60*24*7, path: '/' }

export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params
  const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001'
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')

  if (error) return Response.redirect(`${APP_URL}/login?error=${encodeURIComponent(error)}`)
  if (!code) return Response.redirect(`${APP_URL}/login?error=missing_code`)

  try {
    const sql = getDb()
    const cfgRows = await sql`SELECT * FROM sso_config WHERE id=${provider} AND enabled=1`
    if (!cfgRows.length) return Response.redirect(`${APP_URL}/login?error=sso_not_configured`)
    const cfg = cfgRows[0] as Record<string, unknown>
    // Decrypt client_secret — stored in client_secret_enc (migrated) or legacy client_secret
    cfg.client_secret = cfg.client_secret_enc
      ? decrypt(cfg.client_secret_enc as string)
      : (cfg.client_secret as string || '')

    const redirectUri = `${APP_URL}/api/auth/callback/${provider}`
    let tokenUrl: string, jwksUrl: string, issuer: string | string[]

    if (STATIC[provider]) {
      const pc = STATIC[provider]
      tokenUrl = pc.tokenUrl(cfg)
      jwksUrl  = pc.jwksUrl(cfg)
      issuer   = pc.issuer(cfg)
    } else {
      // Keycloak / generic OIDC
      const meta = await getOidcMeta(cfg)
      tokenUrl = meta.token_endpoint
      jwksUrl  = meta.jwks_uri
      issuer   = meta.issuer
    }

    // Exchange code for tokens
    const tokenRes = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     cfg.client_id as string,
        client_secret: cfg.client_secret as string,
        code,
        redirect_uri:  redirectUri,
        grant_type:    'authorization_code',
      }),
    })
    if (!tokenRes.ok) {
      const errText = await tokenRes.text()
      log.error({ service: 'sso-callback', provider, errText }, 'Token exchange failed')
      return Response.redirect(`${APP_URL}/login?error=token_exchange_failed`)
    }
    const tokenData = await tokenRes.json()
    const idToken = tokenData.id_token
    if (!idToken) return Response.redirect(`${APP_URL}/login?error=no_id_token`)

    // Verify id_token signature + claims via provider JWKS
    const JWKS = createRemoteJWKSet(new URL(jwksUrl))
    const { payload } = await jwtVerify(idToken, JWKS, {
      issuer,
      audience: cfg.client_id as string,
    })

    // Extract identity claims — Keycloak uses `preferred_username` or `email`
    const email = (
      payload.email ||
      payload.preferred_username
    ) as string | undefined
    const name  = payload.name as string | undefined
    const sub   = payload.sub  as string

    if (!email) return Response.redirect(`${APP_URL}/login?error=no_email_in_token`)

    // Pre-provisioned check — user must already exist in Mosaic
    const userRows = await sql`SELECT id,email,name,role,banned FROM users WHERE LOWER(email)=LOWER(${email}) LIMIT 1`
    if (!userRows.length) return Response.redirect(`${APP_URL}/login?error=account_not_provisioned`)
    const user = userRows[0]
    if (user.banned) return Response.redirect(`${APP_URL}/login?error=account_banned`)

    // Update sso_provider/sso_sub and last_login_at
    await sql`UPDATE users SET sso_provider=${provider}, sso_sub=${sub}, last_login_at=datetime('now') WHERE id=${user.id}`

    // Issue Mosaic JWT cookie — same as email/password flow
    const token = await createToken({
      id:    user.id    as string,
      email: user.email as string,
      name:  (user.name || name || email) as string,
      role:  user.role  as 'admin' | 'user',
    })
    const store = await cookies()
    store.set(COOKIE_NAME, token, OPTS)

    audit(req, { id: user.id as string, email: user.email as string, role: user.role as string }, AUDIT.LOGIN, `user:${user.email}`, 'success', { method: provider, sub })

    log.info({ service: 'sso-callback', provider, email: user.email }, 'SSO login successful')
    return Response.redirect(`${APP_URL}/`)
  } catch (e) {
    log.error({ service: 'sso-callback', provider, err: e instanceof Error ? e.message : e }, 'SSO callback error')
    return Response.redirect(`${APP_URL}/login?error=${encodeURIComponent('sso_failed')}`)
  }
}
