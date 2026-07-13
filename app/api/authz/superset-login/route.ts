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
import { ensureSupersetSession } from '@/lib/superset-auth'

export const runtime = 'nodejs'

export async function GET() {
  const session = await getSession()
  if (!session) {
    return new Response(null, { status: 302, headers: { Location: '/login' } })
  }

  if (!(await canAccessSurface({ id: session.id, role: session.role }, 'superset'))) {
    return Response.json({ error: 'No access to analytics' }, { status: 403 })
  }

  let cookie: string
  try {
    cookie = await ensureSupersetSession()
  } catch {
    return Response.json({ error: 'Superset is unavailable' }, { status: 502 })
  }

  const headers = new Headers()
  headers.append('Set-Cookie', cookie)
  headers.set('Location', process.env.SUPERSET_PUBLIC_URL || 'https://localhost:8445/')
  return new Response(null, { status: 302, headers })
}
