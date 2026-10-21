// lib/dashboard-plan.ts
// Phase 1B — the typed "dashboard plan" the chat-native builder produces, plus the
// pure validation logic that gates it BEFORE anything is shown or saved.
//
// The flow (see claude/mosaic-dashboard-chat-builder-design.md): the model emits a
// DashboardPlan (title + N panels); the server dry-runs every panel's query
// read-only with a bounded LIMIT, classifies each result (data/empty/error), and
// only then streams a proposal to the UI. On confirm, the SAME panels persist via
// the existing create_dashboard / add_panel actions.
//
// Everything here is pure and isomorphic (no DB, no network) so it is unit-tested
// and safe to call in the hot path. Execution + persistence live in the route.

// Chart types the native panel renderer (PanelChart) understands. Kept in sync
// with components/dashboards/PanelBuilder.tsx CHART_TYPES.
import { assertNoDangerousSql } from './sql-guard'

export const DASH_CHART_TYPES = ['bar', 'line', 'area', 'table', 'stat', 'donut', 'gauge', 'heatmap', 'boxplot', 'sankey'] as const
export type DashChartType = typeof DASH_CHART_TYPES[number]

export const PANEL_SOURCE_TYPES = ['database', 'api', 'file_server', 'prism'] as const
export type PanelSourceType = typeof PANEL_SOURCE_TYPES[number]

export interface PanelPlan {
  intent?: string                 // why this panel exists (model's rationale; shown in the card)
  title: string
  subtitle?: string
  source_type: PanelSourceType
  source_id: string
  query: string                   // SQL (database), path (api), hint (file_server), or JSON query_prism params (prism)
  chart_type: DashChartType
  chart_config?: Record<string, unknown>
  suggested_grid?: { col: number; row: number; w: number; h: number }
  confidence?: number             // 0..1, model's own confidence
}

// Phase 9: optional device/entity-filter binding the builder emits for a multi-entity
// source. Panels then use {{entity_id}} and the dashboard gets this filter wired in.
export interface EntityBinding {
  source_type: string
  source_id: string
  kind: 'prism' | 'sql' | 'api'
  key_field?: string          // 'entity_id' (prism) | the SQL id column
  label_field?: string | null
  table?: string | null       // SQL table to list entities from
  default?: string[]          // default selected entity id(s)
}

export interface DashboardPlan {
  title: string
  description?: string
  panels: PanelPlan[]
  entity?: EntityBinding
}

// Bounds so an AI-authored plan can't produce an unwieldy dashboard or a runaway
// preview. Mirrors the defensive posture of the semantic-dictionary hardening.
export const MAX_PANELS = 12
export const PREVIEW_ROW_CAP = 50

// ── Read-only SQL guard ──────────────────────────────────────────────────────
// Mirrors the whitelist enforced inside runTool('query_database') (lib/tools.ts)
// so a bad panel is rejected at PLAN time with a clear, per-panel reason instead
// of failing opaquely at execution. SQL dialects only; non-SQL stores (mongodb,
// elasticsearch) and non-database sources defer to their own runtime checks.
const BASE_ALLOWED = ['SELECT', 'WITH', 'EXPLAIN']
const DIALECT_EXTRAS: Record<string, string[]> = {
  influxdb: ['SHOW'],
  mysql: ['SHOW', 'DESCRIBE', 'DESC'],
  mssql: ['SHOW', 'DESCRIBE'],
  clickhouse: ['SHOW', 'DESCRIBE', 'DESC'],
  sqlite: ['PRAGMA'],
  postgres: [],
}
const NON_SQL_DIALECTS = new Set(['mongodb', 'elasticsearch'])

// Strip a single trailing semicolon + whitespace; used before statement checks.
function stripTrailingSemi(sql: string): string {
  return sql.replace(/;\s*$/,'').trim()
}

export interface GuardResult { ok: boolean; reason?: string }

export function readonlyGuard(rawSql: string, dialect: string): GuardResult {
  const d = (dialect || 'postgres').toLowerCase()
  if (NON_SQL_DIALECTS.has(d)) return { ok: true } // query form isn't SQL; defer to runtime
  const sql = stripTrailingSemi(String(rawSql || ''))
  if (!sql) return { ok: false, reason: 'empty query' }
  // Reject stacked statements (e.g. "SELECT …; DROP TABLE …"). Conservative: any
  // remaining semicolon after the trailing one is removed is treated as a second
  // statement. (Semicolons inside string literals are vanishingly rare in panel SQL.)
  if (sql.includes(';')) return { ok: false, reason: 'multiple statements are not allowed' }
  const upper = sql.toUpperCase()
  const allowed = [...BASE_ALLOWED, ...(DIALECT_EXTRAS[d] || [])]
  if (!allowed.some(v => upper.startsWith(v))) {
    return { ok: false, reason: `only ${allowed.join(' / ')} queries are allowed (read-only)` }
  }
  // Defence in depth: block network/filesystem table functions (ClickHouse url/s3/file/…)
  // and MySQL INTO OUTFILE that slip past the start-of-statement allowlist.
  try { assertNoDangerousSql(sql, d) } catch (e) { return { ok: false, reason: (e as Error).message } }
  return { ok: true }
}

// ── Preview bounding ─────────────────────────────────────────────────────────
// Produce a row-bounded version of a SELECT for the dry-run preview, so a panel
// over a huge table doesn't pull millions of rows just to show a tile. The STORED
// panel query is unchanged — this bounding is preview-only. Dialect-aware; a no-op
// for query shapes we can't safely rewrite (the preview then relies on the natural
// bounds of the query / time window).
export function withPreviewLimit(rawSql: string, dialect: string, cap = PREVIEW_ROW_CAP): string {
  const d = (dialect || 'postgres').toLowerCase()
  const sql = stripTrailingSemi(String(rawSql || ''))
  if (!sql) return sql
  if (['postgres', 'mysql', 'sqlite', 'clickhouse'].includes(d)) {
    const m = sql.match(/\blimit\s+(\d+)\s*$/i)
    if (m) {
      const existing = parseInt(m[1], 10)
      if (existing <= cap) return sql
      return sql.replace(/\blimit\s+\d+\s*$/i, `LIMIT ${cap}`)
    }
    return `${sql} LIMIT ${cap}`
  }
  if (d === 'mssql') {
    // Inject TOP after SELECT [DISTINCT] when not already present.
    if (/^\s*select\s+top\s+\d+/i.test(sql)) return sql
    return sql.replace(/^(\s*select\s+)(distinct\s+)?/i, (_m, sel, dist) => `${sel}${dist || ''}TOP ${cap} `)
  }
  return sql // influxdb / non-SQL: leave as-is
}

// ── Time-window substitution ─────────────────────────────────────────────────
// Replace {{time_from}} / {{time_to}} / {{interval}} placeholders in a panel query
// with concrete values from the dashboard's global time control. Timestamps are
// injected as QUOTED SQL string literals (and any quotes the author already wrote
// around the placeholder are absorbed, so both `{{time_from}}` and `'{{time_from}}'`
// produce exactly one pair of quotes). This is what lets a builder-made panel honour
// the dashboard's top-right time window instead of failing on an unquoted timestamp.
export interface TimeWindow { time_from: string; time_to: string; interval: string }
export function substituteTimeWindow(sql: string, w: TimeWindow): string {
  return String(sql || '')
    .replace(/'?\{\{\s*time_from\s*\}\}'?/g, `'${w.time_from}'`)
    .replace(/'?\{\{\s*time_to\s*\}\}'?/g, `'${w.time_to}'`)
    .replace(/\{\{\s*interval\s*\}\}/g, w.interval)
}

// API/OData variant: inject the timestamp UNQUOTED. OData $filter expects a bare
// ISO datetime (e.g. `ts ge 2026-04-01T00:00:00Z`), not a quoted string — quoting
// it (as the SQL variant does) produces an invalid $filter. Any quotes the author
// wrote around the placeholder are stripped so the result is always unquoted.
export function substituteTimeWindowApi(path: string, w: TimeWindow): string {
  return String(path || '')
    .replace(/'?\{\{\s*time_from\s*\}\}'?/g, w.time_from)
    .replace(/'?\{\{\s*time_to\s*\}\}'?/g, w.time_to)
    .replace(/\{\{\s*interval\s*\}\}/g, w.interval)
}

// ── Result classification ────────────────────────────────────────────────────
// Mirrors api-probe's classifyProbe: turn an execution outcome into a verdict the
// proposal card renders as green/amber/red. `error` wins; otherwise count rows.
export type PanelCls = 'data' | 'empty' | 'error'
export interface PanelClsResult { cls: PanelCls; rows: number; detail?: string }

function extractRows(result: unknown): unknown[] | null {
  if (Array.isArray(result)) return result
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>
    if (Array.isArray(r.rows)) return r.rows as unknown[]
    if (Array.isArray(r.records)) return r.records as unknown[]
    if (Array.isArray(r.data)) return r.data as unknown[]
  }
  return null
}

export function classifyPanelResult(result: unknown, error?: string | null): PanelClsResult {
  if (error) return { cls: 'error', rows: 0, detail: String(error).slice(0, 300) }
  const rows = extractRows(result)
  if (rows === null) {
    // No array shape we recognise — treat a truthy object as data, null/undefined as empty.
    return result ? { cls: 'data', rows: 0 } : { cls: 'empty', rows: 0, detail: 'no rows returned' }
  }
  if (rows.length === 0) return { cls: 'empty', rows: 0, detail: 'query ran but returned no rows' }
  return { cls: 'data', rows: rows.length }
}

// ── Plan / panel shape validation ────────────────────────────────────────────
export interface PanelShapeResult { ok: boolean; errors: string[] }

export function validatePanelShape(panel: Partial<PanelPlan>): PanelShapeResult {
  const errors: string[] = []
  if (!panel || typeof panel !== 'object') return { ok: false, errors: ['panel is not an object'] }
  if (!panel.title || !String(panel.title).trim()) errors.push('missing title')
  if (!panel.source_type || !PANEL_SOURCE_TYPES.includes(panel.source_type as PanelSourceType)) {
    errors.push(`source_type must be one of ${PANEL_SOURCE_TYPES.join(', ')}`)
  }
  if (!panel.source_id || !String(panel.source_id).trim()) errors.push('missing source_id')
  if (!panel.query || !String(panel.query).trim()) errors.push('missing query')
  if (!panel.chart_type || !DASH_CHART_TYPES.includes(panel.chart_type as DashChartType)) {
    errors.push(`chart_type must be one of ${DASH_CHART_TYPES.join(', ')}`)
  }
  // A PRISM panel's query is a JSON object of query_prism params — validate it
  // parses and names an operation, so a malformed panel is caught at plan time.
  if (panel.source_type === 'prism' && panel.query) {
    const pr = parsePrismQuery(String(panel.query))
    if (!pr.ok) errors.push(pr.error!)
  }
  return { ok: errors.length === 0, errors }
}

// ── PRISM panel query model ──────────────────────────────────────────────────
// A PRISM panel stores a JSON string of query_prism params in `query`, e.g.
//   {"operation":"telemetry_history","entity_type":"DEVICE","entity_id":"<uuid>",
//    "keys":["kWh"],"agg":"SUM","interval":3600000}
// The executor/dry-run parse it, inject the dashboard window as epoch-ms
// startTs/endTs (time-series ops only), run query_prism, then normalise the
// telemetry shape into rows the chart renderer understands. All pure here.

export interface PrismParseResult { ok: boolean; params?: Record<string, unknown>; error?: string }

// Accepts the query as a JSON string (the model's plan, and Postgres/Neon TEXT) or
// as an already-parsed object (SQLite's JSON auto-parse could hand us one), so the
// builder dry-run and the executor behave identically regardless of the DB driver.
export function parsePrismQuery(query: unknown): PrismParseResult {
  let parsed: unknown = query
  if (typeof query === 'string') {
    try { parsed = JSON.parse(query) }
    catch { return { ok: false, error: 'PRISM panel query must be valid JSON of query_prism params (e.g. {"operation":"telemetry_history","entity_id":"…","keys":["kWh"]})' } }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, error: 'PRISM panel query must be a JSON object of query_prism params' }
  const p = parsed as Record<string, unknown>
  if (!p.operation || typeof p.operation !== 'string') return { ok: false, error: 'PRISM panel query must include an "operation" (e.g. telemetry_history, telemetry_latest)' }
  return { ok: true, params: p }
}

// Ops whose results depend on the dashboard time window (epoch-ms startTs/endTs).
const PRISM_TIME_OPS = new Set(['telemetry_history'])

// ThingsBoard rejects an aggregated timeseries query whose interval count exceeds
// a server limit ("Number of intervals is too high - 721…"). The dashboard window
// is chosen at runtime, so the model can't size the interval safely — we clamp it
// server-side so ANY window yields at most this many buckets.
export const MAX_PRISM_INTERVALS = 500

// Inject the window as epoch-ms into a parsed params object (time-series ops
// only). ISO window strings → ms. When an aggregation interval is present, clamp
// it up so (window / interval) ≤ MAX_PRISM_INTERVALS, keeping the panel valid on
// any dashboard window instead of erroring. Returns a new object; never mutates input.
export function applyPrismWindow(params: Record<string, unknown>, w: { time_from: string; time_to: string }): Record<string, unknown> {
  if (!PRISM_TIME_OPS.has(String(params.operation || ''))) return { ...params }
  const out = { ...params }
  const startTs = Date.parse(w.time_from)
  const endTs = Date.parse(w.time_to)
  if (!Number.isNaN(startTs)) out.startTs = startTs
  if (!Number.isNaN(endTs)) out.endTs = endTs
  const interval = Number(out.interval)
  if (interval > 0 && !Number.isNaN(startTs) && !Number.isNaN(endTs) && endTs > startTs) {
    const span = endTs - startTs
    if (span / interval > MAX_PRISM_INTERVALS) out.interval = Math.ceil(span / MAX_PRISM_INTERVALS)
  }
  return out
}

// Telemetry values arrive as strings ("88.2"); coerce clean numerics so charts
// plot them. Non-numeric strings (status labels, JSON) pass through unchanged.
function coerceNum(v: unknown): unknown {
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return v
}

// Normalise a query_prism result into rows the panel renderer understands:
//  - telemetry_history {series:{key:[{ts,value}]}} → merged rows [{ts:ISO, <key>:n}] sorted ascending
//  - telemetry_latest  {telemetry:{key:{value}}}   → one row {<key>:n}
//  - devices/assets/etc already array-shaped        → that array
export function prismSeriesToRows(result: unknown): unknown[] {
  if (!result || typeof result !== 'object') return []
  const r = result as Record<string, unknown>
  if (r.series && typeof r.series === 'object' && !Array.isArray(r.series)) {
    const series = r.series as Record<string, Array<{ ts: number; value: unknown }>>
    const byTs = new Map<number, Record<string, unknown>>()
    for (const [key, points] of Object.entries(series)) {
      if (!Array.isArray(points)) continue
      for (const pt of points) {
        const ts = Number(pt?.ts)
        if (!Number.isFinite(ts)) continue
        let row = byTs.get(ts)
        if (!row) { row = { ts: new Date(ts).toISOString() }; byTs.set(ts, row) }
        row[key] = coerceNum(pt.value)
      }
    }
    return [...byTs.entries()].sort((a, b) => a[0] - b[0]).map(([, row]) => row)
  }
  if (r.telemetry && typeof r.telemetry === 'object' && !Array.isArray(r.telemetry)) {
    const t = r.telemetry as Record<string, unknown>
    const row: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(t)) {
      row[k] = coerceNum(v && typeof v === 'object' && 'value' in (v as Record<string, unknown>) ? (v as Record<string, unknown>).value : v)
    }
    return [row]
  }
  for (const key of ['devices', 'assets', 'customers', 'alarms', 'rows', 'data']) {
    if (Array.isArray(r[key])) return r[key] as unknown[]
  }
  return []
}

// ── Auto-default time window ──────────────────────────────────────────────────
// Detect the time span of a built dashboard's data (from the dry-run samples) and
// pick a default window that actually covers it — so a dashboard over historical
// data opens populated instead of blank on "Today".

// A value is time-like if it's an ISO date/datetime string or an epoch-ms number.
function valueToTs(v: unknown): number | null {
  if (typeof v === 'number') {
    // plausible epoch-ms (2001-09 .. 2286) or epoch-s
    if (v > 1e12 && v < 1e13) return v
    if (v > 1e9 && v < 1e10) return v * 1000
    return null
  }
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) {
    const t = Date.parse(v)
    return Number.isNaN(t) ? null : t
  }
  return null
}

// Scan sample rows (arrays of row objects, one array per panel) for time-like
// values and return the overall min/max timestamp, or null if none found.
export function detectSampleTimeRange(samples: Array<unknown[] | undefined>): { min: number; max: number } | null {
  let min = Infinity, max = -Infinity
  for (const rows of samples) {
    if (!Array.isArray(rows)) continue
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue
      for (const v of Object.values(row as Record<string, unknown>)) {
        const t = valueToTs(v)
        if (t === null) continue
        if (t < min) min = t
        if (t > max) max = t
      }
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null
  return { min, max }
}

// Choose the smallest standard window that still includes the oldest data point,
// so everything shows. Recent data → a tight window; old data → a wide one or
// "all". Returns a window token the executor + DashboardView understand, or null
// to leave the default ("today") when there's no detectable time data.
const DAY = 24 * 60 * 60 * 1000
export function suggestDefaultWindow(range: { min: number; max: number } | null, nowMs: number): string | null {
  if (!range) return null
  const age = nowMs - range.min      // how far back the oldest point is
  if (age <= 1 * DAY) return '24h'
  if (age <= 7 * DAY) return '7d'
  if (age <= 30 * DAY) return '30d'
  if (age <= 90 * DAY) return '90d'
  if (age <= 365 * DAY) return '1y'
  return 'all'
}

export interface PlanValidation {
  ok: boolean
  errors: string[]                               // plan-level problems
  panels: Array<{ index: number; ok: boolean; errors: string[] }>
}

export function validatePlan(plan: Partial<DashboardPlan> | null | undefined): PlanValidation {
  const errors: string[] = []
  if (!plan || typeof plan !== 'object') return { ok: false, errors: ['plan is not an object'], panels: [] }
  if (!plan.title || !String(plan.title).trim()) errors.push('missing dashboard title')
  const panels = Array.isArray(plan.panels) ? plan.panels : []
  if (panels.length === 0) errors.push('plan has no panels')
  if (panels.length > MAX_PANELS) errors.push(`too many panels (${panels.length}); max ${MAX_PANELS}`)
  const panelResults = panels.slice(0, MAX_PANELS).map((p, index) => {
    const r = validatePanelShape(p)
    return { index, ok: r.ok, errors: r.errors }
  })
  const allPanelsOk = panelResults.every(p => p.ok)
  return { ok: errors.length === 0 && allPanelsOk && panels.length > 0, errors, panels: panelResults }
}
