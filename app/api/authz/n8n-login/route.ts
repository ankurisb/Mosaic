// app/api/authz/n8n-login/route.ts
// Login handshake for the raw n8n editor.
//
// Flow: verify the Mosaic session -> check surface permission -> log in to
// n8n server-side with the shared owner account -> relay n8n's session cookie
// to the browser -> redirect to /n8n/. The user lands in the editor already
// authenticated and never sees n8n's login.
//
// Requires HTTPS end-to-end: n8n's cookie is Secure, so the browser only
// stores it over TLS (the Tailscale funnel provides this). Over plain HTTP
// the cookie is silently dropped.
//
// Re-entry re-runs this handshake, so a user is transparently re-logged-in
// if their n8n cookie expires or they log out of n8n.

import { getSession } from '@/lib/auth'
import { canAccessSurface } from '@/lib/permissions'
import { ensureN8nSession } from '@/lib/n8n'

export const runtime = 'nodejs'

export async function GET() {
  const session = await getSession()
  if (!session) {
    // Navigation endpoint — send unauthenticated users to Mosaic login.
    return new Response(null, { status: 302, headers: { Location: '/login' } })
  }

  if (!(await canAccessSurface({ id: session.id, role: session.role }, 'n8n'))) {
    return Response.json({ error: 'No access to workflow automation' }, { status: 403 })
  }

  let n8nCookie: string
  try {
    n8nCookie = await ensureN8nSession()
  } catch {
    return Response.json({ error: 'n8n is unavailable' }, { status: 502 })
  }

  // Relay n8n's Set-Cookie verbatim (already Path=/, HttpOnly, Secure,
  // SameSite=Lax) and redirect into the editor. Same-origin (subpath via
  // Caddy) means the browser will send this cookie to /n8n/*.
  const headers = new Headers()
  headers.append('Set-Cookie', n8nCookie)
  headers.set('Location', '/n8n/')
  return new Response(null, { status: 302, headers })
}
