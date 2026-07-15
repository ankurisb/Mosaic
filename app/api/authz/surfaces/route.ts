// app/api/authz/surfaces/route.ts
// Returns the current user's granted surfaces, for the frontend to show/hide
// interface links. Admins get the full set (getUserSurfaces short-circuits).

import { getSession } from '@/lib/auth'
import { getUserSurfaces } from '@/lib/permissions'

export const runtime = 'nodejs'

export async function GET() {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const surfaces = await getUserSurfaces({ id: session.id, role: session.role })
  // isAdmin lets the UI show the admin-only "open the raw Airbyte portal"
  // break-glass link. Kept server-authoritative rather than trusting the client.
  return Response.json({ surfaces, isAdmin: session.role === 'admin' })
}
