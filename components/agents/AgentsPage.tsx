'use client'
import { useState, useEffect, useCallback } from 'react'
import type { SessionUser } from '@/lib/auth'

// Agents surface. Views: Agents grid, Builder (goal -> AI suggest -> Test run -> Publish),
// Detail (edit + version history/rollback + AI evolve), Run (step log + feedback), and the
// centralised fleet Report. Backed by the real /api/agents* endpoints + headless runner.

interface Agent { id: string; name: string; goal: string; tools: string | string[]; trigger_type: string; status: string; guardrails: string | object; sources?: string | string[]; learnings?: string }
interface RunRow { id: string; agent_name: string; status: string; trigger_source: string; cost_usd: number; stop_reason: string; result: string; started_at: string }
interface Step { type: string; tool?: string; input?: unknown; result?: string; at: string }
interface Version { id: string; version: number; source: string; note: string; created_at: string; goal: string; tools: string | string[] }
interface Guardrails { max_steps: number; max_tool_calls: number; max_minutes: number; max_cost_usd: number; read_only: boolean; approve_writes: boolean; no_progress: boolean }
interface Conn { id: string; label: string; dialect: string }
interface Draft { id?: string; name: string; goal: string; tools: string[]; guardrails: Guardrails; sources: string[]; learnings: string }

// Catalog shown in the builder. w = write/side-effect tool (extra confirmation).
const CATALOG: { id: string; g: string; w?: boolean; se?: boolean }[] = [
  { id: 'check_data_sources', g: 'Data' }, { id: 'query_database', g: 'Data' }, { id: 'query_prism', g: 'Data' },
  { id: 'query_airbyte', g: 'Data' }, { id: 'query_mcp', g: 'Data' }, { id: 'combine_sources', g: 'Data' },
  { id: 'web_search', g: 'Data', se: true }, { id: 'fetch_url', g: 'Data', se: true },
  { id: 'run_statistical_analysis', g: 'Analysis' }, { id: 'render_chart', g: 'Analysis' }, { id: 'deep_diagnose', g: 'Analysis' },
  { id: 'run_code', g: 'Analysis', se: true },
  { id: 'build_dashboard', g: 'Actions', w: true }, { id: 'create_alert', g: 'Actions', w: true }, { id: 'save_memory', g: 'Actions', w: true },
]
const DEFAULT_TOOLS = ['check_data_sources', 'query_database', 'run_statistical_analysis', 'render_chart']
const DEFAULT_GUARDRAILS: Guardrails = { max_steps: 20, max_tool_calls: 40, max_minutes: 10, max_cost_usd: 1.0, read_only: true, approve_writes: true, no_progress: true }
const PAGE = 8

const asArr = (v: string | string[] | undefined): string[] => Array.isArray(v) ? v : (() => { try { return JSON.parse(v || '[]') } catch { return [] } })()
const asObj = <T,>(v: string | object | undefined, d: T): T => (v && typeof v === 'object') ? v as T : (() => { try { return JSON.parse(String(v || '{}')) as T } catch { return d } })()

const card: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, boxShadow: 'var(--shadow)' }
const btn: React.CSSProperties = { border: '1px solid var(--border2)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13, fontWeight: 600, padding: '8px 14px', borderRadius: 9, cursor: 'pointer', fontFamily: 'inherit' }
const btnPri: React.CSSProperties = { ...btn, background: 'var(--accent-bg, #2f6df6)', borderColor: 'transparent', color: 'var(--accent-fg, #fff)' }
const inp: React.CSSProperties = { width: '100%', border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--text)', fontSize: 13.5, padding: '9px 11px', borderRadius: 9, fontFamily: 'inherit', boxSizing: 'border-box' }
const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text3)', marginBottom: 7, display: 'block' }

// Line-art icons (match the app's stroke style; no emoji/sparkles).
const IconImprove = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M2 11l4-4 3 3 5-5" /><path d="M10 5h4v4" /></svg>
)
const IconIdea = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M8 1.75a4 4 0 0 0-2.4 7.2c.46.35.65.7.65 1.1v.2h3.5v-.2c0-.4.2-.75.65-1.1A4 4 0 0 0 8 1.75z" /><path d="M6.6 13h2.8M7.1 14.4h1.8" /></svg>
)
const withIcon = (icon: React.ReactNode, text: string) => (<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{icon}{text}</span>)

function statusPill(s: string | undefined, running?: boolean): React.CSSProperties {
  const ok = s === 'succeeded', pa = s === 'paused_for_approval', rn = running || s === 'running'
  return { fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 99, whiteSpace: 'nowrap',
    background: ok ? 'var(--green-bg,#ecfdf5)' : pa ? 'var(--amber-bg,#fffbeb)' : rn ? 'var(--blue-bg,#eff6ff)' : s === 'stopped' ? 'var(--bg3)' : 'var(--red-bg,#fef2f2)',
    color: ok ? 'var(--green-t,#0a8f5b)' : pa ? 'var(--amber-t,#b45309)' : rn ? 'var(--blue-t,#2563eb)' : s === 'stopped' ? 'var(--text2)' : 'var(--red-t,#dc2626)' }
}

export default function AgentsPage({ user }: { user: SessionUser }) {
  void user
  const [view, setView] = useState<'agents' | 'build' | 'run' | 'report' | 'detail'>('agents')
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [conns, setConns] = useState<Conn[]>([])

  const [run, setRun] = useState<{ agent: string; steps: Step[]; status: string; stop: string; result: string; cost: number; runId?: string } | null>(null)
  const [running, setRunning] = useState(false)
  const [fed, setFed] = useState<number | null>(null)
  const [runs, setRuns] = useState<RunRow[]>([])
  const [stats, setStats] = useState<{ total: number; success_rate: number | null; pending_approval: number; spend_usd: number } | null>(null)

  // Builder / Detail
  const [draft, setDraft] = useState<Draft | null>(null)
  const [suggesting, setSuggesting] = useState(false)
  const [rationale, setRationale] = useState('')
  const [preview, setPreview] = useState<{ status: string; result: string; steps: Step[]; cost: number; evidence?: { data_sources_checked?: unknown; queries?: unknown[]; note?: string } } | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showAdv, setShowAdv] = useState(false)

  const [detail, setDetail] = useState<Agent | null>(null)
  const [versions, setVersions] = useState<Version[]>([])
  const [proposal, setProposal] = useState<{ current: Record<string, unknown>; proposed: Record<string, unknown>; rationale: string; changes: string[] } | null>(null)
  const [evolving, setEvolving] = useState(false)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try { const r = await fetch('/api/agents'); const d = await r.json(); setAgents(d.agents || []) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { fetch('/api/connections').then(r => r.json()).then(d => setConns(d.connections || [])).catch(() => {}) }, [])
  const loadRuns = useCallback(async () => {
    const r = await fetch('/api/agents/runs'); const d = await r.json(); setRuns(d.runs || []); setStats(d.stats || null)
  }, [])
  useEffect(() => { if (view === 'report') loadRuns() }, [view, loadRuns])

  function newDraft() { setDraft({ name: '', goal: '', tools: [...DEFAULT_TOOLS], guardrails: { ...DEFAULT_GUARDRAILS }, sources: [], learnings: '' }); setRationale(''); setPreview(null); setMsg(''); setView('build') }
  function editDraft(a: Agent) { setDraft({ id: a.id, name: a.name, goal: a.goal, tools: asArr(a.tools), guardrails: { ...DEFAULT_GUARDRAILS, ...asObj<Partial<Guardrails>>(a.guardrails, {}) }, sources: asArr(a.sources), learnings: a.learnings || '' }); setRationale(''); setPreview(null); setMsg(''); setView('build') }

  async function runNow(a: Agent) {
    setRunning(true); setFed(null); setView('run'); setRun({ agent: a.name, steps: [], status: 'running', stop: '', result: '', cost: 0 })
    try {
      const r = await fetch(`/api/agents/${a.id}`, { method: 'POST' }); const d = await r.json()
      if (d.run) setRun({ agent: a.name, steps: d.run.steps || [], status: d.run.status, stop: d.run.stop_reason, result: d.run.result, cost: d.run.cost_usd, runId: d.run.run_id })
      else setRun({ agent: a.name, steps: [], status: 'failed', stop: d.error || 'error', result: d.error || 'Run failed', cost: 0 })
    } catch (e) { setRun({ agent: a.name, steps: [], status: 'failed', stop: 'error', result: String(e), cost: 0 }) }
    finally { setRunning(false) }
  }
  async function toggle(a: Agent) {
    await fetch(`/api/agents/${a.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: a.status === 'active' ? 'paused' : 'active' }) }); load()
  }
  async function sendFeedback(rating: number) {
    if (!run?.runId) return; setFed(rating)
    await fetch(`/api/agents/runs/${run.runId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'feedback', rating }) }).catch(() => {})
  }

  async function doSuggest() {
    if (!draft?.goal.trim()) return; setSuggesting(true); setRationale('')
    try {
      const r = await fetch('/api/agents/suggest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ goal: draft.goal }) })
      const d = await r.json()
      if (d.tools) setDraft({ ...draft, tools: d.tools, guardrails: { ...draft.guardrails, ...d.guardrails } })
      setRationale(d.rationale || d.error || '')
    } finally { setSuggesting(false) }
  }
  async function doPreview(d: Draft) {
    setPreviewing(true); setPreview(null)
    try {
      const r = await fetch('/api/agents/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: d.name, goal: d.goal, tools: d.tools, guardrails: d.guardrails, sources: d.sources }) })
      const j = await r.json(); const rn = j.run || {}
      setPreview({ status: rn.status || 'failed', result: rn.result || j.error || '', steps: rn.steps || [], cost: rn.cost_usd || 0, evidence: j.evidence })
    } catch (e) { setPreview({ status: 'failed', result: String(e), steps: [], cost: 0 }) }
    finally { setPreviewing(false) }
  }
  async function publish(d: Draft, evolutionAccepted?: boolean) {
    if (!d.name.trim() || !d.goal.trim()) { setMsg('Name and goal are required.'); return }
    setSaving(true); setMsg('')
    try {
      const body: Record<string, unknown> = { name: d.name, goal: d.goal, tools: d.tools, guardrails: d.guardrails, sources: d.sources, learnings: d.learnings }
      if (evolutionAccepted) body.evolution_source = 'ai-proposed-accepted'
      const url = d.id ? `/api/agents/${d.id}` : '/api/agents'
      const r = await fetch(url, { method: d.id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!r.ok) { const e = await r.json().catch(() => ({})); setMsg(e.error || 'Save failed'); return }
      await load(); setView('agents')
    } finally { setSaving(false) }
  }

  async function openDetail(a: Agent) {
    setDetail(a); setProposal(null); setMsg(''); setView('detail')
    const r = await fetch(`/api/agents/${a.id}/versions`); const d = await r.json(); setVersions(d.versions || [])
  }
  async function rollback(v: number) {
    if (!detail) return; setMsg('')
    const r = await fetch(`/api/agents/${detail.id}/versions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: v }) })
    if (r.ok) { const vr = await fetch(`/api/agents/${detail.id}/versions`); setVersions((await vr.json()).versions || []); await load(); setMsg(`Rolled back to v${v}.`) }
  }
  async function doEvolve() {
    if (!detail) return; setEvolving(true); setProposal(null); setMsg('')
    try {
      const r = await fetch(`/api/agents/${detail.id}/evolve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const d = await r.json()
      if (d.proposed) setProposal({ current: d.current, proposed: d.proposed, rationale: d.rationale || '', changes: d.changes || [] })
      else setMsg(d.error || 'Evolve failed')
    } finally { setEvolving(false) }
  }
  function acceptProposal() {
    if (!detail || !proposal) return
    const p = proposal.proposed
    publish({ id: detail.id, name: detail.name, goal: String(p.goal || ''), tools: (p.tools as string[]) || [], guardrails: { ...DEFAULT_GUARDRAILS, ...(p.guardrails as object) }, sources: (p.sources as string[]) || [], learnings: String(p.learnings || '') }, true)
  }

  const pageCount = Math.max(1, Math.ceil(agents.length / PAGE))
  const pageAgents = agents.slice(page * PAGE, page * PAGE + PAGE)
  const activeN = agents.filter(a => a.status === 'active').length

  const tabStyle = (v: string): React.CSSProperties => ({ border: '1px solid ' + (view === v ? 'var(--border)' : 'transparent'), background: view === v ? 'var(--surface)' : 'transparent', color: view === v ? 'var(--text)' : 'var(--text2)', fontSize: 12.5, fontWeight: 600, padding: '7px 14px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', textTransform: 'capitalize' })

  return (
    <div style={{ padding: '22px max(18px, env(safe-area-inset-left)) 54px', maxWidth: 1160, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22 }}>
        <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 11, width: 'fit-content' }}>
          {(['agents', 'report'] as const).map(v => (<button key={v} onClick={() => setView(v)} style={tabStyle(v)}>{v === 'report' ? 'Report' : 'Agents'}</button>))}
        </div>
        <button style={{ ...btnPri, marginLeft: 'auto' }} onClick={newDraft}>+ New agent</button>
      </div>

      {view === 'agents' && (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--text3)', marginBottom: 12 }}>{agents.length} agents · {activeN} active</div>
          {loading ? <div style={{ color: 'var(--text3)', padding: 30 }}>Loading…</div> : agents.length === 0 ? (
            <div style={{ ...card, padding: 30, color: 'var(--text3)' }}>No agents yet. Click <b>New agent</b> to build one from a plain-English goal.</div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(228px, 1fr))', gap: 14 }}>
                {pageAgents.map(a => (
                  <div key={a.id} style={{ ...card, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                      <div style={{ width: 44, height: 44, borderRadius: 13, background: 'var(--accent-bg, #2f6df6)', display: 'grid', placeItems: 'center', color: 'var(--accent-fg, #fff)', flexShrink: 0 }}>
                        <svg width="22" height="22" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="3" width="11" height="8" rx="1.5"/><path d="M5.5 1.5v1.5M10.5 1.5v1.5M6 13h4"/><circle cx="6" cy="7" r=".8" fill="currentColor" stroke="none"/><circle cx="10" cy="7" r=".8" fill="currentColor" stroke="none"/></svg>
                      </div>
                      <div style={{ fontWeight: 700, fontSize: 15, flex: 1, minWidth: 0 }}>{a.name}</div>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{a.goal}</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 'auto' }}>
                      <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 99, background: a.status === 'active' ? 'var(--green-bg, #ecfdf5)' : 'var(--bg3)', color: a.status === 'active' ? 'var(--green-t, #0a8f5b)' : 'var(--text2)' }}>{a.status === 'active' ? 'Active' : 'Paused'}</span>
                      <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 99, background: 'var(--bg3)', color: 'var(--text2)', textTransform: 'capitalize' }}>{a.trigger_type}</span>
                      {asArr(a.sources).length > 0 && <span title="scoped to specific sources" style={{ fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 99, background: 'var(--bg3)', color: 'var(--text2)' }}>📌 {asArr(a.sources).length} src</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 7 }}>
                      <button style={{ ...btnPri, flex: 1, padding: '6px 10px', fontSize: 12 }} disabled={running || a.status === 'paused'} onClick={() => runNow(a)}>Run now</button>
                      <button style={{ ...btn, padding: '6px 10px', fontSize: 12 }} onClick={() => openDetail(a)}>Manage</button>
                    </div>
                  </div>
                ))}
              </div>
              {pageCount > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, marginTop: 20 }}>
                  <button style={{ ...btn, width: 36, height: 36, padding: 0 }} disabled={page === 0} onClick={() => setPage(p => p - 1)}>‹</button>
                  <span style={{ fontSize: 12.5, color: 'var(--text2)', fontWeight: 600, minWidth: 96, textAlign: 'center' }}>Page {page + 1} of {pageCount}</span>
                  <button style={{ ...btn, width: 36, height: 36, padding: 0 }} disabled={page >= pageCount - 1} onClick={() => setPage(p => p + 1)}>›</button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {view === 'build' && draft && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr)', gap: 16 }}>
          <div style={{ ...card, padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ fontSize: 17, fontWeight: 700 }}>{draft.id ? 'Edit agent' : 'New agent'}</div>
              <button style={{ ...btn, marginLeft: 'auto', padding: '6px 12px', fontSize: 12 }} onClick={() => setView('agents')}>Cancel</button>
            </div>
            <div><label style={lbl}>Name</label><input style={inp} value={draft.name} placeholder="Downtime RCA" onChange={e => setDraft({ ...draft, name: e.target.value })} /></div>
            <div>
              <label style={lbl}>Goal — describe the task in plain English</label>
              <textarea style={{ ...inp, minHeight: 92, resize: 'vertical', lineHeight: 1.5 }} value={draft.goal} placeholder="e.g. Each morning, find the machine with the worst OEE on the previous shift and the most likely reason from the downtime data." onChange={e => setDraft({ ...draft, goal: e.target.value })} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 9 }}>
                <button style={{ ...btn, padding: '7px 13px', fontSize: 12.5 }} disabled={suggesting || !draft.goal.trim()} onClick={doSuggest}>{suggesting ? 'Thinking…' : withIcon(<IconIdea />, 'Suggest config')}</button>
                {rationale && <span style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.4 }}>{rationale}</span>}
              </div>
            </div>

            <div>
              <label style={lbl}>Tools</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                {CATALOG.map(t => {
                  const on = draft.tools.includes(t.id)
                  return (
                    <button key={t.id} onClick={() => setDraft({ ...draft, tools: on ? draft.tools.filter(x => x !== t.id) : [...draft.tools, t.id] })}
                      title={t.w ? 'Write action — needs approval at run time' : t.se ? 'Side-effect tool' : ''}
                      style={{ border: '1px solid ' + (on ? 'transparent' : 'var(--border2)'), background: on ? (t.w ? 'var(--amber-t,#b45309)' : 'var(--accent-bg,#2f6df6)') : 'var(--surface)', color: on ? (t.w ? '#fff' : 'var(--accent-fg,#fff)') : 'var(--text2)', fontSize: 12, fontWeight: 600, padding: '5px 10px', borderRadius: 8, cursor: 'pointer', fontFamily: 'var(--font-mono)' }}>
                      {t.w ? '✎ ' : ''}{t.id}
                    </button>
                  )
                })}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 7 }}>Leave as the defaults and the agent discovers its own data source. ✎ = write action (held for approval).</div>
            </div>

            <div>
              <label style={lbl}>Guardrails (safe stops)</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 10 }}>
                {([['max_steps', 'Max steps'], ['max_tool_calls', 'Max tool calls'], ['max_minutes', 'Max minutes'], ['max_cost_usd', 'Max cost $']] as const).map(([k, l]) => (
                  <div key={k}><label style={{ ...lbl, fontSize: 10, marginBottom: 4 }}>{l}</label><input type="number" step={k === 'max_cost_usd' ? '0.1' : '1'} style={inp} value={draft.guardrails[k]} onChange={e => setDraft({ ...draft, guardrails: { ...draft.guardrails, [k]: Number(e.target.value) } })} /></div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 16, marginTop: 10, flexWrap: 'wrap' }}>
                {([['read_only', 'Read-only'], ['approve_writes', 'Approve writes'], ['no_progress', 'Loop guard']] as const).map(([k, l]) => (
                  <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: 'var(--text2)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={draft.guardrails[k]} onChange={e => setDraft({ ...draft, guardrails: { ...draft.guardrails, [k]: e.target.checked } })} />{l}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label style={lbl}>Data source scope <span style={{ textTransform: 'none', fontWeight: 400, color: 'var(--text3)' }}>— optional; empty = auto-discover</span></label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                {conns.length === 0 ? <span style={{ fontSize: 12, color: 'var(--text3)' }}>No data sources configured.</span> : conns.map(c => {
                  const on = draft.sources.includes(c.id)
                  return <button key={c.id} onClick={() => setDraft({ ...draft, sources: on ? draft.sources.filter(x => x !== c.id) : [...draft.sources, c.id] })} style={{ border: '1px solid ' + (on ? 'transparent' : 'var(--border2)'), background: on ? 'var(--accent-bg,#2f6df6)' : 'var(--surface)', color: on ? 'var(--accent-fg,#fff)' : 'var(--text2)', fontSize: 12, fontWeight: 600, padding: '5px 10px', borderRadius: 8, cursor: 'pointer' }}>{on ? '📌 ' : ''}{c.label}</button>
                })}
              </div>
            </div>

            <div>
              <button style={{ ...btn, padding: '4px 0', border: 'none', background: 'none', color: 'var(--text3)', fontSize: 12, cursor: 'pointer' }} onClick={() => setShowAdv(s => !s)}>{showAdv ? '▾' : '▸'} Learnings (knowledge carried into every run)</button>
              {showAdv && <textarea style={{ ...inp, minHeight: 64, resize: 'vertical', marginTop: 6 }} value={draft.learnings} placeholder="Human-approved notes injected into the prompt, e.g. known-good queries or resolved source names." onChange={e => setDraft({ ...draft, learnings: e.target.value })} />}
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              <button style={btn} disabled={previewing || !draft.goal.trim()} onClick={() => doPreview(draft)}>{previewing ? 'Testing…' : '▶ Test run'}</button>
              <button style={btnPri} disabled={saving} onClick={() => publish(draft)}>{saving ? 'Saving…' : draft.id ? 'Save changes' : 'Publish agent'}</button>
              {msg && <span style={{ fontSize: 12.5, color: 'var(--red-t,#dc2626)' }}>{msg}</span>}
              <span style={{ fontSize: 11.5, color: 'var(--text3)', marginLeft: 'auto' }}>Test run never writes — read-only & side-effect tools excluded.</span>
            </div>
          </div>

          {(previewing || preview) && (
            <div style={card}>
              <div style={{ padding: 16, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>Test run</div>
                <span style={{ marginLeft: 'auto', ...statusPill(preview?.status, previewing) }}>{previewing ? 'Running…' : preview?.status}</span>
              </div>
              {preview?.evidence && (
                <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontSize: 12, color: 'var(--text2)' }}>
                  <div style={{ marginBottom: 4 }}><b>Queries run:</b> {(preview.evidence.queries || []).length}</div>
                  <div style={{ color: 'var(--text3)' }}>{preview.evidence.note}</div>
                </div>
              )}
              <div style={{ background: '#0b0d12', color: '#dfe4ee', fontFamily: 'var(--font-mono)', fontSize: 12.5, lineHeight: 1.55, padding: 16, maxHeight: 360, overflow: 'auto' }}>
                {previewing && <div style={{ color: '#8fb6ff' }}>Running read-only against the live data layer…</div>}
                {(preview?.steps || []).map((s, i) => (
                  <div key={i} style={{ padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
                    <span style={{ color: s.type === 'tool' ? '#8fb6ff' : s.type === 'result' ? '#5fd6a0' : '#c7cdd9' }}>{s.type === 'tool' ? `→ ${s.tool}` : s.type === 'result' ? `✓ ${s.tool || ''}` : '▸'}</span>
                    {s.type === 'tool' && s.input != null && <span style={{ color: '#7f8aa0' }}> {JSON.stringify(s.input).slice(0, 120)}</span>}
                    {s.result && s.type === 'result' && <div style={{ color: '#7f8aa0', marginTop: 2, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{String(s.result).slice(0, 400)}</div>}
                  </div>
                ))}
                {!previewing && preview?.result && <div style={{ marginTop: 10, whiteSpace: 'pre-wrap' }}>{preview.result}</div>}
              </div>
            </div>
          )}
        </div>
      )}

      {view === 'detail' && detail && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button style={btn} onClick={() => setView('agents')}>‹ Back</button>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{detail.name}</div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button style={btnPri} disabled={running || detail.status === 'paused'} onClick={() => runNow(detail)}>Run now</button>
              <button style={btn} onClick={() => editDraft(detail)}>Edit</button>
              <button style={btn} onClick={() => toggle(detail).then(() => setDetail({ ...detail, status: detail.status === 'active' ? 'paused' : 'active' }))}>{detail.status === 'active' ? 'Pause' : 'Resume'}</button>
            </div>
          </div>
          {msg && <div style={{ ...card, padding: '10px 14px', fontSize: 13, color: 'var(--green-t,#0a8f5b)' }}>{msg}</div>}

          <div style={{ ...card, padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>Continuous evolution</div>
              <button style={{ ...btn, marginLeft: 'auto', padding: '6px 12px', fontSize: 12.5 }} disabled={evolving} onClick={doEvolve}>{evolving ? 'Analysing runs…' : withIcon(<IconImprove />, 'Propose improvement')}</button>
            </div>
            {!proposal && <div style={{ fontSize: 12.5, color: 'var(--text3)' }}>Reads recent runs + feedback and proposes a better version. Nothing is applied until you test and accept it.</div>}
            {proposal && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ fontSize: 13, color: 'var(--text2)' }}>{proposal.rationale}</div>
                {proposal.changes.length > 0 && <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.6 }}>{proposal.changes.map((c, i) => <li key={i}>{c}</li>)}</ul>}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {([['Current', proposal.current], ['Proposed', proposal.proposed]] as const).map(([t, cfg]) => (
                    <div key={t} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, background: t === 'Proposed' ? 'var(--blue-bg,#eff6ff)' : 'var(--bg3)' }}>
                      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text3)', marginBottom: 6 }}>{t}</div>
                      <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.5 }}>
                        <div><b>tools:</b> {((cfg.tools as string[]) || []).join(', ')}</div>
                        <div style={{ marginTop: 3 }}><b>guardrails:</b> {JSON.stringify((cfg.guardrails as Record<string, unknown>) || {}).replace(/[{}"]/g, '').slice(0, 120)}</div>
                        {String(cfg.learnings || '') && <div style={{ marginTop: 3 }}><b>learnings:</b> {String(cfg.learnings).slice(0, 140)}</div>}
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button style={btn} onClick={() => doPreview({ id: detail.id, name: detail.name, goal: String(proposal.proposed.goal || ''), tools: (proposal.proposed.tools as string[]) || [], guardrails: { ...DEFAULT_GUARDRAILS, ...(proposal.proposed.guardrails as object) }, sources: (proposal.proposed.sources as string[]) || [], learnings: String(proposal.proposed.learnings || '') })}>▶ Test proposed</button>
                  <button style={btnPri} disabled={saving} onClick={acceptProposal}>{saving ? 'Applying…' : 'Accept as new version'}</button>
                </div>
                {(previewing || preview) && (
                  <div style={{ background: '#0b0d12', color: '#dfe4ee', fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.5, padding: 14, borderRadius: 10, maxHeight: 240, overflow: 'auto' }}>
                    {previewing ? <span style={{ color: '#8fb6ff' }}>Testing proposed config…</span> : <><div style={{ color: preview?.status === 'succeeded' ? '#5fd6a0' : '#f0b760' }}>{preview?.status}</div><div style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{(preview?.result || '').slice(0, 500)}</div></>}
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={card}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', fontSize: 14, fontWeight: 700 }}>Version history</div>
            {versions.length === 0 ? <div style={{ padding: 18, color: 'var(--text3)', fontSize: 13 }}>No versions.</div> : versions.map((v, i) => (
              <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 18px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5, fontWeight: 700, width: 34 }}>v{v.version}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{v.note || '—'}</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>{v.created_at}</div>
                </div>
                <span style={{ fontSize: 10.5, fontWeight: 700, padding: '3px 8px', borderRadius: 99, background: v.source === 'ai-proposed-accepted' ? 'var(--blue-bg,#eff6ff)' : v.source === 'rollback' ? 'var(--amber-bg,#fffbeb)' : 'var(--bg3)', color: v.source === 'ai-proposed-accepted' ? 'var(--blue-t,#2563eb)' : v.source === 'rollback' ? 'var(--amber-t,#b45309)' : 'var(--text2)' }}>{v.source}</span>
                {i !== 0 && <button style={{ ...btn, padding: '5px 10px', fontSize: 12 }} onClick={() => rollback(v.version)}>Roll back</button>}
              </div>
            ))}
          </div>
        </div>
      )}

      {view === 'run' && (
        <div style={card}>
          <div style={{ padding: 18, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{run?.agent || 'Run'}</div>
            <span style={{ marginLeft: 'auto', ...statusPill(run?.status, running) }}>{running ? 'Running…' : run?.status === 'paused_for_approval' ? 'Paused · approval' : run?.status || '—'}{run?.stop && run.status !== 'succeeded' && !running ? ` · ${run.stop}` : ''}</span>
          </div>
          <div style={{ background: '#0b0d12', color: '#dfe4ee', fontFamily: 'var(--font-mono)', fontSize: 12.5, lineHeight: 1.55, padding: 18, maxHeight: 420, overflow: 'auto' }}>
            {running && <div style={{ color: '#8fb6ff' }}>Running the agent against the live data layer…</div>}
            {(run?.steps || []).map((s, i) => (
              <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
                <span style={{ color: s.type === 'tool' ? '#8fb6ff' : s.type === 'result' ? '#5fd6a0' : s.type === 'approval' ? '#f0b760' : '#c7cdd9' }}>{s.type === 'tool' ? `→ ${s.tool}` : s.type === 'approval' ? `⚠ ${s.tool} (held for approval)` : s.type === 'result' ? `✓ ${s.tool || ''}` : '▸'}</span>
                {s.result && <div style={{ color: '#7f8aa0', marginTop: 2, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{String(s.result).slice(0, 600)}</div>}
              </div>
            ))}
            {!running && run?.result && <div style={{ marginTop: 10, color: '#dfe4ee', whiteSpace: 'pre-wrap' }}>{run.result}</div>}
          </div>
          <div style={{ padding: 14, borderTop: '1px solid var(--border)', display: 'flex', gap: 10, alignItems: 'center' }}>
            <button style={btn} onClick={() => setView('agents')}>Back to agents</button>
            {run && !running && run.runId && (
              <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: 'var(--text3)' }}>Was this useful?</span>
                <button style={{ ...btn, padding: '5px 10px', background: fed === 1 ? 'var(--green-bg,#ecfdf5)' : 'var(--surface)' }} onClick={() => sendFeedback(1)}>👍</button>
                <button style={{ ...btn, padding: '5px 10px', background: fed === -1 ? 'var(--red-bg,#fef2f2)' : 'var(--surface)' }} onClick={() => sendFeedback(-1)}>👎</button>
              </span>
            )}
            {run && !running && <span style={{ fontSize: 11.5, color: 'var(--text3)', marginLeft: 'auto' }}>cost ${run.cost.toFixed(2)} · {run.steps.length} steps</span>}
          </div>
        </div>
      )}

      {view === 'report' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(132px, 1fr))', gap: 12, marginBottom: 22 }}>
            {[['Runs', String(stats?.total ?? '—')], ['Success', stats?.success_rate != null ? stats.success_rate + '%' : '—'], ['Pending approval', String(stats?.pending_approval ?? '—')], ['Spend', stats ? '$' + stats.spend_usd.toFixed(2) : '—']].map(([l, v]) => (
              <div key={l} style={{ ...card, padding: '14px 16px' }}>
                <div style={{ fontSize: 23, fontWeight: 700, letterSpacing: '-.02em' }}>{v}</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', marginTop: 2 }}>{l}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--text3)', margin: '0 2px 10px' }}>Recent runs</div>
          <div style={card}>
            {runs.length === 0 ? <div style={{ padding: 24, color: 'var(--text3)' }}>No runs yet — run an agent from the Agents tab.</div> : runs.map(r => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{r.agent_name || 'Agent'}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.stop_reason || r.result?.slice(0, 80)}</div>
                </div>
                <span style={statusPill(r.status)}>{r.status}</span>
                <span style={{ fontSize: 11.5, color: 'var(--text2)', fontFamily: 'var(--font-mono)' }}>${Number(r.cost_usd || 0).toFixed(2)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
