'use client'
// Dashboard chat dock — the right-side "Edit with AI" panel on a dashboard.
// Talks to /api/chat with dashboard_id set, so the model can add panels (via a
// build_dashboard proposal that is APPENDED here), edit a panel's presentation, or
// remove panels — all scoped to this dashboard. Changes are applied live and the
// parent reloads the grid via onChanged().
import React, { useState, useRef, useEffect } from 'react'

interface ProposalPanel {
  title: string; subtitle?: string; source_type: string; source_id: string; query: string
  chart_type: string; chart_config?: Record<string, unknown>
  validation: { cls: string; rows: number; detail?: string }
  readiness?: { ready: boolean; gaps: string[] }
}
interface Proposal { title: string; panels: ProposalPanel[]; summary: { data: number; empty: number; error: number; invalid: number; total: number }; entity?: unknown; readiness?: { allReady: boolean; readyCount: number; total: number; gaps: { panel: string; gaps: string[] }[] } }
interface Msg { role: 'user' | 'assistant'; content: string; proposal?: Proposal; applied?: boolean }

export default function DashboardChatDock({ dashboardId, onChanged }: { dashboardId: string; onChanged: () => void }) {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState('')      // '' idle | 'thinking' | 'applying'
  const [err, setErr] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }) }, [messages, busy])

  async function send() {
    const text = input.trim()
    if (!text || busy) return
    setErr(''); setInput('')
    const history = [...messages.map(m => ({ role: m.role, content: m.content })), { role: 'user' as const, content: text }]
    setMessages(m => [...m, { role: 'user', content: text }, { role: 'assistant', content: '' }])
    setBusy('thinking')
    try {
      const res = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history, model: 'auto', dashboard_id: dashboardId }),
      })
      if (!res.ok || !res.body) throw new Error(`Request failed (${res.status})`)
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''; let changed = false
      let pendingProposal: Proposal | null = null
      const patchLast = (patch: (m: Msg) => Msg) => setMessages(ms => ms.map((m, i) => i === ms.length - 1 ? patch(m) : m))
      while (true) {
        const { done, value } = await reader.read(); if (done) break
        buf += dec.decode(value, { stream: true })
        const parts = buf.split('\n\n'); buf = parts.pop() || ''
        for (const part of parts) {
          const line = part.split('\n').find(l => l.startsWith('data: ')); if (!line) continue
          let e: Record<string, unknown>; try { e = JSON.parse(line.slice(6)) } catch { continue }
          if (e.type === 'text' && typeof e.text === 'string') patchLast(m => ({ ...m, content: m.content + (e.text as string) }))
          else if (e.type === 'dashboard_proposal' && e.proposal) { pendingProposal = e.proposal as Proposal; patchLast(m => ({ ...m, proposal: e.proposal as Proposal })) }
          else if (e.type === 'dashboard_changed') changed = true
          else if (e.type === 'error') setErr(String(e.message || e.error || 'error'))
        }
      }
      if (changed) onChanged()
      // Auto-add proposed panels straight to the dashboard (they're trivially
      // deletable), so the user sees the real panels instead of a confirm step.
      // Readiness gate: only auto-add when every panel is ready. If not, leave the
      // proposal unapplied — the assistant's message interrogates the user to close the
      // gaps, and nothing is written until a rebuild passes.
      // On failure the proposal card still renders its manual "Add" button.
      if (pendingProposal && (!pendingProposal.readiness || pendingProposal.readiness.allReady)) {
        setBusy('applying')
        try {
          await applyPanels(pendingProposal)
          patchLast(m => ({ ...m, applied: true }))
          onChanged()
        } catch (e) { setErr(e instanceof Error ? e.message : 'Could not add panels') }
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Something went wrong')
      patchLastSafe()
    } finally { setBusy('') }
  }
  function patchLastSafe() { setMessages(ms => ms.map((m, i) => i === ms.length - 1 && m.role === 'assistant' && !m.content && !m.proposal ? { ...m, content: '(no response)' } : m)) }

  // Append a proposal's addable panels to THIS dashboard (additive). Throws on the
  // first failure. Used by the auto-add after a proposal streams in, and by the
  // manual fallback button.
  async function applyPanels(proposal: Proposal) {
    // Only add panels that passed the readiness gate (fall back to the executability
    // class when a panel has no readiness verdict, e.g. an older build).
    const chosen = proposal.panels.filter(p => p.readiness ? p.readiness.ready : (p.validation.cls === 'data' || p.validation.cls === 'empty'))
    if (!chosen.length) throw new Error('No addable panels (all errored)')
    let order = 1000 + Math.floor(Date.now() / 1000) % 1000
    for (let i = 0; i < chosen.length; i++) {
      const p = chosen[i]
      const r = await fetch('/api/dashboards', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add_panel', dashboard_id: dashboardId, title: p.title, subtitle: p.subtitle || '',
          source_type: p.source_type, source_id: p.source_id, query: p.query, chart_type: p.chart_type,
          chart_config: p.chart_config || {}, col: (i % 2) * 6, row: 500 + i, w: 6, h: 1, sort_order: order + i,
        }),
      })
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || `Failed to add "${p.title}"`) }
    }
    // Phase 9: if the builder bound a device/entity filter, persist it so the dashboard
    // shows the Device control and panels using {{entity_id}} resolve.
    const ent = (proposal as { entity?: unknown }).entity
    if (ent && typeof ent === 'object') {
      await fetch('/api/dashboards', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_entity_config', id: dashboardId, entity_config: ent }),
      }).catch(() => {})
    }
  }

  // Manual fallback (only shown if the auto-add failed): add a proposal's panels.
  async function addPanels(idx: number, proposal: Proposal) {
    if (busy) return
    setBusy('applying'); setErr('')
    try {
      await applyPanels(proposal)
      setMessages(ms => ms.map((m, i) => i === idx ? { ...m, applied: true } : m))
      onChanged()
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not add panels') }
    finally { setBusy('') }
  }

  const clsColor = (cls: string) => cls === 'data' ? 'var(--green-t, #1f8a52)' : cls === 'empty' ? 'var(--amber-t, #b4690e)' : 'var(--red-t, #dc2626)'

  return (
    <div style={{ flex: 1, minHeight: 0, background: 'var(--surface)', display: 'flex', flexDirection: 'column' }}>
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {messages.length === 0 && (
          <div style={{ fontSize: 12.5, color: 'var(--text3)', lineHeight: 1.6 }}>
            Evolve this dashboard in plain language. Try:
            <ul style={{ margin: '8px 0 0', paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 5 }}>
              <li>“Add a panel showing downtime by reason”</li>
              <li>“Change the OEE panel to a bar chart”</li>
              <li>“Remove the status-mix panel”</li>
              <li>“What does the defect-rate panel show?”</li>
            </ul>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '92%' }}>
            <div style={{ fontSize: 12.5, lineHeight: 1.5, whiteSpace: 'pre-wrap', color: m.role === 'user' ? 'var(--accent-fg)' : 'var(--text)', background: m.role === 'user' ? 'var(--accent-bg)' : 'var(--bg3)', padding: '8px 11px', borderRadius: 10 }}>
              {m.content || (m.role === 'assistant' && busy === 'thinking' && i === messages.length - 1 ? '…' : m.content)}
            </div>
            {m.proposal && (
              <div style={{ marginTop: 8, border: '1px solid var(--border2)', borderRadius: 10, padding: 10, background: 'var(--bg)' }}>
                {(() => { const notReady = m.proposal.readiness && !m.proposal.readiness.allReady; return (<>
                <div style={{ fontSize: 11, fontWeight: 600, color: notReady ? 'var(--amber-t, #b4690e)' : 'var(--text2)', marginBottom: 6 }}>
                  {m.applied ? 'Added to dashboard ✓' : notReady ? `Needs info — ${m.proposal.readiness!.readyCount}/${m.proposal.readiness!.total} panels ready` : `Proposed ${m.proposal.panels.length} panel(s)`}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: m.applied ? 0 : 8 }}>
                  {m.proposal.panels.map((p, j) => (
                    <div key={j}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5 }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: p.readiness && !p.readiness.ready ? 'var(--amber-t, #b4690e)' : clsColor(p.validation.cls), flexShrink: 0 }} />
                        <span style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</span>
                        <span style={{ color: 'var(--text4)', marginLeft: 'auto', flexShrink: 0 }}>{p.chart_type} · {p.validation.cls === 'data' ? `${p.validation.rows} rows` : p.validation.cls}</span>
                      </div>
                      {p.readiness && !p.readiness.ready && <div style={{ fontSize: 10.5, color: 'var(--amber-t, #b4690e)', marginLeft: 12, marginTop: 1 }}>{p.readiness.gaps.join('; ')}</div>}
                    </div>
                  ))}
                </div>
                {!m.applied && notReady && <div style={{ fontSize: 11, color: 'var(--text3)' }}>Not created yet — answer the question above so Mosaic can build these correctly.</div>}
                {!m.applied && !notReady && (
                  <button onClick={() => addPanels(i, m.proposal!)} disabled={!!busy}
                    style={{ padding: '6px 12px', background: 'var(--accent-bg)', color: 'var(--accent-fg)', border: 'none', borderRadius: 'var(--radius-pill)', fontSize: 11.5, fontWeight: 600, cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', opacity: busy ? 0.6 : 1 }}>
                    {busy === 'applying' ? 'Adding…' : `Add ${m.proposal.panels.filter(p => p.readiness ? p.readiness.ready : (p.validation.cls === 'data' || p.validation.cls === 'empty')).length} to dashboard`}
                  </button>
                )}
                </>) })()}
              </div>
            )}
          </div>
        ))}
        {err && <div style={{ fontSize: 11.5, color: 'var(--red-t, #dc2626)', background: 'var(--red-bg, rgba(220,38,38,.1))', padding: '7px 10px', borderRadius: 8 }}>{err}</div>}
      </div>

      <div style={{ padding: 10, borderTop: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
          <textarea
            value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            placeholder="Ask to add, change, or remove a panel…" rows={2}
            style={{ flex: 1, resize: 'none', padding: '8px 10px', border: '1px solid var(--border2)', borderRadius: 8, background: 'var(--bg)', color: 'var(--text)', fontSize: 12.5, fontFamily: 'inherit', outline: 'none' }} />
          <button onClick={send} disabled={!input.trim() || !!busy}
            style={{ padding: '8px 12px', background: 'var(--accent-bg)', color: 'var(--accent-fg)', border: 'none', borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: input.trim() && !busy ? 'pointer' : 'default', opacity: input.trim() && !busy ? 1 : 0.5, fontFamily: 'inherit', flexShrink: 0 }}>
            {busy === 'thinking' ? '…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}
