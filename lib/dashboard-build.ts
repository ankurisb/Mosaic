// lib/dashboard-build.ts
// Server-side orchestration for the chat-native dashboard builder (Phase 1B).
// Takes the model's DashboardPlan, dry-runs every panel read-only with a bounded
// row cap, classifies each result (data/empty/error/invalid), and returns an
// enriched proposal the chat route streams to the UI. Nothing is persisted here —
// the user confirms in the proposal card, which saves via create_dashboard/add_panel.
import { runTool } from './tools'
import { getDb } from './db'
import { extractApiRecords } from './api-dictionary'
import { assessPanelReadiness, assessPlanReadiness, prismUsedRefs, apiUsedRefs } from './dashboard-readiness'
import { hasEntityPlaceholder, prismNeedsEntity, substituteEntityQuery, applyPrismEntity, ENTITY_ID_PH } from './dashboard-entity'
import {
  validatePanelShape, readonlyGuard, withPreviewLimit, classifyPanelResult, substituteTimeWindow, substituteTimeWindowApi,
  parsePrismQuery, applyPrismWindow, prismSeriesToRows, detectSampleTimeRange, suggestDefaultWindow,
  PREVIEW_ROW_CAP, MAX_PANELS, type DashboardPlan, type PanelPlan, type PanelCls,
} from './dashboard-plan'

export interface EnrichedPanel extends PanelPlan {
  validation: { cls: PanelCls | 'invalid'; rows: number; detail?: string; sample?: unknown[]; needsEntity?: boolean }
  readiness?: { ready: boolean; gaps: string[] }   // Phase: readiness gate
}
export interface DashboardProposal {
  title: string
  description?: string
  panels: EnrichedPanel[]
  summary: { data: number; empty: number; error: number; invalid: number; total: number }
  suggested_window?: string    // default time window that covers the data (auto-detected)
  entity?: import('./dashboard-plan').EntityBinding   // Phase 9: device-filter binding to persist on save
  readiness?: import('./dashboard-readiness').PlanReadiness   // readiness gate verdict
}

export type DialectResolver = (sourceType: string, sourceId: string) => string | undefined
export interface BuildCtx { userId: string; userEmail: string; userRole: string; conversationId?: string; allowedSources?: string[] }

// DRY-RUN ONLY: a deliberately WIDE preview window (≈10 years) so a time-filtered
// panel still shows whether it returns data even when the source's data is sparse
// or old — the preview answers "does this panel work and return rows?", not "what
// will the default view show". The SAVED panel always runs under the dashboard's
// own top-right time window instead.
function previewWindow() {
  const to = new Date(Date.now() + 24 * 60 * 60 * 1000)              // +1 day, so "today" data is included
  const from = new Date(Date.now() - 10 * 365 * 24 * 60 * 60 * 1000) // ~10 years back
  return { time_from: from.toISOString(), time_to: to.toISOString(), interval: '1 day' }
}
function substituteWindow(sql: string): string {
  return substituteTimeWindow(sql, previewWindow())
}
// API/OData preview substitution: unquoted ISO (quoted breaks an OData $filter).
function substituteWindowApi(path: string): string {
  return substituteTimeWindowApi(path, previewWindow())
}

// PRISM telemetry is typically recent, and a time-series op with aggregation over
// a 10-year window would bucket mostly-empty ranges and look empty. A recent
// 30-day window reliably answers "does this device+key emit data?" for the preview.
// The SAVED panel still runs under the dashboard's own window.
function prismPreviewWindow() {
  const now = Date.now()
  return { time_from: new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString(), time_to: new Date(now + 60 * 60 * 1000).toISOString() }
}

function sampleRows(result: unknown, cap = 5): unknown[] | undefined {
  const r = result as Record<string, unknown> | null
  const rows = Array.isArray(result) ? result
    : Array.isArray(r?.rows) ? r!.rows as unknown[]
    : Array.isArray(r?.records) ? r!.records as unknown[]
    : Array.isArray(r?.data) ? r!.data as unknown[] : null
  return rows ? rows.slice(0, cap) : undefined
}

// A panel may be entity-templated ({{entity_id}} in SQL/API text, or entity_id missing/
// placeholder in PRISM params). The SAVED query ALWAYS keeps {{entity_id}} so the live
// Device filter can switch devices at view time — we only substitute a real "sample" device
// HERE, for the read-only preview, so the panel is validated against actual data instead of
// being sent the literal placeholder (which e.g. makes PRISM 400 "Invalid UUID: {{entity_id}}").
// No sample device available → we return { needsEntity:true } and DON'T run the query; the
// readiness gate turns that into a "pick a default device" gap (not a query error).
async function dryRunPanel(panel: PanelPlan, dialectOf: DialectResolver, ctx: BuildCtx, sampleEntity?: string): Promise<EnrichedPanel['validation']> {
  // 1. Shape
  const shape = validatePanelShape(panel)
  if (!shape.ok) return { cls: 'invalid', rows: 0, detail: shape.errors.join('; ') }

  const sample = sampleEntity && sampleEntity !== ENTITY_ID_PH ? sampleEntity : undefined

  try {
    if (panel.source_type === 'database') {
      let query = panel.query
      if (hasEntityPlaceholder(query)) {
        if (!sample) return { cls: 'empty', rows: 0, detail: 'awaiting default device', needsEntity: true }
        query = substituteEntityQuery(query, 'database', sample)
      }
      const dialect = dialectOf('database', panel.source_id) || 'postgres'
      const guard = readonlyGuard(query, dialect)
      if (!guard.ok) return { cls: 'error', rows: 0, detail: guard.reason }
      const previewSql = withPreviewLimit(substituteWindow(query), dialect, PREVIEW_ROW_CAP)
      const result = await runTool('query_database', { connection_id: panel.source_id, sql: previewSql }, ctx)
      const cls = classifyPanelResult(result)
      return { ...cls, sample: cls.cls === 'data' ? sampleRows(result) : undefined }
    }
    if (panel.source_type === 'api') {
      let query = panel.query
      if (hasEntityPlaceholder(query)) {
        if (!sample) return { cls: 'empty', rows: 0, detail: 'awaiting default device', needsEntity: true }
        query = substituteEntityQuery(query, 'api', sample)
      }
      const result = await runTool('call_api', { connection_id: panel.source_id, method: 'GET', path: substituteWindowApi(query) }, ctx)
      if (result && typeof result === 'object' && 'error' in (result as Record<string, unknown>)) {
        return { cls: 'error', rows: 0, detail: String((result as Record<string, unknown>).error).slice(0, 300) }
      }
      // Unwrap the API envelope into rows so the verdict reflects real records
      // (not a truthy wrapper) and the sample shown is the records themselves.
      const rows = extractApiRecords(result)
      const cls = classifyPanelResult({ rows })
      return { ...cls, sample: cls.cls === 'data' ? rows.slice(0, 5) : undefined }
    }
    if (panel.source_type === 'file_server') {
      let hint = panel.query
      if (hasEntityPlaceholder(hint)) {
        if (!sample) return { cls: 'empty', rows: 0, detail: 'awaiting default device', needsEntity: true }
        hint = substituteEntityQuery(hint, 'file_server', sample)
      }
      const result = await runTool('read_file_server', { server_id: panel.source_id, file_hint: hint, ts_strategy: 'auto', max_rows: PREVIEW_ROW_CAP }, ctx)
      const cls = classifyPanelResult(result)
      return { ...cls, sample: cls.cls === 'data' ? sampleRows(result) : undefined }
    }
    if (panel.source_type === 'prism') {
      const pr = parsePrismQuery(panel.query)
      if (!pr.ok) return { cls: 'error', rows: 0, detail: pr.error }
      let params = pr.params!
      if (prismNeedsEntity(params)) {
        if (!sample) return { cls: 'empty', rows: 0, detail: 'awaiting default device', needsEntity: true }
        params = applyPrismEntity(params, sample)
      }
      params = applyPrismWindow(params, prismPreviewWindow())
      params.limit = Math.min(Number(params.limit) || PREVIEW_ROW_CAP, PREVIEW_ROW_CAP)
      const raw = await runTool('query_prism', { instance_id: panel.source_id, ...params }, ctx)
      if (raw && typeof raw === 'object' && 'error' in (raw as Record<string, unknown>)) {
        return { cls: 'error', rows: 0, detail: String((raw as Record<string, unknown>).error).slice(0, 300) }
      }
      const rows = prismSeriesToRows(raw)
      const cls = classifyPanelResult({ rows })
      return { ...cls, sample: cls.cls === 'data' ? rows.slice(0, 5) : undefined }
    }
    return { cls: 'invalid', rows: 0, detail: `unsupported source_type ${panel.source_type}` }
  } catch (e) {
    return classifyPanelResult(null, e instanceof Error ? e.message : 'query failed')
  }
}

export async function enrichPlan(plan: DashboardPlan, dialectOf: DialectResolver, ctx: BuildCtx): Promise<DashboardProposal> {
  const panels = (Array.isArray(plan.panels) ? plan.panels : []).slice(0, MAX_PANELS)
  const enriched: EnrichedPanel[] = []
  // Entity-templated panels are previewed against a real "sample" device so they validate
  // against actual data — the plan's default device (the one the user chose / the model
  // resolved). The SAVED query keeps {{entity_id}} either way; this only drives the preview.
  const sampleEntity = (plan.entity?.default || []).find(x => x && x !== ENTITY_ID_PH)
  // Validate in parallel but bounded — reuse the same modest concurrency the route
  // uses for tool fan-out to avoid stampeding a connection pool.
  const CONC = 4
  for (let i = 0; i < panels.length; i += CONC) {
    const batch = panels.slice(i, i + CONC)
    const results = await Promise.all(batch.map(async p => ({ ...p, validation: await dryRunPanel(p, dialectOf, ctx, sampleEntity) })))
    enriched.push(...results)
  }
  const summary = { data: 0, empty: 0, error: 0, invalid: 0, total: enriched.length }
  for (const p of enriched) summary[p.validation.cls as keyof typeof summary]++

  // Readiness gate: known field/key sets per source (from the semantic dictionary) for
  // grounding, computed once per unique source. Best-effort — absent dictionary skips
  // grounding for that source (the dry-run still gates).
  const knownBySource = new Map<string, string[]>()
  const srcIds = [...new Set(enriched.filter(p => p.source_type === 'prism' || p.source_type === 'api').map(p => `${p.source_type}:${p.source_id}`))]
  await Promise.all(srcIds.map(async k => {
    const [st, sid] = k.split(/:(.+)/)
    try {
      const rows = await getDb()`SELECT object_key FROM semantic_descriptions WHERE source_type=${st} AND source_id=${sid}` as Array<{ object_key: string }>
      knownBySource.set(k, rows.map(r => String(r.object_key).replace(/.*\./, '').toLowerCase()))
    } catch { /* no dictionary → skip grounding */ }
  }))
  const hasBinding = !!plan.entity
  for (const p of enriched) {
    let usedRefs: string[] | undefined
    let multiEntity = false
    let hasEntityScope = false
    if (p.source_type === 'prism') {
      multiEntity = true   // PRISM instances are device fleets
      const pr = parsePrismQuery(p.query)
      if (pr.ok) { usedRefs = prismUsedRefs(pr.params!); hasEntityScope = prismNeedsEntity(pr.params!) || hasBinding }
    } else if (p.source_type === 'api') {
      usedRefs = apiUsedRefs(String(p.query || ''))
      multiEntity = hasBinding
      hasEntityScope = hasEntityPlaceholder(String(p.query || '')) || hasBinding
    } else if (p.source_type === 'database') {
      multiEntity = hasBinding
      hasEntityScope = hasEntityPlaceholder(String(p.query || '')) || hasBinding
    }
    p.readiness = assessPanelReadiness({
      sourceType: p.source_type, cls: p.validation.cls, detail: p.validation.detail,
      knownRefs: knownBySource.get(`${p.source_type}:${p.source_id}`), usedRefs,
      multiEntity, hasEntityScope, needsSampleEntity: p.validation.needsEntity,
    })
  }

  // Auto-detect a default time window from the previewed data so the saved
  // dashboard opens populated (e.g. historical data → a wide enough window).
  const range = detectSampleTimeRange(enriched.map(p => p.validation.sample))
  const suggested_window = suggestDefaultWindow(range, Date.now()) ?? undefined
  const readiness = assessPlanReadiness(enriched.map(p => ({ title: p.title, readiness: p.readiness! })))
  return { title: plan.title, description: plan.description, panels: enriched, summary, suggested_window, entity: plan.entity, readiness }
}
