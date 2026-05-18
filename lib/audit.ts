// lib/audit.ts
// ISO 27001-compliant audit trail helper.
//
// Usage:
//   await audit(req, session, 'LOGIN', 'user:ankur@ugx.ai', 'success', { method: 'password' })
//   await audit(req, session, 'CONNECTION_CREATE', `connection:${id}`, 'success', { label, dialect })
//   await audit(null, null, 'LOGIN_FAILED', 'user:unknown@x.com', 'failure', { email, reason: 'bad_password' })
//
// Every event is hash-chained to the previous event (SHA-256).
// Deletions or modifications to any row break the chain and are detectable.

import { createHash } from 'crypto'
import { getDb } from './db'
import { log } from './logger'

// ── Action constants ───────────────────────────────────────────────────────
export const AUDIT = {
  // Auth
  LOGIN:               'LOGIN',
  LOGOUT:              'LOGOUT',
  LOGIN_FAILED:        'LOGIN_FAILED',
  PASSWORD_CHANGE:     'PASSWORD_CHANGE',
  SESSION_EXPIRED:     'SESSION_EXPIRED',
  // Users
  USER_CREATE:         'USER_CREATE',
  USER_UPDATE:         'USER_UPDATE',
  USER_DELETE:         'USER_DELETE',
  USER_INVITE:         'USER_INVITE',
  USER_BAN:            'USER_BAN',
  USER_UNBAN:          'USER_UNBAN',
  USER_ROLE_CHANGE:    'USER_ROLE_CHANGE',
  // Data connections
  CONNECTION_CREATE:   'CONNECTION_CREATE',
  CONNECTION_UPDATE:   'CONNECTION_UPDATE',
  CONNECTION_DELETE:   'CONNECTION_DELETE',
  CREDENTIAL_VIEW:     'CREDENTIAL_VIEW',
  // Chat
  CHAT_START:          'CHAT_START',
  TOOL_CALL:           'TOOL_CALL',
  RCA_TRIGGER:         'RCA_TRIGGER',
  // API keys
  API_KEY_CREATE:      'API_KEY_CREATE',
  API_KEY_REVOKE:      'API_KEY_REVOKE',
  // Rules / notifications
  RULE_FIRE:           'RULE_FIRE',
  NOTIFICATION_SEND:   'NOTIFICATION_SEND',
  // Settings
  SETTINGS_UPDATE:     'SETTINGS_UPDATE',
  GUARDRAIL_UPDATE:    'GUARDRAIL_UPDATE',
  // Audit system itself
  AUDIT_LOG_VIEW:      'AUDIT_LOG_VIEW',
  AUDIT_LOG_EXPORT:    'AUDIT_LOG_EXPORT',
  CHAIN_VERIFY:        'CHAIN_VERIFY',
  AUDIT_PURGE:         'AUDIT_PURGE',
} as const

export type AuditAction = typeof AUDIT[keyof typeof AUDIT]
export type AuditOutcome = 'success' | 'failure' | 'error'

interface AuditActor {
  id?: string | null
  email?: string | null
  role?: string | null
  ip?: string | null
  sessionId?: string | null
}

// Extract actor IP from request headers
export function getActorIp(req: Request | null): string | null {
  if (!req) return null
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    null
  )
}

// SHA-256 hash of a string
function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

// Build the payload string for hashing (deterministic field order)
function buildPayload(
  timestamp: string,
  actorId: string | null,
  actorEmail: string | null,
  action: string,
  resource: string,
  outcome: string,
  detail: string | null,
): string {
  return [timestamp, actorId ?? '', actorEmail ?? '', action, resource, outcome, detail ?? ''].join('|')
}

// ── Main audit() function ─────────────────────────────────────────────────
// Fire-and-forget safe — never throws, never blocks the caller.
export async function audit(
  req: Request | null,
  actor: AuditActor | null,
  action: AuditAction | string,
  resource: string,                    // format: "type:id" e.g. "connection:abc123"
  outcome: AuditOutcome = 'success',
  detail?: Record<string, unknown> | null,
): Promise<void> {
  try {
    const sql = getDb()
    const timestamp = new Date().toISOString()
    const actorIp = getActorIp(req)

    // Extract bare resource ID from "type:id" format
    const resourceId = resource.includes(':') ? resource.split(':').slice(1).join(':') : resource

    // Sanitise detail — strip sensitive fields
    const safeDetail = detail ? sanitiseDetail(detail) : null
    const detailStr = safeDetail ? JSON.stringify(safeDetail) : null

    // Get previous row's checksum for hash chain
    const prevRows = await sql`
      SELECT checksum FROM audit_events ORDER BY timestamp DESC LIMIT 1`
    const prevHash = (prevRows[0] as { checksum: string } | undefined)?.checksum ?? '0'

    // Build checksum = SHA-256(prevHash + payload)
    const payload = buildPayload(timestamp, actor?.id ?? null, actor?.email ?? null, action, resource, outcome, detailStr)
    const checksum = sha256(prevHash + payload)

    await sql`
      INSERT INTO audit_events
        (timestamp, actor_id, actor_email, actor_ip, actor_role, session_id,
         action, resource, resource_id, outcome, detail, prev_hash, checksum)
      VALUES
        (${timestamp}, ${actor?.id ?? null}, ${actor?.email ?? null},
         ${actorIp}, ${actor?.role ?? null}, ${actor?.sessionId ?? null},
         ${action}, ${resource}, ${resourceId}, ${outcome},
         ${detailStr}, ${prevHash}, ${checksum})`
  } catch (err) {
    // Audit must never crash the calling code
    log.error({ service: 'audit', err, action, resource }, 'Audit write failed')
  }
}

// ── Chain verification ────────────────────────────────────────────────────
export interface ChainVerifyResult {
  valid: boolean
  totalRows: number
  brokenAt?: { id: string; timestamp: string; expected: string; got: string }
}

export async function verifyAuditChain(): Promise<ChainVerifyResult> {
  const sql = getDb()
  const rows = await sql`
    SELECT id, timestamp, actor_id, actor_email, action, resource, outcome, detail, prev_hash, checksum
    FROM audit_events ORDER BY timestamp ASC` as Array<Record<string, string | null>>

  let prevChecksum = '0'
  for (const row of rows) {
    // detail may be auto-parsed as object by SQLite driver — re-stringify for hash consistency
    const detailForHash = row.detail == null
      ? null
      : typeof row.detail === 'string'
        ? row.detail
        : JSON.stringify(row.detail)
    const payload = buildPayload(row.timestamp!, row.actor_id ?? null, row.actor_email ?? null, row.action!, row.resource!, row.outcome!, detailForHash)
    const expected = sha256(prevChecksum + payload)
    if (expected !== row.checksum) {
      return { valid: false, totalRows: rows.length, brokenAt: { id: row.id!, timestamp: row.timestamp!, expected, got: row.checksum! } }
    }
    prevChecksum = row.checksum!
  }
  return { valid: true, totalRows: rows.length }
}

// ── Sensitive field sanitiser ─────────────────────────────────────────────
// Strip fields that should never appear in audit logs
const SENSITIVE_KEYS = new Set(['password', 'password_hash', 'token', 'secret', 'key', 'api_key', 'access_token', 'refresh_token', 'client_secret', 'password_enc', 'secret_key_enc', 'ssh_key_enc'])

function sanitiseDetail(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) {
      out[k] = '[REDACTED]'
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = sanitiseDetail(v as Record<string, unknown>)
    } else {
      out[k] = v
    }
  }
  return out
}

// ── Retention policy ──────────────────────────────────────────────────────
// Purge events older than retention_days (default 365).
// Called nightly by the built-in scheduler.
// After purge, re-anchors the chain from the new oldest row.
export async function purgeOldAuditEvents(): Promise<{ purged: number; retentionDays: number }> {
  const sql = getDb()
  try {
    // Read retention policy
    const setting = await sql`SELECT value FROM audit_settings WHERE key = 'retention_days' LIMIT 1`
    const retentionDays = parseInt((setting[0] as { value: string } | undefined)?.value || '365')
    const cutoff = new Date(Date.now() - retentionDays * 86400_000).toISOString()

    // Count before delete
    const countRows = await sql`SELECT COUNT(*) as cnt FROM audit_events WHERE timestamp < ${cutoff}`
    const purged = Number((countRows[0] as { cnt: string })?.cnt || 0)

    if (purged > 0) {
      await sql`DELETE FROM audit_events WHERE timestamp < ${cutoff}`
      // Re-anchor: update prev_hash of the new oldest row to '0'
      // so chain verification doesn't fail on missing ancestors
      await sql`UPDATE audit_events SET prev_hash = '0'
        WHERE id = (SELECT id FROM audit_events ORDER BY timestamp ASC LIMIT 1)`
        .catch(() => {})
      log.info({ service: 'audit', purged, retentionDays, cutoff }, 'Audit log purge complete')
    }

    // Record purge metadata
    await sql`UPDATE audit_settings SET value = ${new Date().toISOString()}, updated_at = ${new Date().toISOString()} WHERE key = 'last_purge_at'`
    await sql`UPDATE audit_settings SET value = ${String(purged)}, updated_at = ${new Date().toISOString()} WHERE key = 'last_purge_count'`

    // Write audit event for the purge itself (using internal actor)
    await audit(null, { email: 'system', role: 'system' }, AUDIT.AUDIT_PURGE, 'audit_log:purge', 'success', { purged, retentionDays, cutoff })

    return { purged, retentionDays }
  } catch (err) {
    log.error({ service: 'audit', err }, 'Audit purge failed')
    return { purged: 0, retentionDays: 365 }
  }
}

// ── Scheduled chain integrity check ──────────────────────────────────────
// Run daily. Writes CHAIN_VERIFY event with result so auditors can see
// integrity checks in the log itself.
export async function scheduledChainVerify(): Promise<void> {
  const sql = getDb()
  try {
    const setting = await sql`SELECT value FROM audit_settings WHERE key = 'chain_verify_enabled' LIMIT 1`
    const enabled = (setting[0] as { value: string } | undefined)?.value !== 'false'
    if (!enabled) return

    const result = await verifyAuditChain()

    // Write the verify result into the audit log
    await audit(null, { email: 'system', role: 'system' }, AUDIT.CHAIN_VERIFY, 'audit_log:integrity', result.valid ? 'success' : 'failure', {
      totalRows: result.totalRows,
      brokenAt: result.brokenAt || null,
    })

    // Update last_chain_verify_at metadata
    await sql`UPDATE audit_settings SET value = ${new Date().toISOString()}, updated_at = ${new Date().toISOString()} WHERE key = 'last_chain_verify_at'`
    await sql`UPDATE audit_settings SET value = ${result.valid ? 'true' : 'false'}, updated_at = ${new Date().toISOString()} WHERE key = 'last_chain_verify_ok'`

    if (!result.valid) {
      log.error({ service: 'audit', brokenAt: result.brokenAt }, 'AUDIT CHAIN INTEGRITY FAILURE — log may have been tampered with')
    } else {
      log.info({ service: 'audit', totalRows: result.totalRows }, 'Scheduled chain verify passed')
    }
  } catch (err) {
    log.error({ service: 'audit', err }, 'Scheduled chain verify failed')
  }
}

// ── Get retention settings for display ───────────────────────────────────
export async function getAuditSettings(): Promise<Record<string, string>> {
  const sql = getDb()
  try {
    const rows = await sql`SELECT key, value FROM audit_settings` as { key: string; value: string }[]
    return Object.fromEntries(rows.map(r => [r.key, r.value]))
  } catch { return {} }
}
