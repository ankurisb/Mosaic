// Uniform row policy for dashboard PANEL data, applied server-side in the panel
// executor so no single panel can ship an unbounded result to the browser — and so
// any capping/downsampling is VISIBLE to the user (meta) rather than silent.
//
// Context: database sources are already capped inside queryDatabase (LIMIT wrap),
// but SQLite ran uncapped and API/PRISM return whatever the source gives. This makes
// the ceiling consistent for every source and, crucially, surfaces when it bit.

export interface RowMeta {
  total_rows: number       // rows the executor received (post source-side cap, if any)
  returned_rows: number    // rows actually shipped to the client
  downsampled: boolean     // a time-series was reduced via LTTB (shape preserved)
  truncated: boolean       // rows were dropped at the route (table/categorical overflow)
  source_capped?: boolean  // the source itself hit its fetch ceiling (more rows exist there)
}

// Charts whose rows are an ordered series worth downsampling (vs. dropping rows).
const TIME_SERIES_CHARTS = new Set(['line', 'area', 'bar'])

export function extractRows(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[]
  if (data && typeof data === 'object') {
    const r = (data as Record<string, unknown>).rows
    if (Array.isArray(r)) return r as Record<string, unknown>[]
  }
  return []
}

// Pick the numeric column to drive downsampling: the chart's configured y/value key
// if numeric, else the first numeric column that isn't the x/label key.
function pickYKey(rows: Record<string, unknown>[], chartConfig?: Record<string, unknown>): string | null {
  if (!rows.length) return null
  const keys = Object.keys(rows[0])
  const isNum = (k: string) => rows.some(r => typeof r[k] === 'number' || (r[k] != null && r[k] !== '' && !isNaN(Number(r[k]))))
  const cfgY = chartConfig && (chartConfig.y || chartConfig.value) as string | undefined
  if (cfgY && keys.includes(cfgY) && isNum(cfgY)) return cfgY
  const xKey = chartConfig && (chartConfig.x || chartConfig.label) as string | undefined
  for (const k of keys) { if (k !== xKey && isNum(k)) return k }
  return null
}

// Largest-Triangle-Three-Buckets downsample over ORDINAL position (row index as x,
// the chosen numeric column as y). Returns the indices to keep, always including the
// first and last point, so the visual shape and endpoints survive. All columns of a
// kept row are preserved, so multi-series charts keep every series at those points.
export function lttbIndices(rows: Record<string, unknown>[], yKey: string, threshold: number): number[] {
  const n = rows.length
  if (threshold >= n || threshold < 3) return rows.map((_, i) => i)
  const y = (i: number) => { const v = Number(rows[i][yKey]); return isNaN(v) ? 0 : v }
  const out: number[] = [0]
  const every = (n - 2) / (threshold - 2)
  let a = 0
  for (let i = 0; i < threshold - 2; i++) {
    let avgX = 0, avgY = 0
    const rangeStart = Math.floor((i + 1) * every) + 1
    const rangeEnd = Math.min(Math.floor((i + 2) * every) + 1, n)
    const rangeLen = Math.max(1, rangeEnd - rangeStart)
    for (let j = rangeStart; j < rangeEnd; j++) { avgX += j; avgY += y(j) }
    avgX /= rangeLen; avgY /= rangeLen
    const rangeOffs = Math.floor(i * every) + 1
    const rangeTo = Math.floor((i + 1) * every) + 1
    let maxArea = -1, next = rangeOffs
    for (let j = rangeOffs; j < rangeTo; j++) {
      const area = Math.abs((a - avgX) * (y(j) - y(a)) - (a - j) * (avgY - y(a)))
      if (area > maxArea) { maxArea = area; next = j }
    }
    out.push(next); a = next
  }
  out.push(n - 1)
  return out
}

export interface CapOpts { maxPoints?: number; maxRows?: number; sourceCapped?: boolean }

// Apply the row policy to one panel's data. Time-series charts over the point ceiling
// are downsampled (shape kept); other shapes over the row ceiling are truncated. Rows
// at or under the ceiling pass through untouched. Always returns meta describing what,
// if anything, happened.
export function capPanelRows(
  data: unknown,
  chartType: string,
  chartConfig: Record<string, unknown> | undefined,
  opts: CapOpts = {},
): { rows: Record<string, unknown>[]; meta: RowMeta } {
  const rows = extractRows(data)
  const total = rows.length
  const maxPoints = opts.maxPoints ?? 1000
  const maxRows = opts.maxRows ?? 1000
  const base: RowMeta = { total_rows: total, returned_rows: total, downsampled: false, truncated: false, source_capped: opts.sourceCapped || undefined }

  if (TIME_SERIES_CHARTS.has(chartType) && total > maxPoints) {
    const yKey = pickYKey(rows, chartConfig)
    if (yKey) {
      const idx = lttbIndices(rows, yKey, maxPoints)
      const out = idx.map(i => rows[i])
      return { rows: out, meta: { ...base, returned_rows: out.length, downsampled: true } }
    }
    // No numeric column to downsample on — fall back to truncation.
    return { rows: rows.slice(0, maxPoints), meta: { ...base, returned_rows: maxPoints, truncated: true } }
  }
  if (total > maxRows) {
    return { rows: rows.slice(0, maxRows), meta: { ...base, returned_rows: maxRows, truncated: true } }
  }
  return { rows, meta: base }
}
