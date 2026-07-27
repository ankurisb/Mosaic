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

function buildParams(dsId: number, spec: ChartSpec): Record<string, unknown> {
  const ds = `${dsId}__table`
  const rowLimit = spec.rowLimit ?? 100
  switch (spec.vizType) {
    case 'bar':
    case 'line':
      return { datasource: ds, viz_type: SUPERSET_VIZ[spec.vizType], row_limit: rowLimit,
        metrics: spec.value ? [spec.value] : [], groupby: spec.dimension ? [spec.dimension] : [], x_axis: spec.dimension }
    case 'table':
      return { datasource: ds, viz_type: 'table', row_limit: rowLimit, query_mode: 'raw',
        columns: spec.columns ?? [spec.dimension, spec.value].filter(Boolean),
        all_columns: spec.columns ?? [spec.dimension, spec.value].filter(Boolean) }
    case 'donut':
      return { datasource: ds, viz_type: 'pie', row_limit: rowLimit, donut: true,
        metric: spec.value, groupby: spec.dimension ? [spec.dimension] : [] }
    case 'kpi':
      return { datasource: ds, viz_type: 'big_number_total', metric: spec.value }
    case 'gauge':
      return { datasource: ds, viz_type: 'gauge_chart', metric: spec.value, groupby: [] }
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

  // 2. chart from the templated params
  const params = buildParams(datasetId, input.chart)
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
