// lib/superset-dashboard.ts
// Programmatic Superset dashboard creation — the "commit" half of the
// LLM-dashboard flow. Given a SQL database already registered in Superset (see
// superset-sync.ts) plus VALIDATED SQL and a chart spec, this builds a virtual
// dataset -> chart -> dashboard and links them.
//
// Design decisions proven by the create-spike:
//  - Virtual datasets are created from the LLM's SQL. Superset validates the SQL
//    on creation (fetches column metadata), so invalid SQL fails here — callers
//    MUST validate/run the SQL through Mosaic's query-runner first.
//  - The SQL should PRE-AGGREGATE (GROUP BY / AVG / COUNT). Result columns are
//    then plain columns, not metrics — which is how the chart configs below
//    reference them. This keeps what the user confirmed (the exact SQL + rows)
//    identical to what renders. No hidden re-aggregation.
//  - Each viz type has a fixed, validated params template; only column/metric
//    names are filled in. Free-form param generation is unreliable across
//    Superset versions, so the LLM chooses the mapping and the template
//    guarantees the structure.

import { getDb } from './db'
import { log } from './logger'

async function setting(key: string, fallback: string): Promise<string> {
  try {
    const sql = getDb()
    const rows = await sql`SELECT value_enc FROM kv_settings WHERE key = ${key}`
    if (rows.length) {
      const { decrypt } = await import('./encrypt')
      const v = decrypt(rows[0].value_enc as string)
      if (v) return v
    }
  } catch { /* fall through */ }
  return fallback
}

async function cfg() {
  return {
    url: (await setting('SUPERSET_URL', process.env.SUPERSET_URL || 'http://localhost:8088')).replace(/\/$/, ''),
    user: await setting('SUPERSET_ADMIN_USER', process.env.SUPERSET_ADMIN_USER || 'admin'),
    pass: await setting('SUPERSET_ADMIN_PASSWORD', process.env.SUPERSET_ADMIN_PASSWORD || ''),
  }
}

interface Auth { url: string; token: string; csrf: string; cookie: string | null }

async function authenticate(): Promise<Auth | null> {
  const { url, user, pass } = await cfg()
  try {
    const login = await fetch(`${url}/api/v1/security/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password: pass, provider: 'db', refresh: true }),
      signal: AbortSignal.timeout(8000),
    })
    if (!login.ok) return null
    const token = (await login.json()).access_token
    if (!token) return null

    const csrfRes = await fetch(`${url}/api/v1/security/csrf_token/`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    })
    if (!csrfRes.ok) return null
    const csrf = (await csrfRes.json()).result
    const setCookies = csrfRes.headers.getSetCookie?.() || []
    const cookie = setCookies.find(c => c.startsWith('session='))?.split(';')[0] ?? null
    return { url, token, csrf, cookie }
  } catch {
    return null
  }
}

async function api(auth: Auth, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${auth.token}`,
    'X-CSRFToken': auth.csrf,
    Referer: auth.url,
  }
  if (auth.cookie) headers.Cookie = auth.cookie
  const res = await fetch(`${auth.url}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  })
  const text = await res.text()
  let json: Record<string, unknown> = {}
  try { json = JSON.parse(text) } catch { json = { raw: text } }
  return { code: res.status, ok: res.ok, json }
}

// ── Chart config templates (one per supported viz type) ───────────────────────
// The LLM supplies `spec`; these produce a valid Superset params object. Column
// names come from the (pre-aggregated) dataset the SQL produced.

export type VizType = 'bar' | 'line' | 'table' | 'donut' | 'kpi' | 'gauge'

export interface ChartSpec {
  vizType: VizType
  dimension?: string        // grouping column (x-axis / category) — bar/line/donut/table
  value?: string            // the value column (already aggregated in SQL)
  columns?: string[]        // for table
  rowLimit?: number
}

const SUPERSET_VIZ: Record<VizType, string> = {
  bar: 'echarts_timeseries_bar',
  line: 'echarts_timeseries_line',
  table: 'table',
  donut: 'pie',
  kpi: 'big_number_total',
  gauge: 'gauge_chart',
}

export interface ChartValidation {
  valid: boolean
  errors: string[]      // block the build
  warnings: string[]    // inform, don't block
}

/**
 * Validate a chart spec against the ACTUAL query result (columns + sample rows),
 * BEFORE anything is pushed to Superset. Catches the class of problems that would
 * otherwise surface as an opaque Superset error or a silently broken chart —
 * unknown columns, dimension==value duplication, non-numeric metrics, wrong result
 * shape — and returns clear, actionable messages tied to the query the user wrote.
 *
 * Pure and side-effect free, so both a live-validate endpoint and create-dashboard
 * can call it.
 */
export function validateChartSpec(
  columns: string[],
  rows: Record<string, unknown>[],
  spec: ChartSpec,
): ChartValidation {
  const errors: string[] = []
  const warnings: string[] = []
  const cols = columns || []
  const list = cols.length ? `Available columns: ${cols.join(', ')}.` : 'The query returned no columns.'

  // Numeric-ness of a column, tri-state: 'yes' | 'no' | 'unknown'. 'unknown' means
  // there were no sample values to judge (e.g. an empty result set) — we must NOT
  // then claim the column is non-numeric, which would falsely block an otherwise-
  // valid query. The empty-result warning below covers that case instead.
  const numericness = (col: string): 'yes' | 'no' | 'unknown' => {
    const vals = (rows || []).map(r => r?.[col]).filter(v => v !== null && v !== undefined && v !== '')
    if (vals.length === 0) return 'unknown'
    return vals.every(v => typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && isFinite(Number(v)))) ? 'yes' : 'no'
  }
  const has = (col?: string | null): boolean => !!col && cols.includes(col)

  // -- Viz type --
  const VALID: VizType[] = ['bar', 'line', 'table', 'donut', 'kpi', 'gauge']
  if (!VALID.includes(spec.vizType)) {
    errors.push(`Unsupported chart type "${spec.vizType}". Use one of: ${VALID.join(', ')}.`)
    return { valid: false, errors, warnings } // nothing else is meaningful
  }

  // -- Result shape --
  if (cols.length === 0) errors.push('The query returned no columns to chart.')
  if ((rows?.length ?? 0) === 0) warnings.push('The query returned no rows, so the chart will be empty.')

  // -- Per-viz field checks --
  if (spec.vizType === 'table') {
    const wanted = spec.columns ?? [spec.dimension, spec.value].filter(Boolean) as string[]
    const missing = wanted.filter(c => !has(c))
    if (wanted.length === 0) warnings.push('No table columns specified — all query columns will be shown.')
    if (missing.length) errors.push(`Table column(s) not in the query result: ${missing.join(', ')}. ${list}`)
  } else if (spec.vizType === 'kpi' || spec.vizType === 'gauge') {
    // Single-number vizzes: need one numeric value.
    if (!spec.value) errors.push(`A ${spec.vizType} chart needs a numeric value column, but none was set. ${list}`)
    else if (!has(spec.value)) errors.push(`Value column "${spec.value}" isn't in the query result. ${list}`)
    else if (numericness(spec.value) === 'no') errors.push(`Value column "${spec.value}" is not numeric — a ${spec.vizType} needs a number.`)
  } else {
    // bar / line / donut: need a dimension (category) + a numeric value.
    if (!spec.dimension) errors.push(`A ${spec.vizType} chart needs a category (dimension) column, but none was set. ${list}`)
    else if (!has(spec.dimension)) errors.push(`Dimension "${spec.dimension}" isn't in the query result. ${list}`)

    if (!spec.value) errors.push(`A ${spec.vizType} chart needs a value column, but none was set. ${list}`)
    else if (!has(spec.value)) errors.push(`Value column "${spec.value}" isn't in the query result. ${list}`)
    else if (numericness(spec.value) === 'no') errors.push(`Value column "${spec.value}" is not numeric — a ${spec.vizType} chart plots a number.`)

    // The exact "Duplicate column/metric labels" trap: dimension and value the same.
    if (spec.dimension && spec.value && spec.dimension === spec.value) {
      errors.push(`The dimension and value are both "${spec.dimension}" — a chart needs a category column and a separate numeric column.`)
    }

    // Soft check: aggregated shape. If a dimension value repeats across rows, the SQL
    // probably isn't grouped, so the chart will double-count.
    if (spec.dimension && has(spec.dimension) && (rows?.length ?? 0) > 1) {
      const seen = new Set<unknown>()
      let dup = false
      for (const r of rows) { const v = r?.[spec.dimension]; if (seen.has(v)) { dup = true; break } seen.add(v) }
      if (dup) warnings.push(`The category "${spec.dimension}" repeats across rows — the query may not be grouped, so values could be double-counted. Consider GROUP BY.`)
    }
  }

  return { valid: errors.length === 0, errors, warnings }
}

function buildParams(dsId: number, spec: ChartSpec, metricName: string): Record<string, unknown> {
  const ds = `${dsId}__table`
  const rowLimit = spec.rowLimit ?? 100
  switch (spec.vizType) {
    case 'bar':
    case 'line':
      // Reference the DEFINED metric (created on the dataset below), not the raw
      // column — echarts bar/line require a metric, and the SQL's pre-aggregated
      // value column is not one until we define it.
      //
      // The dimension goes on x_axis ONLY. The ECharts bar/line vizzes use
      // `groupby` for an additional series breakdown, not the x dimension — putting
      // the dimension in BOTH x_axis and groupby makes Superset request the column
      // twice and fail with "Duplicate column/metric labels". So groupby stays
      // empty here (no series split); x_axis carries the category.
      return { datasource: ds, viz_type: SUPERSET_VIZ[spec.vizType], row_limit: rowLimit,
        metrics: [metricName], groupby: [], x_axis: spec.dimension }
    case 'table':
      // Table shows the raw columns as-is — no metric needed.
      return { datasource: ds, viz_type: 'table', row_limit: rowLimit, query_mode: 'raw',
        columns: spec.columns ?? [spec.dimension, spec.value].filter(Boolean),
        all_columns: spec.columns ?? [spec.dimension, spec.value].filter(Boolean) }
    case 'donut':
      return { datasource: ds, viz_type: 'pie', row_limit: rowLimit, donut: true,
        metric: metricName, groupby: spec.dimension ? [spec.dimension] : [] }
    case 'kpi':
      return { datasource: ds, viz_type: 'big_number_total', metric: metricName }
    case 'gauge':
      return { datasource: ds, viz_type: 'gauge_chart', metric: metricName, groupby: [] }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface CreateDashboardInput {
  supersetDatabaseId: number   // from superset-sync (the registered DB)
  sql: string                  // VALIDATED, pre-aggregated SQL
  datasetName: string          // unique-ish name for the virtual dataset
  chartName: string
  dashboardTitle: string
  chart: ChartSpec
}

export interface CreateDashboardResult {
  ok: boolean
  step?: 'auth' | 'dataset' | 'chart' | 'dashboard' | 'link'
  reason?: string
  datasetId?: number
  chartId?: number
  dashboardId?: number
}

export async function createDashboard(input: CreateDashboardInput): Promise<CreateDashboardResult> {
  const auth = await authenticate()
  if (!auth) return { ok: false, step: 'auth', reason: 'Could not authenticate with Superset' }

  // 1. virtual dataset from the validated SQL
  const ds = await api(auth, 'POST', '/api/v1/dataset/', {
    database: input.supersetDatabaseId,
    table_name: input.datasetName,
    sql: input.sql,
  })
  if (!ds.ok || !ds.json.id) {
    return { ok: false, step: 'dataset', reason: reasonFrom(ds) }
  }
  const datasetId = ds.json.id as number

  // Define a metric on the dataset for the value column. The SQL already
  // aggregated (e.g. AVG(temperature) AS avg_temp), so the column holds one
  // value per group; MAX() is a harmless passthrough that turns it into a
  // Superset metric the aggregate charts (bar/line/donut/kpi/gauge) can
  // reference. Table doesn't need it. Verified: without a defined metric the
  // chart renders "Metric does not exist" / Unexpected error.
  const metricName = input.chart.value ? `${input.chart.value}_m` : 'value_m'
  if (input.chart.vizType !== 'table' && input.chart.value) {
    const put = await api(auth, 'PUT', `/api/v1/dataset/${datasetId}?override_columns=true`, {
      metrics: [{ metric_name: metricName, expression: `MAX(${input.chart.value})`, metric_type: 'max' }],
    })
    if (!put.ok) {
      await api(auth, 'DELETE', `/api/v1/dataset/${datasetId}`).catch(() => {})
      return { ok: false, step: 'dataset', reason: `could not define metric: ${reasonFrom(put)}`, datasetId }
    }
  }

  // 2. chart from the templated params
  const params = buildParams(datasetId, input.chart, metricName)
  const chart = await api(auth, 'POST', '/api/v1/chart/', {
    slice_name: input.chartName,
    viz_type: SUPERSET_VIZ[input.chart.vizType],
    datasource_id: datasetId,
    datasource_type: 'table',
    params: JSON.stringify(params),
  })
  if (!chart.ok || !chart.json.id) {
    // best-effort cleanup of the orphan dataset
    await api(auth, 'DELETE', `/api/v1/dataset/${datasetId}`).catch(() => {})
    return { ok: false, step: 'chart', reason: reasonFrom(chart), datasetId }
  }
  const chartId = chart.json.id as number

  // 3. dashboard
  const dash = await api(auth, 'POST', '/api/v1/dashboard/', {
    dashboard_title: input.dashboardTitle,
    published: true,
  })
  if (!dash.ok || !dash.json.id) {
    return { ok: false, step: 'dashboard', reason: reasonFrom(dash), datasetId, chartId }
  }
  const dashboardId = dash.json.id as number

  // 4. link chart -> dashboard
  const link = await api(auth, 'PUT', `/api/v1/chart/${chartId}`, { dashboards: [dashboardId] })
  if (!link.ok) {
    return { ok: false, step: 'link', reason: reasonFrom(link), datasetId, chartId, dashboardId }
  }

  log.info({ service: 'superset-dashboard' }, `Created dashboard "${input.dashboardTitle}" (id ${dashboardId})`)
  return { ok: true, datasetId, chartId, dashboardId }
}

// ── Multi-chart: add another chart (from another query) to an EXISTING dashboard ──
//
// Superset renders a dashboard from its position_json layout, NOT just from the
// chart<->dashboard link. So to add a chart we must (a) create the dataset+chart,
// then (b) merge a node for it into the dashboard's position_json grid. Charts that
// are linked but missing from position_json are attached-but-invisible.

// Build (or extend) a position_json layout so that `chartIds` render stacked, each
// full-width, in the order given. We regenerate the whole layout from the chart
// list each time — simpler and deterministic than diffing an existing grid, and the
// charts + their order are the source of truth.
function buildPositionJson(chartIds: { id: number; name: string }[]): string {
  const layout: Record<string, unknown> = {
    DASHBOARD_VERSION_KEY: 'v2',
    ROOT_ID: { type: 'ROOT', id: 'ROOT_ID', children: ['GRID_ID'] },
    GRID_ID: { type: 'GRID', id: 'GRID_ID', children: [] as string[], parents: ['ROOT_ID'] },
    HEADER_ID: { id: 'HEADER_ID', type: 'HEADER', meta: { text: '' } },
  }
  const gridChildren: string[] = []
  chartIds.forEach((c, i) => {
    const rowId = `ROW-${i}`
    const chartNodeId = `CHART-${c.id}`
    layout[rowId] = {
      type: 'ROW', id: rowId, children: [chartNodeId], parents: ['ROOT_ID', 'GRID_ID'],
      meta: { background: 'BACKGROUND_TRANSPARENT' },
    }
    layout[chartNodeId] = {
      type: 'CHART', id: chartNodeId, children: [], parents: ['ROOT_ID', 'GRID_ID', rowId],
      meta: { chartId: c.id, sliceName: c.name, width: 12, height: 50, uuid: undefined },
    }
    gridChildren.push(rowId)
  })
  ;(layout.GRID_ID as { children: string[] }).children = gridChildren
  return JSON.stringify(layout)
}

export interface AddChartInput {
  supersetDatabaseId: number
  sql: string
  datasetName: string
  chartName: string
  chart: ChartSpec
  dashboardId: number   // the EXISTING dashboard to add to
}

export async function addChartToDashboard(input: AddChartInput): Promise<CreateDashboardResult> {
  const auth = await authenticate()
  if (!auth) return { ok: false, step: 'auth', reason: 'Could not authenticate with Superset' }

  // 1. dataset + 2. metric + 3. chart — same as createDashboard's build steps.
  const built = await createDatasetAndChart(auth, input)
  if (!built.ok) return built
  const { datasetId, chartId } = built

  // 4. link the new chart to the dashboard.
  const link = await api(auth, 'PUT', `/api/v1/chart/${chartId}`, { dashboards: [input.dashboardId] })
  if (!link.ok) return { ok: false, step: 'link', reason: reasonFrom(link), datasetId, chartId, dashboardId: input.dashboardId }

  // 5. rebuild the dashboard's layout to include ALL its charts (existing + new),
  //    so the new one actually renders.
  const dashRes = await api(auth, 'GET', `/api/v1/dashboard/${input.dashboardId}/charts`)
  const charts = (dashRes.json.result as { id: number; slice_name: string }[] | undefined) || []
  const ordered = charts.map(c => ({ id: c.id, name: c.slice_name }))
  // Ensure the just-created chart is present (the charts endpoint can lag).
  if (!ordered.some(c => c.id === chartId)) ordered.push({ id: chartId!, name: input.chartName })

  const positionJson = buildPositionJson(ordered)
  const put = await api(auth, 'PUT', `/api/v1/dashboard/${input.dashboardId}`, { position_json: positionJson })
  if (!put.ok) return { ok: false, step: 'dashboard', reason: reasonFrom(put), datasetId, chartId, dashboardId: input.dashboardId }

  log.info({ service: 'superset-dashboard' }, `Added chart "${input.chartName}" (id ${chartId}) to dashboard ${input.dashboardId}`)
  return { ok: true, datasetId, chartId, dashboardId: input.dashboardId }
}

// Shared: create the virtual dataset, define its metric, and create the chart.
// Used by both createDashboard and addChartToDashboard.
async function createDatasetAndChart(auth: Auth, input: { supersetDatabaseId: number; sql: string; datasetName: string; chartName: string; chart: ChartSpec }): Promise<CreateDashboardResult> {
  const ds = await api(auth, 'POST', '/api/v1/dataset/', {
    database: input.supersetDatabaseId,
    table_name: input.datasetName,
    sql: input.sql,
  })
  if (!ds.ok || !ds.json.id) return { ok: false, step: 'dataset', reason: reasonFrom(ds) }
  const datasetId = ds.json.id as number

  const metricName = input.chart.value ? `${input.chart.value}_m` : 'value_m'
  if (input.chart.vizType !== 'table' && input.chart.value) {
    const put = await api(auth, 'PUT', `/api/v1/dataset/${datasetId}?override_columns=true`, {
      metrics: [{ metric_name: metricName, expression: `MAX(${input.chart.value})`, metric_type: 'max' }],
    })
    if (!put.ok) {
      await api(auth, 'DELETE', `/api/v1/dataset/${datasetId}`).catch(() => {})
      return { ok: false, step: 'dataset', reason: `could not define metric: ${reasonFrom(put)}`, datasetId }
    }
  }

  const params = buildParams(datasetId, input.chart, metricName)
  const chart = await api(auth, 'POST', '/api/v1/chart/', {
    slice_name: input.chartName,
    viz_type: SUPERSET_VIZ[input.chart.vizType],
    datasource_id: datasetId,
    datasource_type: 'table',
    params: JSON.stringify(params),
  })
  if (!chart.ok || !chart.json.id) {
    await api(auth, 'DELETE', `/api/v1/dataset/${datasetId}`).catch(() => {})
    return { ok: false, step: 'chart', reason: reasonFrom(chart), datasetId }
  }
  return { ok: true, datasetId, chartId: chart.json.id as number }
}

function reasonFrom(r: { code: number; json: Record<string, unknown> }): string {
  const msg = (r.json.message as string) ||
    (Array.isArray(r.json.errors) ? (r.json.errors[0] as { message?: string })?.message : '') ||
    (r.json.raw as string) || ''
  return `Superset ${r.code}: ${String(msg).slice(0, 200)}`
}

/**
 * Resolve the Superset database id for a Mosaic connection by its label
 * (superset-sync names the Superset database after the connection label).
 * Returns null if the connection isn't registered in Superset yet — the caller
 * should then run the sync/backfill first.
 */
export async function resolveDatabaseId(connectionLabel: string): Promise<number | null> {
  const auth = await authenticate()
  if (!auth) return null
  const q = encodeURIComponent(`(filters:!((col:database_name,opr:eq,value:'${connectionLabel.replace(/'/g, "\\'")}')))`)
  const res = await api(auth, 'GET', `/api/v1/database/?q=${q}`)
  if (!res.ok) return null
  const result = res.json.result as { id: number }[] | undefined
  return result?.[0]?.id ?? null
}
