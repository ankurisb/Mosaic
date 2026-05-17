import { NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { renderHtmlToPdf, htmlShell } from '@/lib/pdf-renderer'
import Anthropic from '@anthropic-ai/sdk'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
export const runtime = 'nodejs'

const REPORTS_DIR = join(process.cwd(), 'data', 'reports')

// ── Types ─────────────────────────────────────────────────────────────────────

interface Section {
  id: string
  type: 'kpi' | 'table' | 'chart' | 'ai_narrative' | 'text'
  title: string
  source_type: 'database' | 'api' | 'none'
  source_id: string
  query: string
  ai_prompt: string
  content: string
  chart_type?: string
}

type Row = Record<string, unknown>

// ── Query executor ────────────────────────────────────────────────────────────

async function executeSection(section: Section): Promise<{ rows: Row[]; error?: string }> {
  if (section.source_type === 'none' || !section.source_id || !section.query) {
    return { rows: [] }
  }

  try {
    if (section.source_type === 'database') {
      // Reuse the same DB execution path as the chat tools
      const { runTool } = await import('@/lib/tools')
      const result = await runTool('query_database', {
        connection_id: section.source_id,
        sql: section.query,
      }) as { rows?: Row[]; error?: string }
      return { rows: result.rows || [], error: result.error }
    }

    if (section.source_type === 'api') {
      // Call the API connection via existing api-runner
      const sql = getDb()
      const [svc] = await sql`SELECT * FROM api_services WHERE id = ${section.source_id}`
      if (!svc) return { rows: [], error: 'API service not found' }

      const { applyAuth } = await import('@/lib/api-auth')
      const base = String(svc.base_url).replace(/\/$/, '')
      const path = section.query.startsWith('/') ? section.query : `/${section.query}`
      const headers: Record<string, string> = { 'Accept': 'application/json' }
      await applyAuth(svc as Record<string, unknown>, headers)

      const res = await fetch(`${base}${path}`, { headers, signal: AbortSignal.timeout(15000) })
      if (!res.ok) return { rows: [], error: `HTTP ${res.status}` }
      const data = await res.json()

      // Flatten to rows — handle OData, arrays, single objects
      const raw = data?.value ?? data?.results ?? data?.data ?? data
      const rows: Row[] = Array.isArray(raw) ? raw.slice(0, 200) : [raw]
      return { rows }
    }
  } catch (e) {
    return { rows: [], error: (e as Error).message }
  }
  return { rows: [] }
}

// ── AI narrative generator ────────────────────────────────────────────────────

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

// ── HTML renderers per section type ──────────────────────────────────────────

function renderKpi(section: Section, rows: Row[]): string {
  if (!rows.length) return `<div class="insight">No data returned for this section.</div>`
  // First row as KPI cards — each column = one metric
  const first = rows[0]
  const cards = Object.entries(first).map(([k, v]) => `
    <div class="kpi">
      <div class="kpi-label">${k.replace(/_/g, ' ')}</div>
      <div class="kpi-value">${v ?? '—'}</div>
    </div>`).join('')
  return `<div class="kpi-grid">${cards}</div>`
}

function renderTable(section: Section, rows: Row[]): string {
  if (!rows.length) return `<div class="insight">No data returned for this section.</div>`
  const cols = Object.keys(rows[0])
  const thead = `<tr>${cols.map(c => `<th>${c.replace(/_/g, ' ')}</th>`).join('')}</tr>`
  const tbody = rows.slice(0, 100).map(r =>
    `<tr>${cols.map(c => `<td>${r[c] ?? '—'}</td>`).join('')}</tr>`
  ).join('')
  return `<table><thead>${thead}</thead><tbody>${tbody}</tbody></table>`
}

function renderChart(section: Section, rows: Row[]): string {
  if (!rows.length) return `<div class="insight">No data returned for this section.</div>`
  // Render a simple ASCII-style bar representation in HTML
  // (Full chart rendering would require Chart.js in puppeteer — simplified for now)
  const cols = Object.keys(rows[0])
  const labelCol = cols[0]
  const valueCol = cols[1] || cols[0]
  const max = Math.max(...rows.map(r => Number(r[valueCol]) || 0))

  const bars = rows.slice(0, 20).map(r => {
    const val = Number(r[valueCol]) || 0
    const pct = max > 0 ? Math.round((val / max) * 100) : 0
    return `
      <tr>
        <td style="width:160px;font-size:11px;padding:3px 8px 3px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px">${r[labelCol] ?? ''}</td>
        <td style="padding:3px 0">
          <div style="height:16px;background:#2563eb;border-radius:3px;width:${pct}%;min-width:2px"></div>
        </td>
        <td style="width:60px;font-size:11px;padding:3px 0 3px 8px;text-align:right">${val}</td>
      </tr>`
  }).join('')

  return `
    <table style="width:100%;border-collapse:collapse">
      <tbody>${bars}</tbody>
    </table>
    <div style="font-size:10px;color:#888;margin-top:8px">${valueCol.replace(/_/g, ' ')} by ${labelCol.replace(/_/g, ' ')}</div>`
}

function renderNarrative(_section: Section, text: string): string {
  return text.split('\n\n').filter(Boolean)
    .map(p => `<p style="margin:0 0 10px 0;line-height:1.65">${p}</p>`).join('')
}

function renderText(section: Section): string {
  return `<div style="line-height:1.65">${section.content}</div>`
}

// ── Section HTML assembler ────────────────────────────────────────────────────

async function renderSectionHtml(section: Section): Promise<string> {
  const title = section.title
    ? `<div class="section-title">${section.title}</div>`
    : ''

  if (section.type === 'text') {
    return `<div class="section">${title}${renderText(section)}</div>`
  }

  const { rows, error } = await executeSection(section)

  if (error) {
    return `<div class="section">${title}<div class="insight" style="color:#dc2626">⚠ Query error: ${error}</div></div>`
  }

  let body = ''
  switch (section.type) {
    case 'kpi':          body = renderKpi(section, rows); break
    case 'table':        body = renderTable(section, rows); break
    case 'chart':        body = renderChart(section, rows); break
    case 'ai_narrative': {
      const text = section.ai_prompt
        ? await generateNarrative(section.ai_prompt, rows)
        : `${rows.length} rows returned.`
      body = renderNarrative(section, text)
      break
    }
  }

  return `<div class="section">${title}${body}</div>`
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || session.role !== 'admin') {
    return Response.json({ error: 'Admin required' }, { status: 403 })
  }

  const { template_id } = await req.json()
  if (!template_id) return Response.json({ error: 'template_id required' }, { status: 400 })

  const sql = getDb()
  const [template] = await sql`SELECT * FROM report_templates WHERE id = ${template_id}`
  if (!template) return Response.json({ error: 'Template not found' }, { status: 404 })

  const t = template as Record<string, unknown>
  const name = String(t.name)
  const type = String(t.type || 'operational')
  const now = new Date()

  // Parse sections
  let sections: Section[] = []
  try { sections = JSON.parse(String(t.sections || '[]')) } catch { sections = [] }

  // Record instance as 'running'
  const [instance] = await sql`
    INSERT INTO report_instances (name, type, trigger, template_id, triggered_by, status, generated_at)
    VALUES (${name}, ${type}, 'manual', ${template_id}, ${session.id}, 'running', datetime('now'))
    RETURNING *`
  const instanceId = (instance as Record<string, unknown>).id

  try {
    // Render all sections (in parallel where possible)
    const sectionHtmls = await Promise.all(sections.map(renderSectionHtml))

    // Add cover/header section
    const coverHtml = `
      <div class="section" style="border-left:4px solid #2563eb;padding-left:20px;margin-bottom:28px">
        <div style="font-size:22px;font-weight:700;margin-bottom:6px">${name}</div>
        <div style="font-size:13px;color:#555;display:flex;gap:16px;flex-wrap:wrap">
          <span>Type: <b>${type}</b></span>
          <span>Generated: <b>${now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</b></span>
          ${t.description ? `<span>${t.description}</span>` : ''}
        </div>
      </div>`

    const body = coverHtml + sectionHtmls.join('')
    const html = htmlShell(name, body, `${type.charAt(0).toUpperCase() + type.slice(1)} Report · ${now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`)
    const pdfBuffer = await renderHtmlToPdf(html)

    // Write PDF to disk
    await mkdir(REPORTS_DIR, { recursive: true })
    const filename = `report-${instanceId}.pdf`
    const pdfPath  = join(REPORTS_DIR, filename)
    await writeFile(pdfPath, pdfBuffer)

    // Update instance to completed
    await sql`
      UPDATE report_instances
      SET status = 'completed', pdf_size = ${pdfBuffer.length}, page_count = 1, pdf_path = ${pdfPath}
      WHERE id = ${instanceId}`

    return Response.json({
      ok: true,
      instance_id: instanceId,
      pdf_size: pdfBuffer.length,
      sections_rendered: sections.length,
      message: `Report "${name}" generated successfully`,
    })
  } catch (e) {
    console.error('Report generation error:', e)
    await sql`
      UPDATE report_instances
      SET status = 'failed', error = ${(e as Error).message}
      WHERE id = ${instanceId}`
    return Response.json({ error: (e as Error).message }, { status: 500 })
  }
}
