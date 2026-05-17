import { getSession } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { NextRequest } from 'next/server'
import { renderHtmlToPdf, htmlShell } from '@/lib/pdf-renderer'
export const runtime = 'nodejs'

function severityBadge(s: string) {
  const map: Record<string,string> = { critical:'badge-red', high:'badge-red', medium:'badge-yellow', low:'badge-green' }
  return `<span class="badge ${map[s?.toLowerCase()] || 'badge-blue'}">${s || 'Unknown'}</span>`
}

function renderPareto(r: Record<string,unknown>): string {
  const rows = (r.data as Record<string,unknown>)?.rows as Array<Record<string,unknown>> || []
  if (!rows.length) return ''
  const max = Math.max(...rows.map(x => Number(x.defects || x.value || x.count || 0)))
  const bars = rows.slice(0, 10).map(row => {
    const val = Number(row.defects || row.value || row.count || 0)
    const pct = max > 0 ? Math.round(val / max * 100) : 0
    const vital = row.vital ? 'vital' : ''
    const cat = String(row.cat || row.category || row.name || '')
    return `<div class="bar-row">
      <div class="bar-label" title="${cat}">${cat}</div>
      <div class="bar-track"><div class="bar-fill ${vital}" style="width:${pct}%"></div></div>
      <div class="bar-val">${val.toLocaleString()}</div>
    </div>`
  }).join('')
  return `<div class="section">
    <div class="section-title">Pareto Analysis</div>
    ${r.insight ? `<div class="insight">${r.insight}</div>` : ''}
    ${bars}
  </div>`
}

function renderFishbone(r: Record<string,unknown>): string {
  const data = r.data as Record<string,unknown> || {}
  const problem = String(data.problem || '')
  const categories = data.categories as Array<Record<string,unknown>> || []
  if (!categories.length) return ''
  const cats = categories.map(cat => {
    const causes = (cat.causes as string[] || []).map(c => `<li>${c}</li>`).join('')
    return `<tr><td style="font-weight:600;color:#1e3a5f;width:140px">${cat.name}</td><td><ul style="margin:0;padding-left:16px">${causes}</ul></td></tr>`
  }).join('')
  return `<div class="section">
    <div class="section-title">Fishbone Diagram (Cause & Effect)</div>
    ${r.insight ? `<div class="insight">${r.insight}</div>` : ''}
    <div style="background:#fef2f2;border-left:3px solid #dc2626;padding:10px 14px;border-radius:0 6px 6px 0;margin-bottom:14px;font-weight:600">Problem: ${problem}</div>
    <table><tbody>${cats}</tbody></table>
  </div>`
}

function renderFiveWhys(r: Record<string,unknown>): string {
  const data = r.data as Record<string,unknown> || {}
  const whys = data.whys as Array<Record<string,unknown>> || []
  if (!whys.length) return ''
  const steps = whys.map((w, i) => `<div class="why-step">
    <div class="why-num">${i+1}</div>
    <div class="why-text">
      <div class="why-q">${w.question || `Why #${i+1}?`}</div>
      <div class="why-a">${w.answer || ''}</div>
    </div>
  </div>`).join('')
  const rootCause = data.root_cause as string
  return `<div class="section">
    <div class="section-title">5 Whys Analysis</div>
    ${r.insight ? `<div class="insight">${r.insight}</div>` : ''}
    ${steps}
    ${rootCause ? `<div style="margin-top:14px;background:#f0fdf4;border-left:3px solid #16a34a;padding:10px 14px;border-radius:0 6px 6px 0;font-weight:600">Root Cause: ${rootCause}</div>` : ''}
  </div>`
}

function renderCap(r: Record<string,unknown>): string {
  const data = r.data as Record<string,unknown> || {}
  const actions = data.actions as Array<Record<string,unknown>> || []
  if (!actions.length) return ''
  const rows = actions.map(a => {
    const priority = String(a.priority || '')
    const badge = priority.toLowerCase() === 'high' ? 'badge-red' : priority.toLowerCase() === 'medium' ? 'badge-yellow' : 'badge-green'
    return `<tr>
      <td>${a.n || ''}</td>
      <td>${a.action || ''}</td>
      <td>${a.owner || '—'}</td>
      <td>${a.due || '—'}</td>
      <td><span class="badge ${badge}">${priority}</span></td>
    </tr>`
  }).join('')
  return `<div class="section">
    <div class="section-title">Corrective Action Plan</div>
    ${r.insight ? `<div class="insight">${r.insight}</div>` : ''}
    <table>
      <thead><tr><th>#</th><th>Action</th><th>Owner</th><th>Due Date</th><th>Priority</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`
}

function renderBreakdown(r: Record<string,unknown>): string {
  const data = r.data as Record<string,unknown> || {}
  const rows = data.rows as Array<Record<string,unknown>> || []
  if (!rows.length) return ''
  const headers = Object.keys(rows[0])
  const thead = `<tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr>`
  const tbody = rows.slice(0,20).map(row =>
    `<tr>${headers.map(h => `<td>${row[h] ?? '—'}</td>`).join('')}</tr>`
  ).join('')
  return `<div class="section">
    <div class="section-title">${String(r.title || 'Breakdown')}</div>
    ${r.insight ? `<div class="insight">${r.insight}</div>` : ''}
    <table><thead>${thead}</thead><tbody>${tbody}</tbody></table>
  </div>`
}

function renderGeneric(r: Record<string,unknown>): string {
  if (r.insight) {
    return `<div class="section">
      <div class="section-title">${String(r.title || r.type || 'Analysis')}</div>
      <div class="insight">${r.insight}</div>
    </div>`
  }
  return ''
}

function rcaBlockToHtml(rca: Record<string,unknown>, conversationTitle: string, summary: string): string {
  const renderers = rca.renderers as Array<Record<string,unknown>> || []
  const sections = renderers.map(r => {
    switch (r.type) {
      case 'pareto':    return renderPareto(r)
      case 'fishbone':  return renderFishbone(r)
      case 'five_whys': return renderFiveWhys(r)
      case 'cap':       return renderCap(r)
      case 'breakdown': return renderBreakdown(r)
      default:          return renderGeneric(r)
    }
  }).filter(Boolean).join('')

  const execSummary = summary ? `<div class="section">
    <div class="section-title">Executive Summary</div>
    <p style="font-size:12px;line-height:1.7;color:#374151">${summary}</p>
  </div>` : ''

  return execSummary + sections
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })

  const { conversation_id } = await req.json()
  if (!conversation_id) return Response.json({ error: 'Missing conversation_id' }, { status: 400 })

  const sql = getDb()
  const [conv] = await sql`SELECT * FROM conversations WHERE id = ${conversation_id} AND user_id = ${session.id}`
  if (!conv) return Response.json({ error: 'Not found' }, { status: 404 })

  const msgs = await sql`
    SELECT role, content, rca_block FROM messages
    WHERE conversation_id = ${conversation_id}
    ORDER BY created_at ASC`

  // Find the richest rca_block and the last assistant summary
  let rcaBlock: Record<string,unknown> | null = null
  let summary = ''
  for (const m of msgs as Array<Record<string,unknown>>) {
    if (m.rca_block) {
      try {
        const parsed = typeof m.rca_block === 'string' ? JSON.parse(m.rca_block as string) : m.rca_block
        if (!rcaBlock || (parsed.renderers?.length > (rcaBlock.renderers as unknown[])?.length)) {
          rcaBlock = parsed
        }
      } catch { /* skip */ }
    }
    if (m.role === 'assistant' && m.content) {
      const clean = String(m.content).split('<end_analysis>')[0].trim()
      if (clean.length > summary.length) summary = clean.slice(0, 800)
    }
  }

  if (!rcaBlock) return Response.json({ error: 'No RCA data found in this conversation' }, { status: 400 })

  const title = String((conv as Record<string,unknown>).title || 'RCA Report')
  const body = rcaBlockToHtml(rcaBlock, title, summary)
  const html = htmlShell(title, body, `Root Cause Analysis · ${new Date().toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' })}`)

  const pdfBuffer = await renderHtmlToPdf(html)
  const filename = `RCA_${title.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40)}_${new Date().toISOString().slice(0, 10)}.pdf`

  // Record in report_instances for history/library
  try {
    const convTitle = String((conv as Record<string,unknown>).title || 'RCA Report')
    await sql`
      INSERT INTO report_instances (name, type, trigger, conversation_id, triggered_by, status, pdf_size, generated_at)
      VALUES (${convTitle}, 'rca', 'manual', ${conversation_id}, ${session.id}, 'completed', ${pdfBuffer.length}, datetime('now'))
    `
  } catch { /* non-blocking */ }

  return new Response(new Uint8Array(pdfBuffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
    }
  })
}
