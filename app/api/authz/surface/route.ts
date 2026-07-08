// app/api/authz/surface/route.ts
// Authorization gate for external interfaces (surfaces).
//
// Two consumers:
//   1. Frontend — to show/hide interface links (fetch with ?name=<surface>).
//   2. Caddy forward_auth (Step 5) — the reverse proxy calls this before
//      proxying /n8n, /superset, etc. A 2xx = allow, anything else = deny.
//
// The surface is read from the `name` query param (forward_auth sets the URI)
// or the `X-Mosaic-Surface` header (whichever the proxy config finds simpler).
//
// Status codes are deliberate so the proxy can distinguish cases:
//   200 — authenticated and permitted
//   400 — missing/unknown surface
//   401 — not authenticated (proxy may redirect to login)
//   403 — authenticated but not permitted

import { getSession } from '@/lib/auth'
import { canAccessSurface, isSurface } from '@/lib/permissions'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const name = url.searchParams.get('name') || req.headers.get('x-mosaic-surface') || ''

  if (!isSurface(name)) {
    return Response.json({ error: 'Unknown surface', surface: name }, { status: 400 })
  }

  const session = await getSession()
  if (!session) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const allowed = await canAccessSurface({ id: session.id, role: session.role }, name)
  if (!allowed) {
    return Response.json({ error: 'Forbidden', surface: name }, { status: 403 })
  }

  // On success, expose identity so the proxy can inject it downstream if needed.
  return Response.json(
    { ok: true, surface: name },
    { status: 200, headers: { 'X-Mosaic-User': session.email, 'X-Mosaic-Role': session.role } },
  )
}
