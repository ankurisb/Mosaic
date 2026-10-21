// lib/dashboard-grain.ts
// Window-logical aggregation grain. The dashboard's global time window bounds which
// aggregation grains make sense: a 7-day window must not offer 5-minute buckets (2016
// points), and a 15-minute window must not offer 1-day buckets (0 points). This is the
// single source of truth for that rule, imported by BOTH the UI (to build the Aggregation
// selector) and the server (to clamp, so a stale/explicit grain can never slip through).
// Pure + unit-tested.

export type Grain = '1m' | '5m' | '15m' | '30m' | '1h' | '6h' | '12h' | '1d' | '1w' | '1mo'

// Fine → coarse. Also the display order of the selector.
export const GRAIN_ORDER: Grain[] = ['1m', '5m', '15m', '30m', '1h', '6h', '12h', '1d', '1w', '1mo']
export const GRAIN_MS: Record<Grain, number> = {
  '1m': 60e3, '5m': 300e3, '15m': 900e3, '30m': 1800e3, '1h': 3600e3,
  '6h': 6 * 3600e3, '12h': 12 * 3600e3, '1d': 86400e3, '1w': 7 * 86400e3, '1mo': 30 * 86400e3,
}
export const GRAIN_LABEL: Record<Grain, string> = {
  '1m': '1 min', '5m': '5 min', '15m': '15 min', '30m': '30 min', '1h': '1 hour',
  '6h': '6 hours', '12h': '12 hours', '1d': '1 day', '1w': '1 week', '1mo': '1 month',
}

// A grain is logical for a window when the resulting bucket count is neither absurdly
// high (unreadable, slow) nor degenerate (fewer than a couple of buckets).
const MAX_BUCKETS = 500
const MIN_BUCKETS = 2
const TARGET_BUCKETS = 120   // the "nice resolution" the default aims for

// Preset window → representative duration (ms) for grain selection. 'today' is treated as
// a full day; 'all' as very wide so only coarse grains qualify.
const WINDOW_MS: Record<string, number> = {
  '15m': 900e3, '1h': 3600e3, '6h': 6 * 3600e3, 'today': 86400e3, '24h': 86400e3,
  '7d': 7 * 86400e3, '30d': 30 * 86400e3, '90d': 90 * 86400e3, '1y': 365 * 86400e3,
  'all': 20 * 365 * 86400e3,
}

// Duration (ms) of the selected window, for grain logic. Custom ranges compute from dates.
export function windowMsFor(timeWindow: string, customFrom?: string, customTo?: string): number {
  if (timeWindow === 'custom' && customFrom && customTo) {
    const a = Date.parse(customFrom), b = Date.parse(customTo)
    if (isFinite(a) && isFinite(b) && b > a) return b - a
    return 86400e3
  }
  return WINDOW_MS[timeWindow] ?? 86400e3
}

// The grains that make sense for a window of this duration, fine → coarse.
export function allowedGrains(windowMs: number): Grain[] {
  const out = GRAIN_ORDER.filter(g => {
    const buckets = windowMs / GRAIN_MS[g]
    return buckets <= MAX_BUCKETS && buckets >= MIN_BUCKETS
  })
  // Never return empty: fall back to the single closest-to-target grain.
  return out.length ? out : [closestToTarget(windowMs)]
}

function closestToTarget(windowMs: number): Grain {
  let best: Grain = '1d', bestD = Infinity
  for (const g of GRAIN_ORDER) {
    const d = Math.abs(windowMs / GRAIN_MS[g] - TARGET_BUCKETS)
    if (d < bestD) { bestD = d; best = g }
  }
  return best
}

// The default grain for a window: the allowed grain whose bucket count is closest to the
// target resolution.
export function defaultGrain(windowMs: number): Grain {
  const allowed = allowedGrains(windowMs)
  let best = allowed[0], bestD = Infinity
  for (const g of allowed) {
    const d = Math.abs(windowMs / GRAIN_MS[g] - TARGET_BUCKETS)
    if (d < bestD) { bestD = d; best = g }
  }
  return best
}

// Clamp a requested grain into the window's allowed set: too fine → the finest allowed,
// too coarse → the coarsest allowed. A valid/allowed grain passes through unchanged.
// Returns null for an unrecognised grain (caller treats as "no explicit grain").
export function clampGrain(grain: string | null | undefined, windowMs: number): Grain | null {
  if (!grain || !(grain in GRAIN_MS)) return null
  const g = grain as Grain
  const allowed = allowedGrains(windowMs)
  if (allowed.includes(g)) return g
  // too fine (more buckets than the finest allowed) → finest allowed; else coarsest.
  const buckets = windowMs / GRAIN_MS[g]
  const finest = allowed[0], coarsest = allowed[allowed.length - 1]
  return buckets > windowMs / GRAIN_MS[finest] ? finest : coarsest
}
