// app/api/superset/create-dashboard/route.ts
// Commit step of the LLM-dashboard flow (the second human-in-the-loop gate has
// already passed on the client). Takes a Mosaic connection + VALIDATED SQL + a
// confirmed chart spec, and builds the dataset -> chart -> dashboard in Superset.
//
// This endpoint does NOT generate SQL or run the LLM — the client uses the
// existing /api/query-runner/generate (NL -> SQL) and /api/query-runner
// (execute + confirm rows) for the first gate, then confirms the chart mapping,
// then calls this. So everything here is already user-approved.
import { getSession } from '@/lib/auth'
import { getDb, nowExpr } from '@/lib/db'
import { log } from '@/lib/logger'
import { createDashboard, addChartToDashboard, resolveDatabaseId, validateChartSpec, type ChartSpec, type VizType } from '@/lib/superset-dashboard'

export const runtime = 'nodejs'

const VALID_VIZ = new Set<VizType>(['bar', 'line', 'table', 'donut', 'kpi', 'gauge'])
// Defence in depth: this must only ever build read-only virtual datasets.
const READ_ONLY_SQL = /^\s*(SELECT|WITH)\b/i

export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  if (session.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const { connectionLabel, sql, dashboardTitle, chartName, chart, targetDashboardId } = body as {
    connectionLabel?: string
    sql?: string
    dashboardTitle?: string
    chartName?: string
    chart?: ChartSpec
    targetDashboardId?: number   // when set, ADD this chart to an existing dashboard instead of creating a new one
  }

  // dashboardTitle is required for a new dashboard; when adding to an existing one
  // it's used as the chart name if chartName is omitted.
  if (!connectionLabel || !sql || !chart?.vizType || (!targetDashboardId && !dashboardTitle)) {
    return Response.json({ error: 'connectionLabel, sql, chart.vizType and (dashboardTitle or targetDashboardId) are required' }, { status: 400 })
  }
  if (!VALID_VIZ.has(chart.vizType)) {
    return Response.json({ error: `Unsupported chart type "${chart.vizType}"` }, { status: 400 })
  }
  if (!READ_ONLY_SQL.test(sql)) {
    return Response.json({ error: 'Dashboard SQL must be a read-only SELECT/WITH query' }, { status: 400 })
  }

  // Pre-flight gate: run the query to learn the real result shape and validate the
  // chart spec against it BEFORE touching Superset. Catches unknown columns,
  // dimension==value duplication, non-numeric metrics, etc. — so an invalid spec
  // fails here with a clear message instead of producing a broken Superset dashboard.
  // (The same validateChartSpec powers /api/superset/validate-dashboard for live UI
  // validation; this is the server-side backstop for API/chat callers.)
  try {
    const dbConn = getDb()
    const [c] = await dbConn`SELECT id FROM db_connections WHERE label = ${connectionLabel} LIMIT 1` as unknown as { id: string }[]
    if (c) {
      const internal = `http://127.0.0.1:${process.env.PORT || '3001'}`
      const qr = await fetch(`${internal}/api/query-runner`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: req.headers.get('cookie') || '' },
        body: JSON.stringify({ connectionId: c.id, query: sql, limit: 200 }),
        signal: AbortSignal.timeout(20000),
      })
      const qd = await qr.json()
      if (!qr.ok) {
        return Response.json({ error: `The query didn't run: ${qd.error || `HTTP ${qr.status}`}`, code: 'query_failed' }, { status: 400 })
      }
      const v = validateChartSpec(qd.columns || [], qd.rows || [], chart)
      if (!v.valid) {
        return Response.json({ error: v.errors.join(' '), code: 'invalid_chart_spec', errors: v.errors, warnings: v.warnings }, { status: 400 })
      }
    }
  } catch (e) {
    // Validation is a safety gate, not the feature — if it can't run (e.g. the
    // query-runner is unreachable), log and proceed to the build rather than block.
    log.warn({ service: 'superset-create-dashboard', err: (e as Error).message }, 'pre-flight validation could not run; proceeding to build')
  }

  // Resolve the Superset database for this connection. If it isn't registered,
  // tell the caller to sync first rather than failing obscurely — this is the
  // dependency on superset-sync being run for the connection.
  const dbId = await resolveDatabaseId(connectionLabel)
  if (!dbId) {
    return Response.json({
      error: `"${connectionLabel}" isn't registered in Superset yet. Sync it first (Settings -> re-sync), then retry.`,
      code: 'not_synced',
    }, { status: 409 })
  }

  // Unique-ish names to avoid collisions across repeated builds.
  const stamp = Date.now().toString(36)
  const chartLabel = chartName || dashboardTitle || `Chart ${stamp}`

  // Guard: adding a chart REBUILDS the dashboard's position_json layout. That's safe
  // for dashboards Mosaic created (it owns their simple stacked layout), but would
  // DESTROY a layout the user hand-designed in Superset. So only allow "add to
  // existing" for dashboards Mosaic built (i.e. we have a dashboards row for it).
  if (targetDashboardId) {
    const [owned] = await getDb()`SELECT id FROM dashboards WHERE superset_dashboard_id = ${targetDashboardId} LIMIT 1` as unknown as { id: string }[]
    if (!owned) {
      return Response.json({
        error: 'Mosaic can only add charts to dashboards it created. This dashboard was made in Superset, and adding a chart would overwrite its custom layout — edit it in Superset instead.',
        code: 'not_mosaic_owned',
      }, { status: 409 })
    }
  }

  const result = targetDashboardId
    ? await addChartToDashboard({
        supersetDatabaseId: dbId,
        sql,
        datasetName: `mosaic_${stamp}`,
        chartName: chartLabel,
        chart,
        dashboardId: targetDashboardId,
      })
    : await createDashboard({
        supersetDatabaseId: dbId,
        sql,
        datasetName: `mosaic_${stamp}`,
        chartName: chartLabel,
        dashboardTitle: dashboardTitle!,
        chart,
      })

  if (!result.ok) {
    return Response.json({ error: `Failed at ${result.step}: ${result.reason}`, ...result }, { status: 502 })
  }

  // Persist in Mosaic. A dashboard can hold many charts, so records live in
  // dashboard_charts (one row per chart). For a NEW dashboard we also create the
  // parent dashboards row; for an ADD we find the existing parent and just append a
  // chart row — no phantom duplicate dashboard. Best-effort: bookkeeping failure
  // must not fail the (already successful) build.
  try {
    const sqlDb = getDb()
    let mosaicDashId: string | null = null

    if (targetDashboardId) {
      // Find the Mosaic dashboard that owns this Superset dashboard.
      const [row] = await sqlDb`SELECT id FROM dashboards WHERE superset_dashboard_id = ${targetDashboardId} LIMIT 1` as unknown as { id: string }[]
      mosaicDashId = row?.id ?? null
    } else {
      const inserted = await sqlDb`
        INSERT INTO dashboards
          (name, description, owner_id, source_kind, source_sql, source_connection,
           source_chart_spec, superset_dashboard_id, superset_chart_id, superset_dataset_id)
        VALUES
          (${dashboardTitle}, ${'Built in Superset from a Mosaic query'}, ${session.id},
           ${'superset_query'}, ${sql}, ${connectionLabel},
           ${JSON.stringify(chart)}, ${result.dashboardId ?? null}, ${result.chartId ?? null}, ${result.datasetId ?? null})
        RETURNING id
      ` as unknown as { id: string }[]
      mosaicDashId = inserted[0]?.id ?? null
    }

    if (mosaicDashId) {
      await sqlDb`
        INSERT INTO dashboard_charts
          (dashboard_id, chart_name, source_sql, source_connection, source_chart_spec,
           superset_chart_id, superset_dataset_id)
        VALUES
          (${mosaicDashId}, ${chartLabel}, ${sql}, ${connectionLabel}, ${JSON.stringify(chart)},
           ${result.chartId ?? null}, ${result.datasetId ?? null})
      `
      // Keep the dashboard's updated_at fresh so it sorts to the top after an add.
      await sqlDb`UPDATE dashboards SET updated_at = ${nowExpr()} WHERE id = ${mosaicDashId}`.catch(() => {})
    }
  } catch (e) {
    log.warn({ service: 'superset-create-dashboard', err: (e as Error).message }, 'built dashboard but failed to record it in Mosaic')
  }

  return Response.json(result)
}
