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
import { ensureN8nSession, resolveN8nUrl } from '@/lib/n8n'

export const runtime = 'nodejs'

// Distinguish a bundled n8n (runs behind Mosaic's proxy on an internal Docker
// hostname) from a bring-your-own n8n (an external URL the customer configured,
// e.g. n8n Cloud). The seamless SSO handshake below only works for bundled n8n:
// it logs in server-side with the shared owner account and relays n8n's cookie on
// the same proxy origin. A BYO instance has no shared owner account we hold and
// lives on a different origin, so for BYO we simply open the configured URL and
// let the user authenticate to their own n8n.
function isBundled(url: string): boolean {
  try {
    const host = new URL(url).hostname
    return host === 'n8n' || host === 'localhost' || host === '127.0.0.1' || host.endsWith('.internal')
  } catch {
    return true // unparseable -> treat as bundled (preserves prior behaviour)
  }
}

export async function GET() {
  const session = await getSession()
  if (!session) {
    // Navigation endpoint — send unauthenticated users to Mosaic login.
    return new Response(null, { status: 302, headers: { Location: '/login' } })
  }

  if (!(await canAccessSurface({ id: session.id, role: session.role }, 'n8n'))) {
    return Response.json({ error: 'No access to workflow automation' }, { status: 403 })
  }

  const n8nUrl = await resolveN8nUrl()

  // Bring-your-own n8n (external URL): no SSO handshake — open it directly and
  // let the user sign in to their own instance.
  if (!isBundled(n8nUrl)) {
    return new Response(null, { status: 302, headers: { Location: n8nUrl } })
  }

  // Bundled n8n: seamless SSO handshake, then redirect to the proxy origin.
  let n8nCookie: string
  try {
    n8nCookie = await ensureN8nSession()
  } catch {
    return Response.json({ error: 'n8n is unavailable' }, { status: 502 })
  }

  const headers = new Headers()
  headers.append('Set-Cookie', n8nCookie)
  headers.set('Location', process.env.N8N_PUBLIC_URL || 'https://localhost:8444/')
  return new Response(null, { status: 302, headers })
}
