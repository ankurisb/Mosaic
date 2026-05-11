import { getDb } from '@/lib/db'
import { createToken, COOKIE_NAME } from '@/lib/auth'
import { cookies } from 'next/headers'
import { jwtVerify, createRemoteJWKSet } from 'jose'
export const runtime = 'nodejs'

const PROVIDER_CONFIG: Record<string, {
  tokenUrl: (tenantId?: string) => string
  jwksUrl: (tenantId?: string) => string
  issuer: (tenantId?: string) => string
}> = {
  microsoft: {
    tokenUrl: (t) => `https://login.microsoftonline.com/${t || 'common'}/oauth2/v2.0/token`,
    jwksUrl: (t) => `https://login.microsoftonline.com/${t || 'common'}/discovery/v2.0/keys`,
    issuer: (t) => `https://login.microsoftonline.com/${t}/v2.0`,
  },
  google: {
    tokenUrl: () => 'https://oauth2.googleapis.com/token',
    jwksUrl: () => 'https://www.googleapis.com/oauth2/v3/certs',
    issuer: () => 'https://accounts.google.com',
  },
}

const OPTS = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, maxAge: 60*60*24*7, path: '/' }
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001'

export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')

  if (error) return Response.redirect(`${APP_URL}/login?error=${encodeURIComponent(error)}`)
  if (!code) return Response.redirect(`${APP_URL}/login?error=missing_code`)
  if (!PROVIDER_CONFIG[provider]) return Response.redirect(`${APP_URL}/login?error=invalid_provider`)

  try {
    const sql = getDb()
    const cfgRows = await sql`SELECT * FROM sso_config WHERE id=${provider} AND enabled=1`
    if (!cfgRows.length) return Response.redirect(`${APP_URL}/login?error=sso_not_configured`)
    const cfg = cfgRows[0]

    const pc = PROVIDER_CONFIG[provider]
    const redirectUri = `${APP_URL}/api/auth/callback/${provider}`

    // Exchange code for tokens
    const tokenRes = await fetch(pc.tokenUrl(cfg.tenant_id as string | undefined), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: cfg.client_id as string,
        client_secret: cfg.client_secret as string,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    })
    if (!tokenRes.ok) {
      const err = await tokenRes.text()
      console.error('SSO token exchange failed:', err)
      return Response.redirect(`${APP_URL}/login?error=token_exchange_failed`)
    }
    const tokenData = await tokenRes.json()
    const idToken = tokenData.id_token
    if (!idToken) return Response.redirect(`${APP_URL}/login?error=no_id_token`)

    // Verify id_token with provider's JWKS
    const JWKS = createRemoteJWKSet(new URL(pc.jwksUrl(cfg.tenant_id as string | undefined)))
    const { payload } = await jwtVerify(idToken, JWKS, {
      issuer: provider === 'google'
        ? ['https://accounts.google.com', 'accounts.google.com']
        : pc.issuer(cfg.tenant_id as string | undefined),
      audience: cfg.client_id as string,
    })

    const email = (payload.email || payload.preferred_username) as string | undefined
    const name = (payload.name) as string | undefined
    const sub = payload.sub as string

    if (!email) return Response.redirect(`${APP_URL}/login?error=no_email_in_token`)

    // Pre-provisioned check — user must already exist
    const userRows = await sql`SELECT id, email, name, role, banned FROM users WHERE LOWER(email)=LOWER(${email}) LIMIT 1`
    if (!userRows.length) {
      return Response.redirect(`${APP_URL}/login?error=${encodeURIComponent('account_not_provisioned')}`)
    }
    const user = userRows[0]
    if (user.banned) return Response.redirect(`${APP_URL}/login?error=account_banned`)

    // Update sso_provider/sso_sub if not set
    await sql`UPDATE users SET sso_provider=${provider}, sso_sub=${sub} WHERE id=${user.id}`

    // Issue JWT cookie — same as email/password flow
    const token = await createToken({
      id: user.id as string,
      email: user.email as string,
      name: (user.name || name || email) as string,
      role: user.role as 'admin' | 'user',
    })
    const store = await cookies()
    store.set(COOKIE_NAME, token, OPTS)
    return Response.redirect(`${APP_URL}/`)
  } catch (e) {
    console.error('SSO callback error:', provider, e instanceof Error ? e.message : e)
    const msg = e instanceof Error ? e.message.slice(0, 100) : 'sso_failed'
    return Response.redirect(`${APP_URL}/login?error=${encodeURIComponent(msg)}`)
  }
}
