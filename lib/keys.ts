// -- lib/keys.ts -----------------------------------------------
// Retrieves runtime-settable API keys from the kv_settings table
// (set via Settings  API Keys). Falls back to process.env.
// Used by notify.ts, tools.ts and any other server-side lib.

import { getDb }    from './db'
import { decrypt, encrypt }  from './encrypt'
import { randomBytes } from 'crypto'

export async function getKey(key: string): Promise<string | null> {
  if (process.env[key]) return process.env[key] as string
  try {
    const sql  = getDb()
    const rows = await sql`SELECT value_enc FROM kv_settings WHERE key = ${key} LIMIT 1`
    const row  = (rows as { value_enc: string }[])[0]
    if (!row) return null
    const val = decrypt(row.value_enc)
    process.env[key] = val
    return val
  } catch {
    return null
  }
}

/**
 * Settings-FIRST counterpart to getKey().
 *
 * getKey() is env-first: it returns process.env[key] before ever reading
 * kv_settings. That's fine for secrets that are only ever set via env, but it's
 * WRONG for bring-your-own service URLs (SUPERSET_URL, CISO_API_URL, N8N_URL):
 * docker-compose bakes in a bundled default (e.g. http://superset:8088) into the
 * container env, so getKey() always returns that default and silently ignores the
 * BYO value the user saved in the UI. That made health checks probe the bundled
 * host and report a false red for a perfectly healthy BYO/Cloud instance.
 *
 * This resolver reads the encrypted kv_settings value first and only falls back to
 * env, so a user-configured value wins. It does NOT mutate process.env.
 */
export async function getKeySettingsFirst(key: string): Promise<string | null> {
  try {
    const sql  = getDb()
    const rows = await sql`SELECT value_enc FROM kv_settings WHERE key = ${key} LIMIT 1`
    const row  = (rows as { value_enc: string }[])[0]
    if (row) {
      const val = decrypt(row.value_enc)
      if (val) return val
    }
  } catch { /* fall through to env */ }
  return process.env[key] || null
}

/**
 * kv_settings-ONLY resolver (no env fallback at all). Returns the value the user
 * explicitly saved in the UI, or null. Used by health checks to distinguish a
 * genuine bring-your-own configuration from the compose scaffolding default that
 * always sits in the container env — so an unconfigured optional service can be
 * reported as 'unconfigured' rather than a false 'error' from probing a bundled
 * host that isn't running.
 */
export async function getKeySettingsFirstStrict(key: string): Promise<string | null> {
  try {
    const sql  = getDb()
    const rows = await sql`SELECT value_enc FROM kv_settings WHERE key = ${key} LIMIT 1`
    const row  = (rows as { value_enc: string }[])[0]
    if (row) {
      const val = decrypt(row.value_enc)
      if (val) return val
    }
  } catch { /* no value */ }
  return null
}

/**
 * Resolve the scheduler bearer secret, generating and persisting one on first
 * use if neither env nor kv_settings has it.
 *
 * There is no reason for a human to invent this value, and leaving it unset
 * previously made POST /api/integrations/scheduler fail OPEN (the guard was
 * conditional on the secret existing), so anyone who could reach the box could
 * fire every due integration rule. Auto-generating lets that endpoint fail
 * CLOSED without an admin having to configure anything.
 */
export async function ensureCronSecret(): Promise<string | null> {
  const existing = await getKey('CRON_SECRET')
  if (existing) return existing
  try {
    const sql = getDb()
    const generated = randomBytes(32).toString('hex')
    await sql`INSERT INTO kv_settings (key, value_enc, updated_by)
              VALUES ('CRON_SECRET', ${encrypt(generated)}, 'system:auto-generated')
              ON CONFLICT(key) DO NOTHING`
    // Re-read rather than trusting `generated`: a concurrent boot may have won
    // the insert, in which case its value is the authoritative one.
    return await getKey('CRON_SECRET')
  } catch {
    return null
  }
}
