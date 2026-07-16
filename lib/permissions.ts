// lib/permissions.ts
// Per-user access control for external interfaces (surfaces).
//
// Model:
//   - Admins implicitly have access to every surface (never stored).
//   - Non-admin users have access to exactly the surfaces granted to them
//     in user_surface_permissions. Absence of a row = no access (default deny).
//
// This is the single source of truth for both the frontend (show/hide links)
// and the reverse-proxy forward_auth gate (/api/authz/surface).

import { getDb } from './db'
import type { SessionUser } from './auth'
import { SURFACES, SURFACE_LABELS, isSurface, type Surface } from './surfaces'

// Re-export the client-safe constants so existing server imports from
// '@/lib/permissions' keep working (single source of truth: lib/surfaces.ts).
export { SURFACES, SURFACE_LABELS, isSurface, type Surface }

type SessionLike = Pick<SessionUser, 'id' | 'role'>

/** All surfaces a user may access. Admins get the full set. */
export async function getUserSurfaces(user: SessionLike): Promise<Surface[]> {
  if (user.role === 'admin') return [...SURFACES]
  const sql = getDb()
  const rows = (await sql`
    SELECT surface FROM user_surface_permissions
    WHERE user_id=${user.id} AND allowed = true
  `) as { surface: string }[]
  return rows.map(r => r.surface).filter(isSurface)
}

/** Whether a user may access one specific surface. */
export async function canAccessSurface(
  user: SessionLike | null,
  surface: Surface,
): Promise<boolean> {
  if (!user) return false
  if (user.role === 'admin') return true
  const sql = getDb()
  const rows = await sql`
    SELECT 1 FROM user_surface_permissions
    WHERE user_id=${user.id} AND surface=${surface} AND allowed = true
    LIMIT 1
  `
  return rows.length > 0
}

/**
 * Replace the full set of surface grants for a user (admin action).
 * Invalid surface names are silently dropped. Admins are unaffected by
 * stored rows, but we still persist grants so a later demotion to 'user'
 * retains the intended access.
 */
export async function setUserSurfaces(
  userId: string,
  surfaces: Surface[],
): Promise<void> {
  const sql = getDb()
  const valid = [...new Set(surfaces.filter(isSurface))]
  // DELETE + INSERT (no ON CONFLICT / no inline datetime) keeps this
  // portable across the SQLite and Postgres drivers in lib/db.ts.
  await sql`DELETE FROM user_surface_permissions WHERE user_id=${userId}`
  for (const s of valid) {
    await sql`
      INSERT INTO user_surface_permissions (user_id, surface, allowed)
      VALUES (${userId}, ${s}, 1)
    `
  }

  // CISO gets a real per-user account (unlike n8n/Superset, which share one
  // tool identity) so compliance actions are attributed to the individual.
  // Provision on grant, deactivate on revoke. Fire-and-forget: CISO being
  // unavailable must not fail the Mosaic permission change, which is the
  // source of truth — and the proxy gate still blocks revoked users.
  const rows = (await sql`SELECT email, role FROM users WHERE id=${userId}`) as { email: string; role: string }[]
  if (rows.length) {
    const { syncCisoAccess } = await import('./ciso')
    void syncCisoAccess(rows[0].email, rows[0].role, valid.includes('ciso'))
  }
}
