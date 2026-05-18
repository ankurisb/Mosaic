// lib/dev-api-auth.ts
// Validates developer API keys for /api/v1/* endpoints.
// Keys are stored as SHA-256 hashes — plaintext never persisted.
//
// Usage in a route:
//   const auth = await validateDevApiKey(req, ['read'])
//   if (!auth.ok) return auth.response
//   // auth.keyId, auth.scopes available

import { createHash, randomBytes } from 'crypto'
import { getDb } from './db'
import { log } from './logger'

export type DevApiScope = 'read' | 'write' | 'admin'

export interface DevApiAuth {
  ok: true
  keyId: string
  scopes: DevApiScope[]
  rateLimit: number
}
export interface DevApiAuthFail {
  ok: false
  response: Response
}

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

/** Generate a new API key. Returns plaintext (shown once) + hash + preview. */
export function generateApiKey(): { plaintext: string; hash: string; preview: string } {
  const plaintext = 'mk_' + randomBytes(24).toString('hex')
  return {
    plaintext,
    hash: hashKey(plaintext),
    preview: plaintext.slice(0, 10) + '...',
  }
}

/** Validate a Bearer token from the Authorization header against the DB. */
export async function validateDevApiKey(
  req: Request,
  requiredScopes: DevApiScope[] = ['read']
): Promise<DevApiAuth | DevApiAuthFail> {

  const authHeader = req.headers.get('authorization') || ''
  if (!authHeader.startsWith('Bearer ')) {
    return { ok: false, response: Response.json({ error: 'Missing Authorization: Bearer <key>' }, { status: 401 }) }
  }

  const plaintext = authHeader.slice(7).trim()
  if (!plaintext) {
    return { ok: false, response: Response.json({ error: 'Empty API key' }, { status: 401 }) }
  }

  const hash = hashKey(plaintext)
  const sql = getDb()

  let row: Record<string, unknown> | undefined
  try {
    const rows = await sql`
      SELECT id, scopes, rate_limit, active, expires_at
      FROM developer_api_keys
      WHERE key_hash = ${hash}
      LIMIT 1`
    row = rows[0] as Record<string, unknown>
  } catch (err) {
    log.error({ service: 'dev-api-auth', err }, 'DB error validating API key')
    return { ok: false, response: Response.json({ error: 'Internal error' }, { status: 500 }) }
  }

  if (!row) {
    return { ok: false, response: Response.json({ error: 'Invalid API key' }, { status: 401 }) }
  }
  if (!row.active) {
    return { ok: false, response: Response.json({ error: 'API key is disabled' }, { status: 401 }) }
  }
  if (row.expires_at && new Date(row.expires_at as string) < new Date()) {
    return { ok: false, response: Response.json({ error: 'API key has expired' }, { status: 401 }) }
  }

  // Parse scopes
  let scopes: DevApiScope[] = ['read']
  try { scopes = JSON.parse(row.scopes as string) } catch { }

  // Check required scopes
  for (const s of requiredScopes) {
    if (!scopes.includes(s) && !scopes.includes('admin')) {
      return { ok: false, response: Response.json({ error: `Scope required: ${s}` }, { status: 403 }) }
    }
  }

  // Rate limiting — count requests in the last hour
  const rateLimit = (row.rate_limit as number) || 100
  const keyId = row.id as string
  try {
    const oneHourAgo = new Date(Date.now() - 3600_000).toISOString()
    const countRows = await sql`
      SELECT COUNT(*) as cnt FROM developer_api_usage
      WHERE key_id = ${keyId} AND created_at > ${oneHourAgo}`
    const count = Number((countRows[0] as { cnt: string })?.cnt || 0)
    if (count >= rateLimit) {
      return { ok: false, response: Response.json(
        { error: `Rate limit exceeded: ${rateLimit} requests/hour` },
        { status: 429, headers: { 'X-RateLimit-Limit': String(rateLimit), 'X-RateLimit-Remaining': '0' } }
      )}
    }
  } catch { /* non-blocking — don't fail request if rate limit check fails */ }

  // Update last_used_at (fire and forget)
  sql`UPDATE developer_api_keys SET last_used_at = datetime('now') WHERE id = ${keyId}`.catch(() => {})

  return { ok: true, keyId, scopes, rateLimit }
}

/** Log a developer API request for usage tracking. */
export async function logDevApiUsage(
  keyId: string,
  endpoint: string,
  method: string,
  statusCode: number,
  latencyMs: number
): Promise<void> {
  try {
    const sql = getDb()
    await sql`
      INSERT INTO developer_api_usage (key_id, endpoint, method, status_code, latency_ms)
      VALUES (${keyId}, ${endpoint}, ${method}, ${statusCode}, ${latencyMs})`
  } catch { /* non-blocking */ }
}
