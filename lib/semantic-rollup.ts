// lib/semantic-rollup.ts
// Phase 2: deterministic time-grain shaping. Rolls a raw-timestamp series up to a
// coarser grain (by-minute/hour/day/week/month), aggregating each measure by its
// DECLARED aggregation (from the semantic model) rather than guessing at runtime.
// Pure + unit-testable; no DB.

export type Grain = '1m' | '5m' | '15m' | '30m' | '1h' | '6h' | '12h' | '1d' | '1w' | '1mo'
export type Agg = 'sum' | 'avg' | 'min' | 'max' | 'last' | 'count' | 'count_distinct'

const MIN_MS: Partial<Record<Grain, number>> = {
  '1m': 60e3, '5m': 5 * 60e3, '15m': 15 * 60e3, '30m': 30 * 60e3,
  '1h': 3600e3, '6h': 6 * 3600e3, '12h': 12 * 3600e3,
}

// Truncate a timestamp to the start of its grain bucket. Returns a stable string key:
// ISO (sub-day), 'YYYY-MM-DD' (day/week), 'YYYY-MM' (month). Non-dates return the raw
// string so a non-temporal column still groups deterministically.
export function bucketTime(value: unknown, grain: Grain): string {
  const ms = typeof value === 'number' ? value : Date.parse(String(value))
  if (!isFinite(ms)) return String(value)
  const d = new Date(ms)
  if (grain === '1d') return d.toISOString().slice(0, 10)
  if (grain === '1mo') return d.toISOString().slice(0, 7)
  if (grain === '1w') {
    const day = (d.getUTCDay() + 6) % 7            // Monday=0
    const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day))
    return monday.toISOString().slice(0, 10)
  }
  const step = MIN_MS[grain]
  if (!step) return d.toISOString()
  return new Date(Math.floor(ms / step) * step).toISOString()
}

function aggregate(values: unknown[], agg: Agg): number | null {
  const nums = values.map(v => Number(v)).filter(n => isFinite(n))
  if (agg === 'count') return values.length
  if (agg === 'count_distinct') return new Set(values.map(v => String(v))).size
  if (!nums.length) return agg === 'last' ? null : null
  switch (agg) {
    case 'sum': return nums.reduce((a, b) => a + b, 0)
    case 'avg': return nums.reduce((a, b) => a + b, 0) / nums.length
    case 'min': return Math.min(...nums)
    case 'max': return Math.max(...nums)
    case 'last': return nums[nums.length - 1]
    default: return null
  }
}

export interface RollupSpec {
  timeKey: string
  grain: Grain
  measures: Record<string, Agg>   // measure column -> aggregation
  seriesKeys?: string[]           // dimensions that split series (kept, grouped on)
}

// Roll rows up to the grain. Output: one row per (bucket × series), with the time key
// = bucket, series keys preserved, and each measure aggregated. Sorted by bucket then
// series. Rows are assumed in source order (matters only for 'last').
export function rollupByGrain(rows: Record<string, unknown>[], spec: RollupSpec): Record<string, unknown>[] {
  if (!rows.length) return rows
  const seriesKeys = spec.seriesKeys || []
  const groups = new Map<string, { bucket: string; series: Record<string, unknown>; vals: Record<string, unknown[]> }>()
  for (const r of rows) {
    const bucket = bucketTime(r[spec.timeKey], spec.grain)
    const seriesVals: Record<string, unknown> = {}
    for (const k of seriesKeys) seriesVals[k] = r[k]
    const gk = bucket + '\u0000' + seriesKeys.map(k => String(r[k] ?? '')).join('\u0000')
    let g = groups.get(gk)
    if (!g) { g = { bucket, series: seriesVals, vals: {} }; for (const m of Object.keys(spec.measures)) g.vals[m] = []; groups.set(gk, g) }
    for (const m of Object.keys(spec.measures)) g.vals[m].push(r[m])
  }
  const out: Record<string, unknown>[] = []
  for (const g of groups.values()) {
    const row: Record<string, unknown> = { [spec.timeKey]: g.bucket, ...g.series }
    for (const [m, agg] of Object.entries(spec.measures)) row[m] = aggregate(g.vals[m], agg)
    out.push(row)
  }
  out.sort((a, b) => {
    const t = String(a[spec.timeKey]).localeCompare(String(b[spec.timeKey]))
    if (t !== 0) return t
    return seriesKeys.map(k => String(a[k] ?? '').localeCompare(String(b[k] ?? ''))).find(x => x !== 0) || 0
  })
  return out
}
