// lib/n8n.ts
// Server-side n8n authentication for the login handshake.
//
// n8n 2.x (Community) uses email/password user-management with a session
// cookie (`n8n-auth`, HttpOnly, Secure, SameSite=Lax, Path=/). There is no
// Basic-auth or SSO to inject, so to hide n8n's login we log in server-side
// with a Mosaic-owned owner account and relay the resulting cookie to the
// browser. All Mosaic users share this single n8n identity; access is gated
// by Mosaic's canAccessSurface('n8n'), not by n8n itself.

import { getDb } from './db'

const OWNER_EMAIL = process.env.N8N_OWNER_EMAIL || 'n8n-owner@mosaic.local'
const OWNER_PASSWORD = process.env.N8N_OWNER_PASSWORD || 'Mosaic-n8n-Owner1'

/** Resolve the internal n8n base URL (env, with encrypted kv_settings override). */
export async function resolveN8nUrl(): Promise<string> {
  let url = process.env.N8N_URL || 'http://localhost:5678'
  try {
    const sql = getDb()
    const rows = await sql`SELECT value_enc FROM kv_settings WHERE key = 'N8N_URL'`
    if (rows.length) {
      const { decrypt } = await import('./encrypt')
      url = decrypt(rows[0].value_enc as string)
    }
  } catch { /* fall back to env/default */ }
  return url.replace(/\/$/, '')
}

/** POST /rest/login. Returns the raw `n8n-auth=...` Set-Cookie string, or null. */
async function login(baseUrl: string): Promise<string | null> {
  const res = await fetch(`${baseUrl}/rest/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emailOrLdapLoginId: OWNER_EMAIL, password: OWNER_PASSWORD }),
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) return null
  const cookies = res.headers.getSetCookie?.() || []
  return cookies.find(c => c.startsWith('n8n-auth=')) || null
}

/** POST /rest/owner/setup — first-run bootstrap of the shared owner account. */
async function ownerSetup(baseUrl: string): Promise<boolean> {
  const res = await fetch(`${baseUrl}/rest/owner/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: OWNER_EMAIL, firstName: 'Mosaic', lastName: 'Admin', password: OWNER_PASSWORD }),
    signal: AbortSignal.timeout(8000),
  })
  return res.ok
}

/**
 * Ensure a valid n8n session and return the `n8n-auth` Set-Cookie string to
 * relay to the browser. Bootstraps the owner account on a fresh instance.
 * Throws if n8n is unreachable or authentication fails.
 */
export async function ensureN8nSession(): Promise<string> {
  const baseUrl = await resolveN8nUrl()

  // Fast path: owner already exists.
  const existing = await login(baseUrl)
  if (existing) return existing

  // Fresh instance? Bootstrap the owner, then log in.
  try {
    const res = await fetch(`${baseUrl}/rest/settings`, { signal: AbortSignal.timeout(5000) })
    const data = await res.json() as { data?: { userManagement?: { showSetupOnFirstLoad?: boolean } } }
    if (data?.data?.userManagement?.showSetupOnFirstLoad) {
      await ownerSetup(baseUrl)
      const cookie = await login(baseUrl)
      if (cookie) return cookie
    }
  } catch { /* fall through to error */ }

  throw new Error('n8n authentication failed')
}
