import { getSession } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { runTool } from '@/lib/tools'
import { substituteTimeWindow, substituteTimeWindowApi, parsePrismQuery, applyPrismWindow, prismSeriesToRows } from '@/lib/dashboard-plan'
import { fetchApiRows } from '@/lib/api-paginate'
import { capPanelRows, extractRows } from '@/lib/dashboard-rows'
import { getSemanticModel, applySemanticModel, planRollup, type SemanticModel } from '@/lib/semantic-model'
import { rollupByGrain } from '@/lib/semantic-rollup'
import { windowResponsive, validateChartShape, buildLineage } from '@/lib/panel-contract'
import { planCubeRouting, loadViaCube } from '@/lib/cube-client'
import { getStoredFingerprint } from '@/lib/semantic-drift'
import { clampGrain } from '@/lib/dashboard-grain'
import { hasEntityPlaceholder, prismNeedsEntity, substituteEntityQuery, applyPrismEntity, tagEntityRows, mergeEntityRows, parseEntitySelection, SERIES_KEY } from '@/lib/dashboard-entity'
export const runtime = 'nodejs'

// Row policy for dashboard panels (see lib/dashboard-rows). Dashboards fetch more
// than the chat default (200) so multi-point charts aren't clipped, then the route
// downsamples time-series and caps tables before anything reaches the browser.
const DASH_SQL_FETCH = 5000       // rows a DB panel may pull (source-side cap)
const DASH_MAX_POINTS = 1000      // time-series points shipped to the client
const DASH_MAX_TABLE_ROWS = 1000  // non-time-series rows shipped to the client

// -- GET /api/dashboards/[id]/data -----------------------------
// Executes all panel queries for a dashboard and returns results.
// Called on initial load and by the client auto-refresh timer.
// Time window helpers
function getTimeWindow(tw: string): { time_from: string; time_to: string; interval: string } {
  const now = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  const fmt = (d: Date) => d.toISOString()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  const presets: Record<string, number> = {
    'today': 0, '15m': 15 * 60 * 1000, '1h': 60 * 60 * 1000,
    '6h': 6 * 60 * 60 * 1000, '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000, '30d': 30 * 24 * 60 * 60 * 1000,
    '90d': 90 * 24 * 60 * 60 * 1000, '1y': 365 * 24 * 60 * 60 * 1000,
  }
  const intervalLabels: Record<string, string> = {
    'today': '1 day', '15m': '15 minutes', '1h': '1 hour',
    '6h': '6 hours', '24h': '24 hours', '7d': '7 days', '30d': '30 days',
    '90d': '90 days', '1y': '1 year',
  }
  if (tw === 'today') {
    return { time_from: fmt(today), time_to: fmt(now), interval: '1 day' }
  }
  // "All time": a window wide enough to include any historical or future-dated
  // data, so a dashboard over old data (e.g. imported/demo) is never blank.
  if (tw === 'all') {
    const from = new Date(now.getTime() - 20 * 365 * 24 * 60 * 60 * 1000) // ~20 years back
    const to = new Date(now.getTime() + 24 * 60 * 60 * 1000)             // +1 day
    return { time_from: fmt(from), time_to: fmt(to), interval: '30 days' }
  }
  const ms = presets[tw]
  if (ms) {
    return { time_from: fmt(new Date(now.getTime() - ms)), time_to: fmt(now), interval: intervalLabels[tw] || '1 hour' }
  }
  // Default: today
  return { time_from: fmt(today), time_to: fmt(now), interval: '1 day' }
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })

  const { id } = await params
  const url = new URL(req.url)
  const timeWindow = url.searchParams.get('time_window') || 'today'
  const customFromP = url.searchParams.get('time_from') || ''
  const customToP   = url.searchParams.get('time_to')   || ''
  const { time_from, time_to, interval } = timeWindow === 'custom' && customFromP && customToP
    ? { time_from: customFromP, time_to: customToP, interval: 'custom' }
    : getTimeWindow(timeWindow)
  // Global aggregation grain from the top filter, clamped to what the window allows
  // (a 7-day window must not render 5-minute buckets). windowMs from the resolved range.
  const windowMs = Math.max(1, (Date.parse(time_to) || 0) - (Date.parse(time_from) || 0))
  const grainParam = url.searchParams.get('grain') || ''
  // Selected entities/devices from the dashboard entity filter (empty = none selected).
  const selectedIds = parseEntitySelection(url.searchParams.get('entity'))
  // Effective grain for a panel: the global grain wins when set; else the panel's own
  // chart_config.grain; either way clamped into the window's allowed set.
  const effGrain = (cfg: Record<string, unknown>): string | null =>
    clampGrain(grainParam || (cfg?.grain as string | undefined), windowMs)
  const withGrain = (cfg: Record<string, unknown>): Record<string, unknown> => {
    const g = effGrain(cfg)
    return g ? { ...cfg, grain: g } : cfg
  }
  const sql = getDb()

  // Verify the user can see this dashboard
  const dash = await sql`
    SELECT id, name, refresh_sec, default_time_window
    FROM   dashboards
    WHERE  id = ${id} AND (owner_id = ${session.id} OR is_public = true)`
  if (!dash.length) return Response.json({ error: 'Not found' }, { status: 404 })

  // Load all panels
  const panels = await sql`
    SELECT id, title, subtitle, source_type, source_id,
           query, chart_type, chart_config, refresh_sec,
           col, row, w, h, sort_order
    FROM   dashboard_panels
    WHERE  dashboard_id = ${id}
    ORDER  BY sort_order ASC, row ASC, col ASC`

  // Per-request cache of each source's semantic model (panels often share a source).
  const modelCache = new Map<string, Promise<SemanticModel>>()
  const getModel = (st: string, sid: string): Promise<SemanticModel> => {
    const key = `${st}:${sid}`
    let m = modelCache.get(key)
    if (!m) { m = getSemanticModel(st, sid); modelCache.set(key, m) }
    return m
  }
  // Per-request cache of each DB connection's dialect (for Cube routing eligibility).
  const dialectCache = new Map<string, Promise<string | null>>()
  const getDialect = (sid: string): Promise<string | null> => {
    let d = dialectCache.get(sid)
    if (!d) {
      d = sql`SELECT dialect FROM db_connections WHERE id = ${sid}`
        .then(r => (r[0] as { dialect?: string } | undefined)?.dialect ?? null).catch(() => null)
      dialectCache.set(sid, d)
    }
    return d
  }
  // Cube engine config (Phase 6/8). CUBE_URL unset → routing is never attempted.
  const CUBE_URL = process.env.CUBE_URL || ''
  const CUBE_SECRET = process.env.CUBEJS_API_SECRET || process.env.AUTH_SECRET || ''

  // Execute each panel query in parallel
  const results = await Promise.all(
    panels.map(async (panel) => {
      const p = panel as Record<string, unknown>
      const start = Date.now()
      try {
        const stype = String(p.source_type || 'database')
        const rawQuery = String(p.query || '')
        // Does this panel depend on the entity/device filter? (PRISM params with a
        // placeholder/missing entity_id, or a {{entity_id}} in SQL/API query text.)
        let prismParsed: Record<string, unknown> | null = null
        let needsEntity = false
        if (stype === 'prism') {
          const pr = parsePrismQuery(p.query)
          if (!pr.ok) throw new Error(pr.error)
          prismParsed = pr.params!
          needsEntity = prismNeedsEntity(prismParsed)
        } else {
          needsEntity = hasEntityPlaceholder(rawQuery)
        }

        // Fetch the panel's data for one optional entity id (null → no entity filter).
        type Fetched = { data: unknown; apiSourceCapped: boolean; engine: 'cube' | 'sql' | null; engineReason: string; usedPreAgg: boolean }
        const fetchFor = async (entityId: string | null): Promise<Fetched> => {
          let data: unknown
          let apiSourceCapped = false
          let engine: 'cube' | 'sql' | null = null
          let engineReason = ''
          let usedPreAgg = false
          if (stype === 'database') {
            const cfg0 = withGrain((p.chart_config && typeof p.chart_config === 'object') ? p.chart_config as Record<string, unknown> : {})
            // Cube can't carry an entity WHERE (it builds from measures/dims), so an
            // entity-filtered panel never routes to Cube — it uses SQL, which substitutes.
            if (CUBE_URL && !entityId) {
              const [model0, dialect0] = await Promise.all([
                getModel('database', String(p.source_id || '')),
                getDialect(String(p.source_id || '')),
              ])
              const fpCurrent = !!(await getStoredFingerprint('database', String(p.source_id || '')))
              const plan = planCubeRouting({ cfg: cfg0, model: model0, dialect: dialect0, fingerprintCurrent: fpCurrent, sourceId: String(p.source_id || ''), timeFrom: time_from, timeTo: time_to })
              if (plan.route && plan.cube && plan.query) {
                const res = await loadViaCube(CUBE_URL, CUBE_SECRET, plan.cube, plan.query)
                if (res.ok && !res.fallback) { data = { rows: res.rows }; engine = 'cube'; usedPreAgg = !!res.usedPreAgg }
                else engineReason = res.reason || 'cube-fallback'
              } else { engineReason = plan.reason }
            }
            if (engine !== 'cube') {
              engine = 'sql'
              const base = entityId ? substituteEntityQuery(rawQuery, 'database', entityId) : rawQuery
              const q = substituteTimeWindow(base, { time_from, time_to, interval })
              data = await runTool('query_database', { connection_id: p.source_id, sql: q, max_rows: DASH_SQL_FETCH })
            }
          } else if (stype === 'api') {
            const base = entityId ? substituteEntityQuery(rawQuery, 'api', entityId) : rawQuery
            const apiPath = substituteTimeWindowApi(base, { time_from, time_to, interval })
            const pcRows = await sql`SELECT pagination_style, pagination_limit_param, pagination_cursor_param, pagination_data_path FROM api_connections WHERE id = ${p.source_id}`
            const pc = (pcRows[0] || {}) as Record<string, unknown>
            const page = await fetchApiRows(
              (pth: string) => runTool('call_api', { connection_id: p.source_id, method: 'GET', path: pth }),
              apiPath,
              { style: pc.pagination_style as string | null, limitParam: pc.pagination_limit_param as string | null, cursorParam: pc.pagination_cursor_param as string | null, dataPath: pc.pagination_data_path as string | null },
              DASH_SQL_FETCH,
            )
            apiSourceCapped = page.source_capped
            data = { rows: page.rows }
          } else if (stype === 'file_server') {
            data = await runTool('read_file_server', { server_id: p.source_id, file_hint: rawQuery, ts_strategy: 'auto', max_rows: 500 })
          } else if (stype === 'prism') {
            const base = entityId ? applyPrismEntity(prismParsed!, entityId) : prismParsed!
            const prismParams = applyPrismWindow(base, { time_from, time_to })
            const raw = await runTool('query_prism', { instance_id: p.source_id, ...prismParams })
            if (raw && typeof raw === 'object' && 'error' in (raw as Record<string, unknown>)) throw new Error(String((raw as Record<string, unknown>).error))
            data = { rows: prismSeriesToRows(raw) }
          }
          return { data, apiSourceCapped, engine, engineReason, usedPreAgg }
        }

        // Entity dispatch: no filter → fetch once; one entity → substitute; several →
        // fan out one query per entity and tag rows so the chart draws a series per device.
        let data: unknown
        let apiSourceCapped = false
        let engine: 'cube' | 'sql' | null = null
        let engineReason = ''
        let usedPreAgg = false
        let overlay = false
        if (needsEntity && selectedIds.length === 0) {
          throw new Error('This panel is scoped to a device — pick one or more in the Device filter above.')
        } else if (needsEntity && selectedIds.length > 1) {
          overlay = true; engine = 'sql'
          const parts = await Promise.all(selectedIds.map(async id => tagEntityRows(extractRows((await fetchFor(id)).data), id)))
          data = { rows: mergeEntityRows(parts) }
        } else {
          const r = await fetchFor(needsEntity ? selectedIds[0] : null)
          data = r.data; apiSourceCapped = r.apiSourceCapped; engine = r.engine; engineReason = r.engineReason; usedPreAgg = r.usedPreAgg
        }
        // Uniform row policy (all sources): downsample large time-series, cap large
        // tables, and attach meta so the panel can show what was trimmed. Only touch
        // row-shaped data — text/other shapes (e.g. a file-server document) pass
        // through untouched.
        if (extractRows(data).length) {
          const srcCapped = apiSourceCapped || !!(data && typeof data === 'object' && (data as Record<string, unknown>).truncated)
          const cfgRaw = (p.chart_config && typeof p.chart_config === 'object') ? p.chart_config as Record<string, unknown> : undefined
          // In overlay mode (several entities) force the series key to the per-entity tag so
          // the chart (and the rollup) split one series per device.
          const cfg = overlay ? { ...withGrain(cfgRaw || {}), series: SERIES_KEY } : (cfgRaw ? withGrain(cfgRaw) : undefined)
          // Semantic post-processing FIRST, on full-resolution ordered rows (before
          // downsampling): deterministic cumulative→delta, unit surfacing, unverified
          // flagging — driven by the source's declared semantic model.
          const model = await getModel(String(p.source_type || 'database'), String(p.source_id || ''))
          const sem = applySemanticModel(extractRows(data), model, { chartType: String(p.chart_type || ''), chartConfig: cfg })
          // Optional time-grain rollup (panel asked for chart_config.grain): aggregate
          // the (delta'd) series to the grain by each measure's declared aggregation.
          const applied = [...sem.meta.applied]
          let shaped = sem.rows
          // Cube already aggregated to the requested grain; re-rolling would double-count.
          // Only the SQL path runs the local time-grain rollup.
          if (engine !== 'cube') {
            const rollup = planRollup(model, cfg)
            if (rollup) { shaped = rollupByGrain(shaped, rollup); applied.push(`rollup:${rollup.grain}`) }
          }
          const { rows, meta } = capPanelRows({ rows: shaped }, String(p.chart_type || ''), cfg, {
            maxPoints: DASH_MAX_POINTS, maxRows: DASH_MAX_TABLE_ROWS, sourceCapped: srcCapped,
          })
          // Panel contract: flag a panel that silently ignores the applied window,
          // validate the chart shape, and attach lineage (auditable).
          const windowIgnored = timeWindow !== 'all' && !windowResponsive(String(p.source_type || 'database'), String(p.query || ''))
          const shape = validateChartShape(String(p.chart_type || ''), rows, cfg)
          const lineage = buildLineage({
            sourceType: String(p.source_type || 'database'), sourceId: String(p.source_id || ''),
            window: timeWindow, transforms: applied,
          })
          const semMeta = { units: sem.meta.units, applied, unverified: sem.meta.unverified, window_ignored: windowIgnored, shape_errors: shape.errors, shape_warnings: shape.warnings, lineage, engine: engine || undefined, engine_reason: engine === 'sql' && engineReason ? engineReason : undefined, used_pre_agg: usedPreAgg || undefined, overlay: overlay || undefined, entities: needsEntity ? selectedIds.length : undefined }
          data = { rows, meta: { ...meta, ...semMeta } }
        }
        return {
          panel_id: p.id,
          ok: true,
          data,
          latency_ms: Date.now() - start,
        }
      } catch (err) {
        return {
          panel_id: p.id,
          ok: false,
          error: err instanceof Error ? err.message : 'Query failed',
          latency_ms: Date.now() - start,
        }
      }
    })
  )

  return Response.json({
    dashboard: dash[0],
    panels,
    results,
    fetched_at: new Date().toISOString(),
  })
}
