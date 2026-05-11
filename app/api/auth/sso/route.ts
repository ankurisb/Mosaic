import { getDb } from '@/lib/db'
export const runtime = 'nodejs'

const PROVIDER_CONFIG: Record<string, { authUrl: (tenantId?: string) => string; scope: string }> = {
  microsoft: {
    authUrl: (tenantId) => `https://login.microsoftonline.com/${tenantId || 'common'}/oauth2/v2.0/authorize`,
    scope: 'openid email profile',
  },
  google: {
    authUrl: () => 'https://accounts.google.com/o/oauth2/v2/auth',
    scope: 'openid email profile',
  },
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const provider = searchParams.get('provider')
    if (!provider || !PROVIDER_CONFIG[provider]) {
      return Response.json({ error: 'Invalid provider' }, { status: 400 })
    }

    const sql = getDb()
    const rows = await sql`SELECT * FROM sso_config WHERE id=${provider} AND enabled=1`
    if (!rows.length) return Response.json({ error: 'SSO not configured for this provider' }, { status: 400 })
    const cfg = rows[0]

    const pc = PROVIDER_CONFIG[provider]
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001'}/api/auth/callback/${provider}`
    const state = Buffer.from(JSON.stringify({ provider, ts: Date.now() })).toString('base64url')

    const params = new URLSearchParams({
      client_id: cfg.client_id as string,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: pc.scope,
      state,
      response_mode: 'query',
    })

    const authUrl = pc.authUrl(cfg.tenant_id as string | undefined) + '?' + params.toString()
    return Response.redirect(authUrl)
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 })
  }
}
