// lib/panel-contract.ts
// Phase 4: the panel contract — validate a panel's chart ↔ data ↔ time at build and
// render time, so a dashboard surfaces its own problems instead of failing silently.
// Pure + unit-testable. Three checks:
//   1. window responsiveness — does the panel actually honour the global time window?
//   2. chart shape — does the data fit the chosen chart type?
//   3. lineage — a record of how a value was produced (auditable).

// ---- 1. Window responsiveness (the #5 foot-gun) ----------------------------
// A SQL/API panel only respects the dashboard window if its query carries the
// {{time_from}}/{{time_to}} placeholders. PRISM always windows (the executor injects
// the range); file sources have no window. Returns false ONLY when a panel that
// COULD window silently doesn't.
const TIME_PLACEHOLDER = /\{\{\s*time_(from|to)\s*\}\}/
export function windowResponsive(sourceType: string, query: string | null | undefined): boolean {
  const st = (sourceType || 'database').toLowerCase()
  if (st === 'prism' || st === 'file_server' || st === 'file') return true
  return TIME_PLACEHOLDER.test(String(query || ''))
}

// ---- 2. Chart shape --------------------------------------------------------
export interface ShapeResult { ok: boolean; errors: string[]; warnings: string[] }

const CARTESIAN = new Set(['line', 'area', 'bar'])
const SINGLE_VALUE = new Set(['stat', 'kpi', 'gauge'])
const CATEGORY = new Set(['donut', 'pie'])

function isNumericCol(rows: Record<string, unknown>[], col: string): boolean {
  return rows.some(r => { const v = r[col]; return typeof v === 'number' || (v != null && v !== '' && isFinite(Number(v))) })
}

// Validate that the result rows fit the chart type (+ any x/y config). Errors mean
// "won't render meaningfully"; warnings mean "renders but check it".
export function validateChartShape(
  chartType: string,
  rows: Record<string, unknown>[],
  chartConfig?: Record<string, unknown>,
): ShapeResult {
  const r: ShapeResult = { ok: true, errors: [], warnings: [] }
  const ct = (chartType || 'bar').toLowerCase()
  if (!rows.length) { r.warnings.push('No rows returned for this window.'); return r }
  const cols = Object.keys(rows[0])
  const cfg = chartConfig || {}
  const x = (cfg.x || cfg.label) as string | undefined
  const yCfg = (cfg.y || cfg.value) as string | undefined
  const numericCols = cols.filter(c => isNumericCol(rows, c))

  if (x && !cols.includes(x)) r.errors.push(`x column "${x}" is not in the result.`)
  if (yCfg && !cols.includes(yCfg)) r.errors.push(`value column "${yCfg}" is not in the result.`)

  if (CARTESIAN.has(ct)) {
    if (cols.length < 2) r.errors.push(`A ${ct} chart needs an x (category/time) and a numeric y.`)
    const y = yCfg && cols.includes(yCfg) ? yCfg : numericCols.find(c => c !== x)
    if (!y) r.errors.push(`A ${ct} chart needs a numeric value column; none of the columns are numeric.`)
    else if (yCfg && !isNumericCol(rows, yCfg)) r.warnings.push(`value column "${yCfg}" is not numeric.`)
  } else if (SINGLE_VALUE.has(ct)) {
    if (!numericCols.length) r.errors.push(`A ${ct} needs a numeric value; none of the columns are numeric.`)
  } else if (CATEGORY.has(ct)) {
    if (cols.length < 2) r.errors.push(`A ${ct} chart needs a category column and a numeric value.`)
    if (!numericCols.length) r.errors.push(`A ${ct} chart needs a numeric value column.`)
    const cats = new Set(rows.map(row => String(row[x || cols[0]])))
    if (cats.size > 30) r.warnings.push(`High cardinality (${cats.size} categories) — a ${ct} will be unreadable; consider a bar chart or a top-N.`)
  } else if (ct === 'heatmap') {
    if (cols.length < 3) r.errors.push('A heatmap needs two dimensions and a numeric value.')
  }
  // table and anything else: no shape constraint.
  r.ok = r.errors.length === 0
  return r
}

// ---- 3. Lineage ------------------------------------------------------------
export interface Lineage {
  source_type: string
  source_id: string
  window: string
  transforms: string[]     // e.g. ['delta:energy_kwh', 'rollup:1d']
  measures?: string[]
}
export function buildLineage(args: { sourceType: string; sourceId: string; window: string; transforms: string[]; measures?: string[] }): Lineage {
  return {
    source_type: args.sourceType,
    source_id: args.sourceId,
    window: args.window,
    transforms: args.transforms,
    measures: args.measures,
  }
}
