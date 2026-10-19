// lib/dashboard-build.ts
// Server-side orchestration for the chat-native dashboard builder (Phase 1B).
// Takes the model's DashboardPlan, dry-runs every panel read-only with a bounded
// row cap, classifies each result (data/empty/error/invalid), and returns an
// enriched proposal the chat route streams to the UI. Nothing is persisted here —
// the user confirms in the proposal card, which saves via create_dashboard/add_panel.
import { runTool } from './tools'
import {
  validatePanelShape, readonlyGuard, withPreviewLimit, classifyPanelResult,
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

// A generous default preview window so {{time_from}}/{{time_to}} panels run during
// dry-run. The SAVED panel uses the live dashboard time window instead.
function previewWindow() {
  const to = new Date()
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000)
  return { time_from: from.toISOString(), time_to: to.toISOString(), interval: '1 day' }
}
function substituteWindow(sql: string): string {
  const w = previewWindow()
  return sql.replace(/\{\{time_from\}\}/g, w.time_from).replace(/\{\{time_to\}\}/g, w.time_to).replace(/\{\{interval\}\}/g, w.interval)
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
