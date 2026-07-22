// lib/rate-limit.ts
// Lightweight in-memory sliding-window rate limiter for pre-authentication
// endpoints (login), where a DB-backed per-user counter can't apply because
// there is no authenticated user yet and the whole point is to bound attempts.
//
// In-memory is deliberate and sufficient here: a process restart resetting the
// window is acceptable for brute-force defence, and it adds no DB load on the
// hot login path. For a multi-instance deployment behind a load balancer this
// limits per instance; a shared store (Redis) would be the next step if that
// becomes the topology, but Mosaic runs as a single instance per customer.

type Bucket = { count: number; resetAt: number }
const buckets = new Map<string, Bucket>()

// Opportunistic cleanup so the map doesn't grow unbounded from one-off IPs.
let lastSweep = Date.now()
function sweep(now: number) {
  if (now - lastSweep < 60_000) return
  lastSweep = now
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k)
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  retryAfterSec: number
}

/**
 * Record an attempt for `key` and report whether it's allowed.
 * @param key       identity to limit on (e.g. `login:<ip>`)
 * @param max       max attempts permitted within the window
 * @param windowMs  window length in milliseconds
 */
export function rateLimit(key: string, max: number, windowMs: number): RateLimitResult {
  const now = Date.now()
  sweep(now)
  const existing = buckets.get(key)
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, remaining: max - 1, retryAfterSec: 0 }
  }
  existing.count++
  if (existing.count > max) {
    return { allowed: false, remaining: 0, retryAfterSec: Math.ceil((existing.resetAt - now) / 1000) }
  }
  return { allowed: true, remaining: max - existing.count, retryAfterSec: 0 }
}

/** Clear a key's counter — e.g. on a successful login, so a legitimate user
 *  who fat-fingered a few times isn't held to the failed-attempt budget. */
export function clearRateLimit(key: string) {
  buckets.delete(key)
}
