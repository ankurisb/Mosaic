// -- lib/keys.ts -----------------------------------------------
// Retrieves runtime-settable API keys from the kv_settings table
// (set via Settings  API Keys). Falls back to process.env.
// Used by notify.ts, tools.ts and any other server-side lib.

import { getDb }    from './db'
import { decrypt }  from './encrypt'

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
