// lib/report-runner.ts
// Shared report generation logic — used by the API route (manual run)
// and the scheduler (scheduled run). Keeps both paths in sync.

import { getDb }            from './db'
import { nowExpr } from '@/lib/db'
import { renderHtmlToPdf, htmlShell } from './pdf-renderer'
import Anthropic            from '@anthropic-ai/sdk'
import { writeFile, mkdir } from 'fs/promises'
import { join }             from 'path'

export interface ReportSection {
  id: string
  type: 'kpi' | 'table' | 'chart' | 'ai_narrative' | 'text'
  title: string
  source_type: 'database' | 'api' | 'none'
  source_id: string            // db_connection id, or api_connection id (aligned with rules)
  saved_query_id?: string      // DB sections reference a saved query instead of inline SQL
  query: string                // legacy inline SQL / API path (kept for back-compat)
  match_mode?: string
  ai_prompt: string
  content: string
  chart_type?: string
}

type Row = Record<string, unknown>

const REPORTS_DIR = join(process.cwd(), 'data', 'reports')

// ── Query executor ────────────────────────────────────────────────────────────

async function executeSection(section: ReportSection): Promise<{ rows: Row[]; error?: string }> {
  if (section.source_type === 'none' || !section.source_id) {
    return { rows: [] }
  }
  try {
    const { runTool } = await import('./tools')
    const { extractRows } = await import('./condition-eval')
    const sql = getDb()

    if (section.source_type === 'database') {
      // Resolve the section's saved query to SQL (aligned with rules); fall back to
      // legacy inline SQL so pre-migration templates still run.
      let querySql = section.query
      if (section.saved_query_id) {
        const sq = await sql`SELECT query FROM saved_queries WHERE id = ${section.saved_query_id} LIMIT 1` as unknown as { query: string }[]
        if (sq.length) querySql = sq[0].query
      }
      if (!querySql) return { rows: [] }
      const result = await runTool('query_database', {
        connection_id: section.source_id,
        sql: querySql,
      }) as { rows?: Row[]; error?: string }
      return { rows: result.rows || [], error: result.error }
    }

    if (section.source_type === 'api') {
      // Aligned with rules: source_id is an api_connection id (carries its endpoint).
      // Use call_api + robust extractRows (handles OData/wrappers via the connection's
      // pagination_data_path) instead of the old ad-hoc value/results/data peek.
      const [conn] = await sql`SELECT pagination_data_path FROM api_connections WHERE id = ${section.source_id} LIMIT 1` as unknown as { pagination_data_path: string | null }[]
      if (!conn) {
        // Back-compat: an older template may still reference an api_SERVICE + free path.
        const [svc] = await sql`SELECT * FROM api_services WHERE id = ${section.source_id}`
        if (!svc) return { rows: [], error: 'API source not found' }
        const { applyAuth } = await import('./api-auth')
        const base = String(svc.base_url).replace(/\/$/, '')
        const path = section.query.startsWith('/') ? section.query : `/${section.query}`
        const headers: Record<string, string> = { 'Accept': 'application/json' }
        await applyAuth(svc as Record<string, unknown>, headers)
        const res = await fetch(`${base}${path}`, { headers, signal: AbortSignal.timeout(15000) })
        if (!res.ok) return { rows: [], error: `HTTP ${res.status}` }
        return { rows: extractRows(await res.json()).slice(0, 200) }
      }
      const data = await runTool('call_api', {
        connection_id: section.source_id,
        method: 'GET',
        path: (section.query || '').trim(),
      })
      return { rows: extractRows(data, conn.pagination_data_path || undefined).slice(0, 200) }
    }
  } catch (e) {
    return { rows: [], error: (e as Error).message }
  }
  return { rows: [] }
}

// ── AI narrative ──────────────────────────────────────────────────────────────

async function generateNarrative(prompt: string, rows: Row[]): Promise<string> {
  const client = new Anthropic()
  const dataStr = rows.length > 0
    ? `\n\nData (${rows.length} rows):\n${JSON.stringify(rows.slice(0, 50), null, 2)}`
    : '\n\n(No data returned from query)'
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 600,
    messages: [{
      role: 'user',
      content: `${prompt}${dataStr}\n\nRespond with a concise, professional narrative in plain text (no markdown headers, no bullet points). 2–4 paragraphs maximum.`,
    }],
  })
  return (msg.content[0] as { text: string }).text || ''
}

// ── HTML renderers ────────────────────────────────────────────────────────────

function renderKpi(rows: Row[]): string {
  if (!rows.length) return `<div class="insight">No data returned.</div>`
  const cards = Object.entries(rows[0]).map(([k, v]) => `
    <div class="kpi">
      <div class="kpi-label">${k.replace(/_/g, ' ')}</div>
      <div class="kpi-value">${v ?? '—'}</div>
    </div>`).join('')
  return `<div class="kpi-grid">${cards}</div>`
}

function renderTable(rows: Row[]): string {
  if (!rows.length) return `<div class="insight">No data returned.</div>`
  const cols = Object.keys(rows[0])
  const thead = `<tr>${cols.map(c => `<th>${c.replace(/_/g, ' ')}</th>`).join('')}</tr>`
  const tbody = rows.slice(0, 100).map(r =>
    `<tr>${cols.map(c => `<td>${r[c] ?? '—'}</td>`).join('')}</tr>`
  ).join('')
  return `<table><thead>${thead}</thead><tbody>${tbody}</tbody></table>`
}

function renderChart(section: ReportSection, rows: Row[]): string {
  if (!rows.length) return `<div class="insight">No data returned.</div>`
  const cols = Object.keys(rows[0])
  const labelCol = cols[0]
  const valueCol = cols[1] || cols[0]
  const max = Math.max(...rows.map(r => Number(r[valueCol]) || 0))
  const bars = rows.slice(0, 20).map(r => {
    const val = Number(r[valueCol]) || 0
    const pct = max > 0 ? Math.round((val / max) * 100) : 0
    return `<tr>
      <td style="width:160px;font-size:11px;padding:3px 8px 3px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px">${r[labelCol] ?? ''}</td>
      <td style="padding:3px 0"><div style="height:16px;background:#2563eb;border-radius:3px;width:${pct}%;min-width:2px"></div></td>
      <td style="width:60px;font-size:11px;padding:3px 0 3px 8px;text-align:right">${val}</td>
    </tr>`
  }).join('')
  return `<table style="width:100%;border-collapse:collapse"><tbody>${bars}</tbody></table>
    <div style="font-size:10px;color:#888;margin-top:8px">${valueCol.replace(/_/g, ' ')} by ${labelCol.replace(/_/g, ' ')}</div>`
}

function renderNarrativeHtml(text: string): string {
  return text.split('\n\n').filter(Boolean)
    .map(p => `<p style="margin:0 0 10px 0;line-height:1.65">${p}</p>`).join('')
}

async function renderSectionHtml(section: ReportSection): Promise<string> {
  const title = section.title ? `<div class="section-title">${section.title}</div>` : ''
  if (section.type === 'text') {
    return `<div class="section">${title}<div style="line-height:1.65">${section.content}</div></div>`
  }
  const { rows, error } = await executeSection(section)
  if (error) {
    return `<div class="section">${title}<div class="insight" style="color:#dc2626">⚠ Query error: ${error}</div></div>`
  }
  let body = ''
  switch (section.type) {
    case 'kpi':          body = renderKpi(rows); break
    case 'table':        body = renderTable(rows); break
    case 'chart':        body = renderChart(section, rows); break
    case 'ai_narrative': {
      const text = section.ai_prompt
        ? await generateNarrative(section.ai_prompt, rows)
        : `${rows.length} rows returned.`
      body = renderNarrativeHtml(text)
      break
    }
  }
  return `<div class="section">${title}${body}</div>`
}

// ── Main export ───────────────────────────────────────────────────────────────

export interface RunReportResult {
  ok: boolean
  instance_id?: string
  pdf_path?: string
  pdf_buffer?: Buffer
  pdf_size?: number
  sections_rendered?: number
  error?: string
}

export async function runReport(
  templateId: string,
  triggeredBy: string | null,
  trigger: 'manual' | 'scheduled' = 'manual'
): Promise<RunReportResult> {
  const sql = getDb()
  const [template] = await sql`SELECT * FROM report_templates WHERE id = ${templateId}`
  if (!template) return { ok: false, error: 'Template not found' }

  const t = template as Record<string, unknown>
  const name = String(t.name)
  const type = String(t.type || 'operational')
  const now  = new Date()

  let sections: ReportSection[] = []
  try { sections = JSON.parse(String(t.sections || '[]')) } catch { sections = [] }

  // Create instance as 'running'
  const [instance] = await sql`
    INSERT INTO report_instances (name, type, trigger, template_id, triggered_by, status, generated_at)
    VALUES (${name}, ${type}, ${trigger}, ${templateId}, ${triggeredBy}, 'running', ${nowExpr()})
    RETURNING *`
  const instanceId = String((instance as Record<string, unknown>).id)

  try {
    const sectionHtmls = await Promise.all(sections.map(renderSectionHtml))

    const coverHtml = `
      <div class="section" style="border-left:4px solid #2563eb;padding-left:20px;margin-bottom:28px">
        <div style="font-size:22px;font-weight:700;margin-bottom:6px">${name}</div>
        <div style="font-size:13px;color:#555;display:flex;gap:16px;flex-wrap:wrap">
          <span>Type: <b>${type}</b></span>
          <span>Generated: <b>${now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</b></span>
          <span>Trigger: <b>${trigger}</b></span>
          ${t.description ? `<span>${String(t.description)}</span>` : ''}
        </div>
      </div>`

    const body      = coverHtml + sectionHtmls.join('')
    const html      = htmlShell(name, body, `${type.charAt(0).toUpperCase() + type.slice(1)} Report · ${now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`)
    const pdfBuffer = await renderHtmlToPdf(html)

    await mkdir(REPORTS_DIR, { recursive: true })
    const filename = `report-${instanceId}.pdf`
    const pdfPath  = join(REPORTS_DIR, filename)
    await writeFile(pdfPath, pdfBuffer)

    await sql`
      UPDATE report_instances
      SET status = 'completed', pdf_size = ${pdfBuffer.length}, page_count = 1, pdf_path = ${pdfPath}
      WHERE id = ${instanceId}`

    return { ok: true, instance_id: instanceId, pdf_path: pdfPath, pdf_buffer: pdfBuffer, pdf_size: pdfBuffer.length, sections_rendered: sections.length }
  } catch (e) {
    const msg = (e as Error).message
    await sql`UPDATE report_instances SET status = 'failed', error = ${msg} WHERE id = ${instanceId}`
    return { ok: false, instance_id: instanceId, error: msg }
  }
}
