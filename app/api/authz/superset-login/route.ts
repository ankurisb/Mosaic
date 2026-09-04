// app/api/authz/superset-login/route.ts
// Login handshake for the native Superset UI.
//
// Flow: verify the Mosaic session -> check surface permission -> log in to
// Superset server-side (Flask-Login form POST) -> relay Superset's session
// cookie to the browser -> redirect to /superset/. The user lands in the
// full Superset UI already authenticated and never sees its login.
//
// Re-entry re-runs the handshake, so users are transparently re-authenticated
// after logout or session expiry.
//
// Requires Caddy serving Superset same-origin under /superset (activation step).

import { getSession } from '@/lib/auth'
import { canAccessSurface } from '@/lib/permissions'
import { ensureSupersetSession, supersetSetting } from '@/lib/superset-auth'

export const runtime = 'nodejs'

// A Superset is "bundled" (served same-origin under /superset via Caddy) when its
// public URL is the internal scaffolding host or the bundled :8445 route. Only then
// does the server-side cookie relay work; a BYO external Superset is a different
// origin, so we send the user to its own URL instead.
function isBundled(url: string): boolean {
  return /(^https?:\/\/(localhost|127\.0\.0\.1):8445)|superset:8088|\/superset\/?$/i.test(url)
}

export async function GET() {
  const session = await getSession()
  if (!session) {
    return new Response(null, { status: 302, headers: { Location: '/login' } })
  }

  if (!(await canAccessSurface({ id: session.id, role: session.role }, 'superset'))) {
    return Response.json({ error: 'No access to analytics' }, { status: 403 })
  }

  // Resolve the browser-facing URL settings-first (BYO wins over the env default),
  // same fix as the n8n launch button — otherwise a BYO Superset launch redirects to
  // the bundled :8445 URL that isn't this deployment's Superset.
  const publicUrl = await supersetSetting('SUPERSET_PUBLIC_URL', process.env.SUPERSET_PUBLIC_URL || 'https://localhost:8445/')

  // BYO external Superset: the cross-origin cookie relay can't work, so just send the
  // user to their Superset (they authenticate there). Bundled: do the same-origin
  // cookie handshake so they land already logged in.
  if (!isBundled(publicUrl)) {
    return new Response(null, { status: 302, headers: { Location: publicUrl } })
  }

  let cookie: string
  try {
    cookie = await ensureSupersetSession()
  } catch {
    return Response.json({ error: 'Superset is unavailable' }, { status: 502 })
  }

  const headers = new Headers()
  headers.append('Set-Cookie', cookie)
  headers.set('Location', publicUrl)
  return new Response(null, { status: 302, headers })
}
