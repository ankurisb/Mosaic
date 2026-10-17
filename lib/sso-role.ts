// lib/sso-role.ts
// Decide a user's Mosaic role from an SSO login's asserted roles.
//
// Role federation ONLY applies when the identity provider actually asserts roles
// (e.g. Keycloak realm/client roles land in the token). Providers like Google
// OIDC carry no role claims, so their asserted-role list is always empty — and
// treating "no roles asserted" as "demote to user" silently stripped admins on
// every Google login. For such providers the role stays as managed in Mosaic.
export const ADMIN_ROLE_NAMES = ['admin', 'mosaic-admin', 'mosaic_admin', 'administrator']

export type Role = 'admin' | 'user'

/**
 * @param currentRole the user's existing Mosaic role
 * @param ssoRoles roles asserted by the IdP token (may be empty)
 * @returns role to apply, and whether federation actually took effect (false =
 *          leave the stored role untouched)
 */
export function deriveSsoRole(currentRole: Role, ssoRoles: string[]): { role: Role; federated: boolean } {
  if (!ssoRoles || ssoRoles.length === 0) return { role: currentRole, federated: false }
  const lowered = ssoRoles.map(r => String(r).toLowerCase())
  const isAdmin = lowered.some(r => ADMIN_ROLE_NAMES.includes(r))
  return { role: isAdmin ? 'admin' : 'user', federated: true }
}
