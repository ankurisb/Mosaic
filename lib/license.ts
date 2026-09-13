// lib/license.ts
// Mosaic client-side license gate (Layer 2 of the code-protection design). Phones
// the licensing service on boot + a timer, caches the last-good result (in the DB so
// it survives restarts), applies a GRACE window when the service is unreachable
// (transient outage or air-gapped site shouldn't break a paying customer), and
// exposes getLicenseState() for the feature gate.
//
// FEATURE-GATE behaviour: when the state is 'unlicensed', AI/data features are
// disabled but the app still loads and login works, so the admin sees a clear
// "license required" message (a scary crash would be a worse experience and no more
// secure). Enforcement lives in requireLicensed() used by the AI/data routes.
import { getDb } from './db'
import { verifyLicenseKey } from './license-verify'

const LICENSE_KEY = process.env.LICENSE_KEY || ''
const LICENSE_SERVER_URL = process.env.LICENSE_SERVER_URL || ''
// How often the app re-validates with the licensing service. A shorter interval means
// a revoke/expiry takes effect sooner (bounded by this window); a longer one means
// fewer calls. 30 min is a good default — revocation is honoured within half an hour
// without phoning home on every request. Override with LICENSE_CHECK_MINUTES.
const CHECK_INTERVAL_MS = Math.max(1, Number(process.env.LICENSE_CHECK_MINUTES) || 30) * 60 * 1000

export type LicenseStatus = 'licensed' | 'grace' | 'unlicensed' | 'unconfigured'
export interface LicenseState {
  status: LicenseStatus
  edition?: string
  seat_limit?: number
  active_seats?: number
  seats_ok?: boolean
  expires_at?: string | null
  reason?: string           // why unlicensed (expired/revoked/etc.)
  last_checked?: string
  grace_until?: string | null
  message?: string          // human-facing message for the gate UI
}

// In-memory cache of the current state (refreshed on the timer / boot).
let current: LicenseState = { status: 'unconfigured' }
let timer: ReturnType<typeof setInterval> | null = null
// Short-lived per-instance memo of the DB cache read, so the gate doesn't hit the DB
// on every single request but still picks up cache changes (revoke/reactivate) written
// by the boot-checker instance within a few seconds.
let cacheMemo: { state: LicenseState; at: number } | null = null
const CACHE_MEMO_MS = 5000
let refreshInFlight = false // prevents overlapping on-demand refreshes

// A stable machine fingerprint (best-effort, non-identifying) for seat/usage
// correlation on the server. Derived from hostname + platform; not a hard binding.
async function fingerprint(): Promise<string> {
  try {
    const os = await import('os')
    const crypto = await import('crypto')
    return crypto.createHash('sha256').update(`${os.hostname()}|${os.platform()}|${os.arch()}`).digest('hex').slice(0, 32)
  } catch { return 'unknown' }
}

// Count "active seats" = users who logged in within the seat window (30 days).
async function countActiveSeats(): Promise<number> {
  try {
    const sql = getDb()
    const rows = await sql`SELECT COUNT(*) AS n FROM users WHERE last_login_at IS NOT NULL AND last_login_at > datetime('now', '-30 days')` as unknown as { n: number }[]
    const n = Number(rows?.[0]?.n)
    if (Number.isFinite(n)) return n
  } catch { /* table/column may differ; fall through */ }
  // Fallback: total users (never undercount into a false 'over limit').
  try { const sql = getDb(); const r = await sql`SELECT COUNT(*) AS n FROM users` as unknown as { n: number }[]; return Number(r?.[0]?.n) || 0 } catch { return 0 }
}

// Persist / read the last-good validation so grace survives a restart.
async function saveCache(state: LicenseState): Promise<void> {
  try {
    const sql = getDb()
    const CACHE_KEY = '__license_cache__'
    const val = JSON.stringify(state)
    await sql`INSERT INTO kv_settings (key, value_enc) VALUES (${CACHE_KEY}, ${val})
              ON CONFLICT(key) DO UPDATE SET value_enc = ${val}`
  } catch { /* best-effort */ }
}
async function readCache(): Promise<LicenseState | null> {
  try {
    const sql = getDb()
    const CACHE_KEY = '__license_cache__'
    const rows = await sql`SELECT value_enc FROM kv_settings WHERE key = ${CACHE_KEY} LIMIT 1` as unknown as { value_enc: string }[]
    if (rows?.[0]?.value_enc) return JSON.parse(rows[0].value_enc)
  } catch { /* ignore */ }
  return null
}

// Do one phone-home. Returns the fresh state, or null if the server was unreachable.
async function phoneHome(): Promise<LicenseState | null> {
  if (!LICENSE_SERVER_URL || !LICENSE_KEY) return null
  try {
    const active = await countActiveSeats()
    const fp = await fingerprint()
    const res = await fetch(`${LICENSE_SERVER_URL.replace(/\/$/, '')}/license/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: LICENSE_KEY, active_seats: active, fingerprint: fp, app_version: process.env.APP_VERSION || '' }),
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return null
    const d = await res.json()
    const now = new Date().toISOString()
    if (d.valid) {
      const graceDays = Number(d.grace_days) || 14
      return {
        status: 'licensed',
        edition: d.edition, seat_limit: d.seat_limit, active_seats: d.active_seats,
        seats_ok: d.seats_ok, expires_at: d.expires_at ?? null,
        last_checked: now,
        grace_until: new Date(Date.now() + graceDays * 86400000).toISOString(),
        message: d.seats_ok === false ? `Over seat limit (${d.active_seats}/${d.seat_limit}) — contact UGX to add seats.` : undefined,
      }
    }
    // Server said explicitly invalid — no grace for a definitive revoke/expiry.
    return { status: 'unlicensed', reason: d.reason, edition: d.edition, last_checked: now,
      message: `Mosaic is not licensed (${d.reason || 'invalid'}). Contact UGX to restore access.` }
  } catch {
    return null // unreachable — caller applies grace
  }
}

// Compute the effective state, applying grace when the server is unreachable.
async function refresh(): Promise<LicenseState> {
  // No license configured at all → 'unconfigured'. In this state the gate is OPEN
  // (so existing/unlicensed-by-design installs and dev keep working); licensing only
  // ENFORCES once LICENSE_KEY + LICENSE_SERVER_URL are set. This makes rollout safe:
  // shipping the gate doesn't lock out anyone until you actually issue licenses.
  if (!LICENSE_SERVER_URL || !LICENSE_KEY) {
    current = { status: 'unconfigured' }
    return current
  }

  // Offline fast-check: if the key can't even be verified against the baked-in public
  // key, it's forged/garbage → unlicensed immediately (no server needed).
  if (!verifyLicenseKey(LICENSE_KEY)) {
    current = { status: 'unlicensed', reason: 'invalid_signature', message: 'License key is invalid. Contact UGX.' }
    await saveCache(current)
    return current
  }

  const fresh = await phoneHome()
  if (fresh) {
    current = fresh
    await saveCache(fresh)
    return current
  }

  // Unreachable → apply grace off the last-good cache.
  const cached = await readCache()
  if (cached && cached.status === 'licensed' && cached.grace_until) {
    if (Date.now() < new Date(cached.grace_until).getTime()) {
      current = { ...cached, status: 'grace', message: 'Licensing server unreachable — running on cached license (grace period).' }
      return current
    }
    // Grace expired with no contact → unlicensed.
    current = { status: 'unlicensed', reason: 'grace_expired', last_checked: cached.last_checked,
      message: 'License could not be verified within the grace period. Reconnect or contact UGX.' }
    await saveCache(current)
    return current
  }

  // Never had a good check and can't reach the server → treat as grace on first boot
  // (don't hard-lock a fresh install just because the network blipped at startup).
  current = { status: 'grace', reason: 'never_validated', message: 'Verifying license…' }
  return current
}

export function getLicenseState(): LicenseState {
  return current
}

// Async state read for request handlers. The DB cache (written by the boot-checker's
// periodic refresh) is the SHARED SOURCE OF TRUTH across Next's separate module
// instances — so the gate reads THAT, not a per-instance in-memory `current` (which
// goes stale in the instance that isn't running the timer). Memoized 5s so we don't
// hit the DB on every request while still honouring a revoke/reactivate within seconds.
export async function getLicenseStateAsync(): Promise<LicenseState> {
  if (!LICENSE_SERVER_URL || !LICENSE_KEY) return { status: 'unconfigured' }

  // Fresh-enough memo?
  if (cacheMemo && Date.now() - cacheMemo.at < CACHE_MEMO_MS) return cacheMemo.state

  const cached = await readCache()
  if (cached && (cached.status === 'licensed' || cached.status === 'unlicensed' || cached.status === 'grace')) {
    // Re-derive grace expiry against wall clock (a cached 'grace' may have lapsed).
    let state = cached
    if (cached.status === 'grace' && cached.grace_until && Date.now() >= new Date(cached.grace_until).getTime()) {
      state = { status: 'unlicensed', reason: 'grace_expired', message: 'License could not be verified within the grace period. Reconnect or contact UGX.' }
    }
    cacheMemo = { state, at: Date.now() }
    // On-demand refresh: if the cache is older than the check interval, kick off a
    // background re-validate. This is more reliable than a bare setInterval in Next's
    // runtime (timers can be dropped), and a live app gets requests regularly, so the
    // cache stays fresh — a revoke/expiry is honoured within ~one check interval.
    const age = Date.now() - new Date(cached.last_checked || 0).getTime()
    if (age > CHECK_INTERVAL_MS && !refreshInFlight) {
      refreshInFlight = true
      refresh().finally(() => { refreshInFlight = false; cacheMemo = null })
    }
    ensureTimer()
    return state
  }

  // No usable cache yet → do one inline check so the gate has an answer.
  try {
    const fresh = await refresh()
    cacheMemo = { state: fresh, at: Date.now() }
    ensureTimer()
    return fresh
  } catch {
    return { status: 'grace', reason: 'warming_up', message: 'Verifying license…' }
  }
}

// Async licensed check for request handlers (consistent across module instances).
export async function isLicensedAsync(): Promise<boolean> {
  const s = await getLicenseStateAsync()
  return s.status === 'licensed' || s.status === 'grace' || s.status === 'unconfigured'
}

// Is the product allowed to run its gated (AI/data) features right now?
export function isLicensed(): boolean {
  return current.status === 'licensed' || current.status === 'grace' || current.status === 'unconfigured'
}

// Ensure the periodic refresh timer exists in the current module instance. Idempotent.
function ensureTimer(): void {
  if (timer || !LICENSE_SERVER_URL || !LICENSE_KEY) return
  timer = setInterval(() => { refresh().catch(() => {}) }, CHECK_INTERVAL_MS)
  timer.unref?.()
}

// Start the periodic checker (called from instrumentation at boot). Runs one check
// immediately, then every CHECK_INTERVAL_MS. Never throws — licensing must not crash
// the app.
export async function startLicenseChecker(): Promise<void> {
  try { await refresh() } catch { /* keep going */ }
  ensureTimer()
}
