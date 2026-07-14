// lib/ciso.ts
// Provisions Mosaic users into CISO Assistant (option 3: single point of user
// management in Mosaic, but real per-user identity inside CISO).
//
// Unlike n8n and Superset — where all permitted users share one tool account —
// CISO gets a real account per user, so compliance actions are attributed to
// the individual. That matters for a GRC tool's audit trail.
//
// Lifecycle, driven by the 'ciso' surface grant in lib/permissions.ts:
//   grant   -> create the user (or reactivate) + assign the mapped role
//   revoke  -> deactivate (NOT delete: preserves audit history)
//
// Role mapping: Mosaic admin -> Global Administrator, Mosaic user -> Global Analyst.
//
// API verified against CISO Assistant (community):
//   POST  /api/users/            {email}                -> creates user
//   PATCH /api/users/{id}/       {user_groups:[id]}     -> assigns role
//   PATCH /api/users/{id}/       {is_active:false}      -> deactivates
//
// NOTE: CISO emails the new user an invite to set their password. This requires
// SMTP to be configured on the CISO backend — without it the account exists but
// cannot be logged into. See docker-compose.yml (ciso-backend EMAIL_* vars).

import { log } from './logger'
import { getDb } from './db'

const CISO_ENV_URL = (process.env.CISO_API_URL || 'http://ciso-backend:8000').replace(/\/$/, '')
const CISO_ENV_EMAIL = process.env.CISO_SUPERUSER_EMAIL || 'admin@mosaic.local'
const CISO_ENV_PASSWORD = process.env.CISO_SUPERUSER_PASSWORD || ''

// Settings resolve from encrypted kv_settings first (Settings -> Keys in the
// UI), falling back to env. This lets a customer point Mosaic at their OWN
// CISO instance without redeploying — see the "bring your own" mode.
async function setting(key: string, fallback: string): Promise<string> {
  try {
    const sql = getDb()
    const rows = await sql`SELECT value_enc FROM kv_settings WHERE key = ${key}`
    if (rows.length) {
      const { decrypt } = await import('./encrypt')
      const v = decrypt(rows[0].value_enc as string)
      if (v) return v
    }
  } catch { /* fall through to env */ }
  return fallback
}

// Role (user-group) names in CISO. Resolved to IDs at call time rather than
// hardcoded, since IDs are generated per deployment.
const ROLE_ADMIN = 'Global - Administrator'
const ROLE_USER = 'Global - Analyst'

type CisoUser = { id: string; email: string; is_active: boolean }

/** Authenticate as the CISO superuser; returns an API token. */
async function cisoToken(): Promise<string> {
  const url = await cisoUrl()
  const email = await setting('CISO_SUPERUSER_EMAIL', CISO_ENV_EMAIL)
  const password = await setting('CISO_SUPERUSER_PASSWORD', CISO_ENV_PASSWORD)
  const res = await fetch(`${url}/api/iam/login/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: email, password }),
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`CISO auth failed (${res.status})`)
  const data = (await res.json()) as { token?: string }
  if (!data.token) throw new Error('CISO returned no token')
  return data.token
}

/** Resolve the CISO API base URL (kv_settings override, else env). */
export async function cisoUrl(): Promise<string> {
  return (await setting('CISO_API_URL', CISO_ENV_URL)).replace(/\/$/, '')
}

async function cisoFetch(token: string, path: string, init?: RequestInit): Promise<Response> {
  const base = await cisoUrl()
  return fetch(`${base}${path}`, {
    ...init,
    headers: {
      Authorization: `Token ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    signal: AbortSignal.timeout(8000),
  })
}

/** Resolve a CISO user-group name to its (deployment-specific) UUID. */
async function roleId(token: string, name: string): Promise<string | null> {
  const res = await cisoFetch(token, '/api/user-groups/')
  if (!res.ok) return null
  const data = (await res.json()) as { results?: { id: string; name: string }[] }
  return data.results?.find(g => g.name === name)?.id || null
}

async function findUser(token: string, email: string): Promise<CisoUser | null> {
  const res = await cisoFetch(token, '/api/users/')
  if (!res.ok) return null
  const data = (await res.json()) as { results?: CisoUser[] }
  return data.results?.find(u => u.email.toLowerCase() === email.toLowerCase()) || null
}

/**
 * Ensure a CISO account exists for this user, is active, and carries the role
 * mapped from their Mosaic role. Idempotent — safe to call on every grant.
 */
export async function provisionCisoUser(email: string, mosaicRole: string): Promise<void> {
  const token = await cisoToken()
  const group = await roleId(token, mosaicRole === 'admin' ? ROLE_ADMIN : ROLE_USER)

  let user = await findUser(token, email)

  if (!user) {
    // CISO sends the invite/set-password email on creation (requires SMTP).
    const res = await cisoFetch(token, '/api/users/', {
      method: 'POST',
      body: JSON.stringify({ email }),
    })
    if (!res.ok) throw new Error(`CISO user creation failed (${res.status})`)
    user = (await res.json()) as CisoUser
  }

  // Reactivate (if previously revoked) and apply the role mapping.
  const patch: Record<string, unknown> = { is_active: true }
  if (group) patch.user_groups = [group]

  const res = await cisoFetch(token, `/api/users/${user.id}/`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(`CISO role assignment failed (${res.status})`)
}

/**
 * Revoke CISO access by deactivating the account. Deliberately NOT a delete:
 * a compliance tool must retain the audit trail of what the user did.
 */
export async function deactivateCisoUser(email: string): Promise<void> {
  const token = await cisoToken()
  const user = await findUser(token, email)
  if (!user || !user.is_active) return // nothing to do

  const res = await cisoFetch(token, `/api/users/${user.id}/`, {
    method: 'PATCH',
    body: JSON.stringify({ is_active: false }),
  })
  if (!res.ok) throw new Error(`CISO deactivation failed (${res.status})`)
}

/**
 * Reconcile CISO access with a surface grant. Never throws: CISO being down
 * must not block the Mosaic permission change (which is the source of truth).
 * The Mosaic-side proxy gate still blocks revoked users regardless.
 */
export async function syncCisoAccess(email: string, mosaicRole: string, granted: boolean): Promise<void> {
  try {
    if (granted) await provisionCisoUser(email, mosaicRole)
    else await deactivateCisoUser(email)
  } catch (err) {
    log.error({ err, email, granted }, 'CISO access sync failed')
  }
}
