// lib/dashboard-build.ts
// Server-side orchestration for the chat-native dashboard builder (Phase 1B).
// Takes the model's DashboardPlan, dry-runs every panel read-only with a bounded
// row cap, classifies each result (data/empty/error/invalid), and returns an
// enriched proposal the chat route streams to the UI. Nothing is persisted here —
// the user confirms in the proposal card, which saves via create_dashboard/add_panel.
import { runTool } from './tools'
import {
  validatePanelShape, readonlyGuard, withPreviewLimit, classifyPanelResult, substituteTimeWindow,
  parsePrismQuery, applyPrismWindow, prismSeriesToRows,
  PREVIEW_ROW_CAP, MAX_PANELS, type DashboardPlan, type PanelPlan, type PanelCls,
} from './dashboard-plan'

export interface EnrichedPanel extends PanelPlan {
  validation: { cls: PanelCls | 'invalid'; rows: number; detail?: string; sample?: unknown[] }
}
export interface DashboardProposal {
  title: string
  description?: string
  panels: EnrichedPanel[]
  summary: { data: number; empty: number; error: number; invalid: number; total: number }
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

async function dryRunPanel(panel: PanelPlan, dialectOf: DialectResolver, ctx: BuildCtx): Promise<EnrichedPanel['validation']> {
  // 1. Shape
  const shape = validatePanelShape(panel)
  if (!shape.ok) return { cls: 'invalid', rows: 0, detail: shape.errors.join('; ') }

  try {
    if (panel.source_type === 'database') {
      const dialect = dialectOf('database', panel.source_id) || 'postgres'
      const guard = readonlyGuard(panel.query, dialect)
      if (!guard.ok) return { cls: 'error', rows: 0, detail: guard.reason }
      const previewSql = withPreviewLimit(substituteWindow(panel.query), dialect, PREVIEW_ROW_CAP)
      const result = await runTool('query_database', { connection_id: panel.source_id, sql: previewSql }, ctx)
      const cls = classifyPanelResult(result)
      return { ...cls, sample: cls.cls === 'data' ? sampleRows(result) : undefined }
    }
    if (panel.source_type === 'api') {
      const result = await runTool('call_api', { connection_id: panel.source_id, method: 'GET', path: substituteWindow(panel.query) }, ctx)
      const cls = classifyPanelResult(result)
      return { ...cls, sample: cls.cls === 'data' ? sampleRows(result) : undefined }
    }
    if (panel.source_type === 'file_server') {
      const result = await runTool('read_file_server', { server_id: panel.source_id, file_hint: panel.query, ts_strategy: 'auto', max_rows: PREVIEW_ROW_CAP }, ctx)
      const cls = classifyPanelResult(result)
      return { ...cls, sample: cls.cls === 'data' ? sampleRows(result) : undefined }
    }
    if (panel.source_type === 'prism') {
      const pr = parsePrismQuery(panel.query)
      if (!pr.ok) return { cls: 'error', rows: 0, detail: pr.error }
      const params = applyPrismWindow(pr.params!, prismPreviewWindow())
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
  // Validate in parallel but bounded — reuse the same modest concurrency the route
  // uses for tool fan-out to avoid stampeding a connection pool.
  const CONC = 4
  for (let i = 0; i < panels.length; i += CONC) {
    const batch = panels.slice(i, i + CONC)
    const results = await Promise.all(batch.map(async p => ({ ...p, validation: await dryRunPanel(p, dialectOf, ctx) })))
    enriched.push(...results)
  }
  const summary = { data: 0, empty: 0, error: 0, invalid: 0, total: enriched.length }
  for (const p of enriched) summary[p.validation.cls as keyof typeof summary]++
  return { title: plan.title, description: plan.description, panels: enriched, summary }
}
