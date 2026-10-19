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
export const DASH_CHART_TYPES = ['bar', 'line', 'area', 'table', 'stat', 'donut', 'gauge', 'heatmap', 'boxplot', 'sankey'] as const
export type DashChartType = typeof DASH_CHART_TYPES[number]

export const PANEL_SOURCE_TYPES = ['database', 'api', 'file_server'] as const
export type PanelSourceType = typeof PANEL_SOURCE_TYPES[number]

export interface PanelPlan {
  intent?: string                 // why this panel exists (model's rationale; shown in the card)
  title: string
  subtitle?: string
  source_type: PanelSourceType
  source_id: string
  query: string                   // SQL (database), path (api), or hint (file_server)
  chart_type: DashChartType
  chart_config?: Record<string, unknown>
  suggested_grid?: { col: number; row: number; w: number; h: number }
  confidence?: number             // 0..1, model's own confidence
}

export interface DashboardPlan {
  title: string
  description?: string
  panels: PanelPlan[]
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
  return { ok: errors.length === 0, errors }
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
