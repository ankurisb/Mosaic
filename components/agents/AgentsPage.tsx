'use client'
import { useState, useEffect, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import AppShell from '@/components/AppShell'
import type { SessionUser } from '@/lib/auth'

// Agents surface. Views: Agents grid, Builder (goal -> AI suggest -> Test run -> Publish),
// Detail (edit + version history/rollback + AI evolve), Run (step log + feedback), and the
// centralised fleet Report. Backed by the real /api/agents* endpoints + headless runner.

interface Agent { id: string; name: string; goal: string; tools: string | string[]; trigger_type: string; status: string; guardrails: string | object; sources?: string | string[]; learnings?: string; schedule?: string | null; execution?: string; max_subagents?: number; event_condition?: string | object | null; custom_tool_ids?: string | string[] }
interface EventDraft { source_id: string; query: string; field: string; op: string; value: string; cooldown_min: number; match_mode: 'first' | 'any' }
const EMPTY_EVENT: EventDraft = { source_id: '', query: '', field: '', op: '<', value: '', cooldown_min: 60, match_mode: 'first' }
function parseEventCondition(raw: unknown): EventDraft {
  const o = (typeof raw === 'string' ? (() => { try { return JSON.parse(raw) } catch { return {} } })() : raw || {}) as Record<string, unknown>
  return {
    source_id: String(o.source_id || ''), query: String(o.query || ''), field: String(o.field || ''),
    op: String(o.op || '<'), value: o.value == null ? '' : String(o.value),
    cooldown_min: Number.isFinite(Number(o.cooldown_sec)) ? Math.round(Number(o.cooldown_sec) / 60) : 60,
    match_mode: o.match_mode === 'any' ? 'any' : 'first',
  }
}
interface RunRow { id: string; agent_name: string; status: string; trigger_source: string; cost_usd: number; stop_reason: string; result: string; started_at: string }
interface EvalRow { id: string; name: string; input?: string | null; expected_contains: string | string[]; expect_status: string; last_passed?: number | null; last_run_at?: string | null }
interface Step { type: string; tool?: string; input?: unknown; result?: string; at: string; sub?: string }
interface LiveSub { id: string; title: string; status: 'queued' | 'running' | 'done'; tool?: string; summary?: string; error?: string }
interface Version { id: string; version: number; source: string; note: string; created_at: string; goal: string; tools: string | string[] }
interface Guardrails { max_steps: number; max_tool_calls: number; max_minutes: number; max_cost_usd: number; read_only: boolean; approve_writes: boolean; no_progress: boolean }
interface Conn { id: string; label: string; dialect: string }
interface CTool { id: string; name: string; description: string; method: string; url_template: string; read_only: number; enabled: number }
interface Draft { id?: string; name: string; goal: string; tools: string[]; guardrails: Guardrails; sources: string[]; learnings: string; trigger_type: string; schedule: string; execution: 'single' | 'orchestrated'; max_subagents: number; event: EventDraft; custom_tool_ids: string[] }

// Friendly schedule <-> cron helpers (5-field cron; times are server-local).
function cronFrom(freq: string, time: string, dow: string): string {
  const [hh, mm] = (time || '08:00').split(':')
  const h = Number(hh) || 0, m = Number(mm) || 0
  if (freq === 'hourly') return '0 * * * *'
  if (freq === 'weekdays') return `${m} ${h} * * 1-5`
  if (freq === 'weekly') return `${m} ${h} * * ${dow || '1'}`
  return `${m} ${h} * * *`  // daily
}
function describeCron(c: string): string {
  const p = (c || '').trim().split(/\s+/); if (p.length !== 5) return c || ''
  const [m, h, , , dow] = p
  if (h === '*' && (m === '0' || m === '*')) return 'every hour'
  const t = (h !== '*' && m !== '*') ? `${String(+h).padStart(2, '0')}:${String(+m).padStart(2, '0')}` : ''
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  if (dow === '1-5') return `every weekday at ${t}`
  if (dow === '*') return `every day at ${t}`
  if (/^[0-6]$/.test(dow)) return `every ${days[+dow]} at ${t}`
  return c
}

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

// Render an agent's final answer as proper markdown (same style as chat), not a text dump.
const ResultBlock = ({ text }: { text: string }) => (
  <div className="prose-mosaic" style={{ padding: 18, fontSize: 14, lineHeight: 1.7, color: 'var(--text)', overflowWrap: 'anywhere' }}>
    <ReactMarkdown remarkPlugins={[remarkGfm]}>{text || ''}</ReactMarkdown>
  </div>
)

// Collapsible technical trace of the run's tool calls (theme-aware, not a black terminal).
function StepLog({ steps, label = 'Activity' }: { steps: Step[]; label?: string }) {
  const [open, setOpen] = useState(false)
  const toolN = (steps || []).filter(s => s.type === 'tool').length
  if (!steps || steps.length === 0) return null
  return (
    <div style={{ borderTop: '1px solid var(--border)' }}>
      <button onClick={() => setOpen(o => !o)} style={{ width: '100%', textAlign: 'left', border: 'none', background: 'none', color: 'var(--text3)', fontSize: 12, fontWeight: 600, padding: '10px 18px', cursor: 'pointer', fontFamily: 'inherit' }}>{open ? '▾' : '▸'} {label} · {toolN} tool call{toolN === 1 ? '' : 's'}</button>
      {open && (
        <div style={{ background: 'var(--bg3)', fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.5, padding: '2px 18px 14px', maxHeight: 340, overflow: 'auto' }}>
          {steps.map((s, i) => (
            <div key={i} style={{ padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
              <span style={{ color: s.type === 'tool' ? 'var(--accent-bg,#2f6df6)' : s.type === 'result' ? 'var(--green-t,#0a8f5b)' : s.type === 'approval' ? 'var(--amber-t,#b45309)' : 'var(--text3)' }}>{s.type === 'tool' ? `→ ${s.tool}` : s.type === 'approval' ? `⚠ ${s.tool} (held for approval)` : s.type === 'result' ? `✓ ${s.tool || ''}` : '▸'}</span>
              {s.type === 'tool' && s.input != null && <span style={{ color: 'var(--text3)' }}> {JSON.stringify(s.input).slice(0, 140)}</span>}
              {s.result && s.type === 'result' && <div style={{ color: 'var(--text3)', marginTop: 2, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{String(s.result).slice(0, 400)}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function statusPill(s: string | undefined, running?: boolean): React.CSSProperties {
  const ok = s === 'succeeded', pa = s === 'paused_for_approval', rn = running || s === 'running'
  return { fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 99, whiteSpace: 'nowrap',
    background: ok ? 'var(--green-bg,#ecfdf5)' : pa ? 'var(--amber-bg,#fffbeb)' : rn ? 'var(--blue-bg,#eff6ff)' : s === 'stopped' ? 'var(--bg3)' : 'var(--red-bg,#fef2f2)',
    color: ok ? 'var(--green-t,#0a8f5b)' : pa ? 'var(--amber-t,#b45309)' : rn ? 'var(--blue-t,#2563eb)' : s === 'stopped' ? 'var(--text2)' : 'var(--red-t,#dc2626)' }
}

export default function AgentsPage({ user }: { user: SessionUser }) {
  const [view, setView] = useState<'agents' | 'build' | 'run' | 'report' | 'detail'>('agents')
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [conns, setConns] = useState<Conn[]>([])
  const [customTools, setCustomTools] = useState<CTool[]>([])
  const [ctForm, setCtForm] = useState<{ open: boolean; name: string; description: string; url_template: string; method: 'GET' | 'POST'; read_only: boolean; inputs: string }>({ open: false, name: '', description: '', url_template: '', method: 'GET', read_only: true, inputs: '' })
  const [ctMsg, setCtMsg] = useState('')

  const [run, setRun] = useState<{ agent: string; steps: Step[]; status: string; stop: string; result: string; cost: number; runId?: string } | null>(null)
  const [running, setRunning] = useState(false)
  const [live, setLive] = useState<{ execution?: string; phase: string; plan: LiveSub[]; toolCount: number; lead?: string } | null>(null)
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
  const [schedFreq, setSchedFreq] = useState('daily')
  const [schedTime, setSchedTime] = useState('08:00')
  const [schedDow, setSchedDow] = useState('1')

  const [detail, setDetail] = useState<Agent | null>(null)
  const [versions, setVersions] = useState<Version[]>([])
  const [evals, setEvals] = useState<EvalRow[]>([])
  const [evalForm, setEvalForm] = useState<{ name: string; input: string; expected: string; expectSucceed: boolean }>({ name: '', input: '', expected: '', expectSucceed: true })
  const [evalRun, setEvalRun] = useState<{ suite: { passed: number; total: number; score: number }; cases: { id: string; name: string; score: { passed: boolean; missing: string[] } }[] } | null>(null)
  const [evalBusy, setEvalBusy] = useState(false)
  const [proposal, setProposal] = useState<{ current: Record<string, unknown>; proposed: Record<string, unknown>; rationale: string; changes: string[] } | null>(null)
  const [evolving, setEvolving] = useState(false)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try { const r = await fetch('/api/agents'); const d = await r.json(); setAgents(d.agents || []) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { fetch('/api/connections').then(r => r.json()).then(d => setConns(d.connections || [])).catch(() => {}) }, [])
  useEffect(() => { loadCustomTools() }, [])
  async function loadCustomTools() { try { const d = await (await fetch('/api/custom-tools')).json(); setCustomTools(d.tools || []) } catch { setCustomTools([]) } }
  async function createCustomTool() {
    setCtMsg('')
    const props: Record<string, { type: string }> = {}; const required: string[] = []
    for (const nm of ctForm.inputs.split(',').map(s => s.trim()).filter(Boolean)) { props[nm] = { type: 'string' }; required.push(nm) }
    const body = { name: ctForm.name.trim(), description: ctForm.description, url_template: ctForm.url_template.trim(), method: ctForm.method, read_only: ctForm.read_only, input_schema: { type: 'object', properties: props, required } }
    const r = await fetch('/api/custom-tools', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const d = await r.json()
    if (!r.ok) { setCtMsg(d.error || 'Failed'); return }
    setCtForm({ open: false, name: '', description: '', url_template: '', method: 'GET', read_only: true, inputs: '' })
    await loadCustomTools()
    if (d.tool?.id) setDraft(dr => dr ? { ...dr, custom_tool_ids: [...dr.custom_tool_ids, d.tool.id] } : dr)
  }
  const loadRuns = useCallback(async () => {
    const r = await fetch('/api/agents/runs'); const d = await r.json(); setRuns(d.runs || []); setStats(d.stats || null)
  }, [])
  useEffect(() => { if (view === 'report') loadRuns() }, [view, loadRuns])

  function newDraft() { setDraft({ name: '', goal: '', tools: [...DEFAULT_TOOLS], guardrails: { ...DEFAULT_GUARDRAILS }, sources: [], learnings: '', trigger_type: 'manual', schedule: '', execution: 'single', max_subagents: 4, event: { ...EMPTY_EVENT }, custom_tool_ids: [] }); setRationale(''); setPreview(null); setMsg(''); setView('build') }
  function editDraft(a: Agent) { setDraft({ id: a.id, name: a.name, goal: a.goal, tools: asArr(a.tools), guardrails: { ...DEFAULT_GUARDRAILS, ...asObj<Partial<Guardrails>>(a.guardrails, {}) }, sources: asArr(a.sources), learnings: a.learnings || '', trigger_type: a.trigger_type || 'manual', schedule: typeof a.schedule === 'string' ? a.schedule : '', execution: a.execution === 'orchestrated' ? 'orchestrated' : 'single', max_subagents: Number(a.max_subagents) || 4, event: parseEventCondition(a.event_condition), custom_tool_ids: asArr(a.custom_tool_ids) }); setRationale(''); setPreview(null); setMsg(''); setView('build') }

  function applyLiveEvent(ev: Record<string, unknown>) {
    const t = String(ev.type)
    if (t === 'run_started') { setLive(l => ({ ...(l || { plan: [], toolCount: 0 }), execution: String(ev.execution || 'single'), phase: ev.execution === 'orchestrated' ? 'planning' : 'working' })) }
    else if (t === 'plan') { const subs = (ev.subtasks as { id: string; title: string }[] || []).map(s => ({ id: s.id, title: s.title, status: 'queued' as const })); setLive(l => ({ ...(l || { toolCount: 0 }), execution: 'orchestrated', phase: 'running', plan: subs })) }
    else if (t === 'subagent_status') { setLive(l => l ? { ...l, plan: l.plan.map(s => s.id === ev.id ? { ...s, status: 'running', tool: ev.tool ? String(ev.tool) : s.tool } : s), toolCount: ev.tool ? l.toolCount + 1 : l.toolCount } : l) }
    else if (t === 'subagent_result') { setLive(l => l ? { ...l, plan: l.plan.map(s => s.id === ev.id ? { ...s, status: 'done', summary: String(ev.summary || ''), error: ev.error ? String(ev.error) : undefined } : s) } : l) }
    else if (t === 'tool') { setLive(l => l ? { ...l, toolCount: l.toolCount + 1, lead: `using ${String(ev.tool)}` } : l) }
    else if (t === 'reason') { setLive(l => l ? { ...l, lead: String(ev.text || '').slice(0, 120) } : l) }
    else if (t === 'synthesizing') { setLive(l => l ? { ...l, phase: 'synthesizing' } : l) }
  }

  async function runNow(a: Agent) {
    setRunning(true); setFed(null); setView('run'); setRun({ agent: a.name, steps: [], status: 'running', stop: '', result: '', cost: 0 }); setLive({ phase: 'starting', plan: [], toolCount: 0 })
    try {
      const r = await fetch(`/api/agents/${a.id}/stream`, { method: 'POST' })
      if (!r.ok || !r.body) {
        // Fallback: synchronous run (older server / no stream body).
        const d = await (await fetch(`/api/agents/${a.id}`, { method: 'POST' })).json()
        if (d.run) setRun({ agent: a.name, steps: d.run.steps || [], status: d.run.status, stop: d.run.stop_reason, result: d.run.result, cost: d.run.cost_usd, runId: d.run.run_id })
        else setRun({ agent: a.name, steps: [], status: 'failed', stop: d.error || 'error', result: d.error || 'Run failed', cost: 0 })
        return
      }
      const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = ''
      for (;;) {
        const { done, value } = await reader.read(); if (done) break
        buf += dec.decode(value, { stream: true })
        const parts = buf.split('\n\n'); buf = parts.pop() || ''
        for (const p of parts) {
          const dl = p.split('\n').find(l => l.startsWith('data: ')); if (!dl) continue
          let ev: Record<string, unknown>; try { ev = JSON.parse(dl.slice(6)) } catch { continue }
          if (ev.type === 'run') { const d = ev.run as Record<string, unknown>; setRun({ agent: a.name, steps: (d.steps as Step[]) || [], status: String(d.status), stop: String(d.stop_reason || ''), result: String(d.result || ''), cost: Number(d.cost_usd || 0), runId: d.run_id as string | undefined }) }
          else if (ev.type === 'error') { setRun({ agent: a.name, steps: [], status: 'failed', stop: 'error', result: String(ev.error || 'Run failed'), cost: 0 }) }
          else if (ev.type !== 'ping') applyLiveEvent(ev)
        }
      }
    } catch (e) { setRun({ agent: a.name, steps: [], status: 'failed', stop: 'error', result: String(e), cost: 0 }) }
    finally { setRunning(false); setLive(null) }
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
      const r = await fetch('/api/agents/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: d.name, goal: d.goal, tools: d.tools, guardrails: d.guardrails, sources: d.sources, execution: d.execution, max_subagents: d.max_subagents, custom_tool_ids: d.custom_tool_ids }) })
      const j = await r.json(); const rn = j.run || {}
      setPreview({ status: rn.status || 'failed', result: rn.result || j.error || '', steps: rn.steps || [], cost: rn.cost_usd || 0, evidence: j.evidence })
    } catch (e) { setPreview({ status: 'failed', result: String(e), steps: [], cost: 0 }) }
    finally { setPreviewing(false) }
  }
  async function publish(d: Draft, evolutionAccepted?: boolean) {
    if (!d.name.trim() || !d.goal.trim()) { setMsg('Name and goal are required.'); return }
    setSaving(true); setMsg('')
    try {
      const body: Record<string, unknown> = { name: d.name, goal: d.goal, tools: d.tools, guardrails: d.guardrails, sources: d.sources, learnings: d.learnings, trigger_type: d.trigger_type, schedule: d.trigger_type === 'schedule' ? d.schedule : '', execution: d.execution, max_subagents: d.max_subagents, custom_tool_ids: d.custom_tool_ids }
      if (d.trigger_type === 'event') {
        body.event_condition = JSON.stringify({ source_type: 'database', source_id: d.event.source_id, query: d.event.query, field: d.event.field, op: d.event.op, value: Number(d.event.value), match_mode: d.event.match_mode, cooldown_sec: Math.max(0, Math.round(d.event.cooldown_min * 60)) })
      } else if (d.id) {
        body.event_condition = '' // clear when switching away from event
      }
      if (evolutionAccepted) body.evolution_source = 'ai-proposed-accepted'
      const url = d.id ? `/api/agents/${d.id}` : '/api/agents'
      const r = await fetch(url, { method: d.id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!r.ok) { const e = await r.json().catch(() => ({})); setMsg(e.error || 'Save failed'); return }
      await load(); setView('agents')
    } finally { setSaving(false) }
  }

  async function openDetail(a: Agent) {
    setDetail(a); setProposal(null); setMsg(''); setView('detail'); setEvalRun(null)
    const r = await fetch(`/api/agents/${a.id}/versions`); const d = await r.json(); setVersions(d.versions || [])
    loadEvals(a.id)
  }
  async function loadEvals(agentId: string) {
    try { const d = await (await fetch(`/api/agents/${agentId}/evals`)).json(); setEvals(d.evals || []) } catch { setEvals([]) }
  }
  async function addEval() {
    if (!detail || !evalForm.name.trim()) return
    const expected = evalForm.expected.split(',').map(s => s.trim()).filter(Boolean)
    await fetch(`/api/agents/${detail.id}/evals`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: evalForm.name, input: evalForm.input || undefined, expected_contains: expected, expect_status: evalForm.expectSucceed ? 'succeeded' : 'any' }) })
    setEvalForm({ name: '', input: '', expected: '', expectSucceed: true }); loadEvals(detail.id)
  }
  async function delEval(evalId: string) {
    if (!detail) return
    await fetch(`/api/agents/${detail.id}/evals/${evalId}`, { method: 'DELETE' }); loadEvals(detail.id)
  }
  async function runEvals() {
    if (!detail) return
    setEvalBusy(true); setEvalRun(null)
    try {
      const r = await fetch(`/api/agents/${detail.id}/evals/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      const d = await r.json()
      if (d.suite) { setEvalRun(d); loadEvals(detail.id) } else setMsg(d.error || 'Eval run failed')
    } finally { setEvalBusy(false) }
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
    publish({ id: detail.id, name: detail.name, goal: String(p.goal || ''), tools: (p.tools as string[]) || [], guardrails: { ...DEFAULT_GUARDRAILS, ...(p.guardrails as object) }, sources: (p.sources as string[]) || [], learnings: String(p.learnings || ''), trigger_type: detail.trigger_type || 'manual', schedule: typeof detail.schedule === 'string' ? detail.schedule : '', execution: detail.execution === 'orchestrated' ? 'orchestrated' : 'single', max_subagents: Number(detail.max_subagents) || 4, event: parseEventCondition(detail.event_condition), custom_tool_ids: asArr(detail.custom_tool_ids) }, true)
  }

  const pageCount = Math.max(1, Math.ceil(agents.length / PAGE))
  const pageAgents = agents.slice(page * PAGE, page * PAGE + PAGE)
  const activeN = agents.filter(a => a.status === 'active').length

  const tabStyle = (v: string): React.CSSProperties => ({ border: '1px solid ' + (view === v ? 'var(--border)' : 'transparent'), background: view === v ? 'var(--surface)' : 'transparent', color: view === v ? 'var(--text)' : 'var(--text2)', fontSize: 12.5, fontWeight: 600, padding: '7px 14px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', textTransform: 'capitalize' })

  return (
    <AppShell user={user}>
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
              <label style={lbl}>Custom tools <span style={{ textTransform: 'none', fontWeight: 400, color: 'var(--text3)' }}>— admin-authored HTTP tools (read-only by default, SSRF-checked)</span></label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, alignItems: 'center' }}>
                {customTools.filter(t => t.enabled).map(t => {
                  const on = draft.custom_tool_ids.includes(t.id)
                  return <button key={t.id} title={`${t.method} ${t.url_template}`} onClick={() => setDraft({ ...draft, custom_tool_ids: on ? draft.custom_tool_ids.filter(x => x !== t.id) : [...draft.custom_tool_ids, t.id] })} style={{ border: '1px solid ' + (on ? 'transparent' : 'var(--border2)'), background: on ? 'var(--accent-bg,#2f6df6)' : 'var(--surface)', color: on ? 'var(--accent-fg,#fff)' : 'var(--text2)', fontSize: 12, fontWeight: 600, padding: '5px 10px', borderRadius: 8, cursor: 'pointer' }}>{on ? '✓ ' : ''}{t.name}{t.read_only ? '' : ' ⚠'}</button>
                })}
                <button style={{ ...btn, padding: '5px 10px', fontSize: 12 }} onClick={() => setCtForm({ ...ctForm, open: !ctForm.open })}>{ctForm.open ? '× Cancel' : '+ New tool'}</button>
              </div>
              {ctForm.open && (
                <div style={{ marginTop: 10, padding: 12, border: '1px solid var(--border)', borderRadius: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 8, alignItems: 'end' }}>
                  <div><label style={{ ...lbl, fontSize: 10, marginBottom: 4 }}>Name (slug)</label><input value={ctForm.name} onChange={e => setCtForm({ ...ctForm, name: e.target.value })} placeholder="weather_lookup" style={inp} /></div>
                  <div><label style={{ ...lbl, fontSize: 10, marginBottom: 4 }}>Method</label><select value={ctForm.method} onChange={e => setCtForm({ ...ctForm, method: e.target.value === 'POST' ? 'POST' : 'GET' })} style={inp}><option>GET</option><option>POST</option></select></div>
                  <div style={{ gridColumn: '1 / -1' }}><label style={{ ...lbl, fontSize: 10, marginBottom: 4 }}>URL template</label><input value={ctForm.url_template} onChange={e => setCtForm({ ...ctForm, url_template: e.target.value })} placeholder="https://api.example.com/w/{city}" style={{ ...inp, fontFamily: 'var(--font-mono)', fontSize: 11.5 }} /></div>
                  <div style={{ gridColumn: '1 / -1' }}><label style={{ ...lbl, fontSize: 10, marginBottom: 4 }}>Description (tells the agent when to use it)</label><input value={ctForm.description} onChange={e => setCtForm({ ...ctForm, description: e.target.value })} placeholder="Look up current weather for a city" style={inp} /></div>
                  <div><label style={{ ...lbl, fontSize: 10, marginBottom: 4 }}>Inputs (comma-sep, match {'{placeholders}'})</label><input value={ctForm.inputs} onChange={e => setCtForm({ ...ctForm, inputs: e.target.value })} placeholder="city" style={inp} /></div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text2)' }}><input type="checkbox" checked={ctForm.read_only} onChange={e => setCtForm({ ...ctForm, read_only: e.target.checked })} /> read-only</label>
                  <button style={btnPri} disabled={!ctForm.name.trim() || !ctForm.url_template.trim()} onClick={createCustomTool}>Register & attach</button>
                  {ctMsg && <span style={{ gridColumn: '1 / -1', fontSize: 12, color: 'var(--red-t,#dc2626)' }}>{ctMsg}</span>}
                </div>
              )}
            </div>

            <div>
              <button style={{ ...btn, padding: '4px 0', border: 'none', background: 'none', color: 'var(--text3)', fontSize: 12, cursor: 'pointer' }} onClick={() => setShowAdv(s => !s)}>{showAdv ? '▾' : '▸'} Learnings (knowledge carried into every run)</button>
              {showAdv && <textarea style={{ ...inp, minHeight: 64, resize: 'vertical', marginTop: 6 }} value={draft.learnings} placeholder="Human-approved notes injected into the prompt, e.g. known-good queries or resolved source names." onChange={e => setDraft({ ...draft, learnings: e.target.value })} />}
            </div>

            <div>
              <label style={lbl}>Execution</label>
              <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 10, width: 'fit-content' }}>
                {(['single', 'orchestrated'] as const).map(m => (
                  <button key={m} onClick={() => setDraft({ ...draft, execution: m })}
                    style={{ border: '1px solid ' + (draft.execution === m ? 'var(--border)' : 'transparent'), background: draft.execution === m ? 'var(--surface)' : 'transparent', color: draft.execution === m ? 'var(--text)' : 'var(--text2)', fontSize: 12.5, fontWeight: 600, padding: '7px 16px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' }}>{m === 'single' ? 'Single agent' : 'Orchestrated (parallel sub-agents)'}</button>
                ))}
              </div>
              {draft.execution === 'orchestrated' ? (
                <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <label style={{ ...lbl, fontSize: 11, margin: 0 }}>Max sub-agents</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button style={{ ...btn, padding: '2px 10px' }} onClick={() => setDraft({ ...draft, max_subagents: Math.max(1, draft.max_subagents - 1) })}>−</button>
                    <span style={{ minWidth: 20, textAlign: 'center', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{draft.max_subagents}</span>
                    <button style={{ ...btn, padding: '2px 10px' }} onClick={() => setDraft({ ...draft, max_subagents: Math.min(8, draft.max_subagents + 1) })}>+</button>
                  </div>
                  <span style={{ fontSize: 11.5, color: 'var(--text3)' }}>The agent plans, runs up to {draft.max_subagents} read-only sub-agents in parallel, and synthesises one answer. All sub-agents share this agent&rsquo;s guardrails as a single fleet budget (steps, tool calls, cost, time) — not per sub-agent.</span>
                </div>
              ) : (
                <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 8 }}>One reasoning loop. Best for focused goals; can take write actions (with approval).</div>
              )}
            </div>

            <div>
              <label style={lbl}>Trigger</label>
              <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 10, width: 'fit-content' }}>
                {(['manual', 'schedule', 'event'] as const).map(t => (
                  <button key={t} onClick={() => setDraft({ ...draft, trigger_type: t, schedule: t === 'schedule' ? (draft.schedule || cronFrom(schedFreq, schedTime, schedDow)) : draft.schedule })}
                    style={{ border: '1px solid ' + (draft.trigger_type === t ? 'var(--border)' : 'transparent'), background: draft.trigger_type === t ? 'var(--surface)' : 'transparent', color: draft.trigger_type === t ? 'var(--text)' : 'var(--text2)', fontSize: 12.5, fontWeight: 600, padding: '7px 16px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit' }}>{t === 'manual' ? 'Manual' : t === 'schedule' ? 'Scheduled' : 'On event'}</button>
                ))}
              </div>
              {draft.trigger_type === 'event' && (
                <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={{ ...lbl, fontSize: 10, marginBottom: 4 }}>Watch this data source</label>
                    <select value={draft.event.source_id} onChange={e => setDraft({ ...draft, event: { ...draft.event, source_id: e.target.value } })} style={inp}>
                      <option value="">Select a database…</option>
                      {conns.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </select>
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={{ ...lbl, fontSize: 10, marginBottom: 4 }}>Query (returns the value to watch)</label>
                    <input value={draft.event.query} onChange={e => setDraft({ ...draft, event: { ...draft.event, query: e.target.value } })} placeholder="SELECT oee_pct FROM production_logs ORDER BY shift_date DESC LIMIT 1" style={{ ...inp, fontFamily: 'var(--font-mono)', fontSize: 11.5 }} />
                  </div>
                  <div><label style={{ ...lbl, fontSize: 10, marginBottom: 4 }}>Field</label><input value={draft.event.field} onChange={e => setDraft({ ...draft, event: { ...draft.event, field: e.target.value } })} placeholder="oee_pct" style={inp} /></div>
                  <div><label style={{ ...lbl, fontSize: 10, marginBottom: 4 }}>When</label><select value={draft.event.op} onChange={e => setDraft({ ...draft, event: { ...draft.event, op: e.target.value } })} style={inp}>{['<', '<=', '>', '>=', '==', '!='].map(o => <option key={o} value={o}>{o}</option>)}</select></div>
                  <div><label style={{ ...lbl, fontSize: 10, marginBottom: 4 }}>Value</label><input value={draft.event.value} onChange={e => setDraft({ ...draft, event: { ...draft.event, value: e.target.value } })} placeholder="75" style={inp} /></div>
                  <div><label style={{ ...lbl, fontSize: 10, marginBottom: 4 }}>Rows</label><select value={draft.event.match_mode} onChange={e => setDraft({ ...draft, event: { ...draft.event, match_mode: e.target.value === 'any' ? 'any' : 'first' } })} style={inp}><option value="first">First row</option><option value="any">Any row</option></select></div>
                  <div><label style={{ ...lbl, fontSize: 10, marginBottom: 4 }}>Cooldown (min)</label><input type="number" min={0} value={draft.event.cooldown_min} onChange={e => setDraft({ ...draft, event: { ...draft.event, cooldown_min: Math.max(0, Number(e.target.value) || 0) } })} style={inp} /></div>
                  <div style={{ gridColumn: '1 / -1', fontSize: 11.5, color: 'var(--text3)' }}>
                    Checked every minute. Fires once when <b>{draft.event.field || 'the value'} {draft.event.op} {draft.event.value || '…'}</b> becomes true (not every minute it stays true); re-arms when it goes back to normal. Cooldown prevents rapid re-fires.
                  </div>
                </div>
              )}
              {draft.trigger_type === 'schedule' && (
                <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10 }}>
                  <div>
                    <label style={{ ...lbl, fontSize: 10, marginBottom: 4 }}>Frequency</label>
                    <select value={schedFreq} onChange={e => { setSchedFreq(e.target.value); setDraft({ ...draft, schedule: cronFrom(e.target.value, schedTime, schedDow) }) }} style={inp}>
                      <option value="hourly">Every hour</option><option value="daily">Every day</option><option value="weekdays">Every weekday</option><option value="weekly">Every week</option>
                    </select>
                  </div>
                  {schedFreq !== 'hourly' && (
                    <div><label style={{ ...lbl, fontSize: 10, marginBottom: 4 }}>Time</label><input type="time" value={schedTime} onChange={e => { setSchedTime(e.target.value); setDraft({ ...draft, schedule: cronFrom(schedFreq, e.target.value, schedDow) }) }} style={inp} /></div>
                  )}
                  {schedFreq === 'weekly' && (
                    <div><label style={{ ...lbl, fontSize: 10, marginBottom: 4 }}>Day</label><select value={schedDow} onChange={e => { setSchedDow(e.target.value); setDraft({ ...draft, schedule: cronFrom(schedFreq, schedTime, e.target.value) }) }} style={inp}>{['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => <option key={i} value={String(i)}>{d}</option>)}</select></div>
                  )}
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={{ ...lbl, fontSize: 10, marginBottom: 4 }}>Cron expression (advanced)</label>
                    <input value={draft.schedule} onChange={e => setDraft({ ...draft, schedule: e.target.value })} placeholder="0 8 * * *" style={{ ...inp, fontFamily: 'var(--font-mono)' }} />
                    <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 5 }}>{draft.schedule ? `Runs ${describeCron(draft.schedule)} · server time zone.` : 'Set a schedule above.'}</div>
                  </div>
                </div>
              )}
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
              {previewing ? (
                <div style={{ padding: 18, color: 'var(--text3)', fontSize: 13 }}>Running read-only against the live data layer…</div>
              ) : (
                <>
                  {preview?.result && <ResultBlock text={preview.result} />}
                  <StepLog steps={preview?.steps || []} />
                </>
              )}
            </div>
          )}
        </div>
      )}

      {view === 'detail' && detail && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button style={btn} onClick={() => setView('agents')}>‹ Back</button>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{detail.name}</div>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
                {detail.execution === 'orchestrated' ? `Orchestrated · up to ${Number(detail.max_subagents) || 4} parallel sub-agents` : 'Single agent'}
                {detail.trigger_type === 'schedule' && detail.schedule ? ` · scheduled, runs ${describeCron(String(detail.schedule))}` : ''}
                {detail.trigger_type === 'event' ? (() => { const e = parseEventCondition(detail.event_condition); return ` · on event: ${e.field || 'value'} ${e.op} ${e.value}` })() : ''}
              </div>
            </div>
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
                  <button style={btn} onClick={() => doPreview({ id: detail.id, name: detail.name, goal: String(proposal.proposed.goal || ''), tools: (proposal.proposed.tools as string[]) || [], guardrails: { ...DEFAULT_GUARDRAILS, ...(proposal.proposed.guardrails as object) }, sources: (proposal.proposed.sources as string[]) || [], learnings: String(proposal.proposed.learnings || ''), trigger_type: detail.trigger_type || 'manual', schedule: typeof detail.schedule === 'string' ? detail.schedule : '', execution: detail.execution === 'orchestrated' ? 'orchestrated' : 'single', max_subagents: Number(detail.max_subagents) || 4, event: parseEventCondition(detail.event_condition), custom_tool_ids: asArr(detail.custom_tool_ids) })}>▶ Test proposed</button>
                  <button style={btnPri} disabled={saving} onClick={acceptProposal}>{saving ? 'Applying…' : 'Accept as new version'}</button>
                </div>
                {(previewing || preview) && (
                  <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                    {previewing ? (
                      <div style={{ padding: 14, color: 'var(--text3)', fontSize: 12.5 }}>Testing proposed config…</div>
                    ) : (
                      <>
                        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}><span style={statusPill(preview?.status)}>{preview?.status}</span></div>
                        {preview?.result && <ResultBlock text={preview.result} />}
                        <StepLog steps={preview?.steps || []} />
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={card}>
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 14, fontWeight: 700 }}>Evals</span>
              <span style={{ fontSize: 11.5, color: 'var(--text3)' }}>Checks that measure the agent — run before trusting a change.</span>
              <button style={{ ...btnPri, marginLeft: 'auto', padding: '6px 12px', fontSize: 12.5 }} disabled={evalBusy || evals.length === 0} onClick={runEvals}>{evalBusy ? 'Running…' : '▶ Run evals'}</button>
            </div>
            {evalRun && (
              <div style={{ padding: '10px 18px', borderBottom: '1px solid var(--border)', background: 'var(--bg3)', fontSize: 12.5 }}>
                Suite score: <b>{Math.round(evalRun.suite.score * 100)}%</b> · {evalRun.suite.passed}/{evalRun.suite.total} passed
              </div>
            )}
            {evals.length === 0 ? <div style={{ padding: 18, color: 'var(--text3)', fontSize: 13 }}>No checks yet. Add one below — e.g. expect the result to contain &ldquo;LATHE-01&rdquo;.</div> : evals.map(ev => {
              const exp = asArr(ev.expected_contains as string | string[])
              const ranCase = evalRun?.cases.find(c => c.id === ev.id)
              const pf = ranCase ? ranCase.score.passed : (ev.last_passed == null ? null : ev.last_passed === 1)
              return (
                <div key={ev.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '11px 18px', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, width: 42, color: pf == null ? 'var(--text3)' : pf ? 'var(--green-t,#16a34a)' : 'var(--red-t,#dc2626)' }}>{pf == null ? '—' : pf ? 'PASS' : 'FAIL'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{ev.name}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 2 }}>
                      expects {exp.length ? exp.map(e => `“${e}”`).join(', ') : '(run success only)'}{ev.expect_status === 'any' ? '' : ' · must succeed'}
                      {ranCase && !ranCase.score.passed && ranCase.score.missing.length ? ` · missing: ${ranCase.score.missing.join(', ')}` : ''}
                    </div>
                  </div>
                  <button style={{ ...btn, padding: '4px 9px', fontSize: 11.5 }} onClick={() => delEval(ev.id)}>Remove</button>
                </div>
              )
            })}
            <div style={{ padding: '12px 18px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 8, alignItems: 'end' }}>
              <div><label style={{ ...lbl, fontSize: 10, marginBottom: 4 }}>Check name</label><input value={evalForm.name} onChange={e => setEvalForm({ ...evalForm, name: e.target.value })} placeholder="Names the worst machine" style={inp} /></div>
              <div><label style={{ ...lbl, fontSize: 10, marginBottom: 4 }}>Result must contain (comma-sep)</label><input value={evalForm.expected} onChange={e => setEvalForm({ ...evalForm, expected: e.target.value })} placeholder="LATHE-01, OEE" style={inp} /></div>
              <div style={{ gridColumn: '1 / -1' }}><label style={{ ...lbl, fontSize: 10, marginBottom: 4 }}>Prompt override (optional — blank uses the agent goal)</label><input value={evalForm.input} onChange={e => setEvalForm({ ...evalForm, input: e.target.value })} placeholder="(use goal)" style={inp} /></div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text2)' }}><input type="checkbox" checked={evalForm.expectSucceed} onChange={e => setEvalForm({ ...evalForm, expectSucceed: e.target.checked })} /> must succeed</label>
              <button style={btn} disabled={!evalForm.name.trim()} onClick={addEval}>+ Add check</button>
            </div>
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
          {running ? (
            <div style={{ padding: 22 }}>
              {live && live.execution === 'orchestrated' && live.plan.length > 0 ? (
                <div>
                  <div style={{ fontSize: 12.5, color: 'var(--text2)', marginBottom: 12 }}>
                    {live.phase === 'synthesizing' ? 'Synthesising the final answer from sub-agent findings…' : `Lead agent running ${live.plan.length} sub-agents in parallel…`}
                    <span style={{ color: 'var(--text3)' }}> · {live.toolCount} tool calls</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {live.plan.map(s => (
                      <div key={s.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)' }}>
                        <span style={{ width: 8, height: 8, borderRadius: 99, marginTop: 5, flexShrink: 0, background: s.status === 'done' ? (s.error ? 'var(--red-t,#dc2626)' : 'var(--green-t,#16a34a)') : s.status === 'running' ? 'var(--accent-bg,#2563eb)' : 'var(--text3)', animation: s.status === 'running' ? 'pulse 1.2s ease-in-out infinite' : 'none' }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{s.title}</div>
                          <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 2 }}>
                            {s.status === 'done' ? (s.error ? `stopped · ${s.error}` : (s.summary || 'done').slice(0, 160)) : s.status === 'running' ? (s.tool ? `running · ${s.tool}` : 'running…') : 'queued'}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ color: 'var(--text3)', fontSize: 13.5 }}>
                  {live?.phase === 'synthesizing' ? 'Synthesising…' : 'Running the agent against the live data layer…'}
                  {live && live.toolCount > 0 ? <span> · {live.toolCount} tool calls{live.lead ? ` · ${live.lead}` : ''}</span> : null}
                </div>
              )}
              <style>{'@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}'}</style>
            </div>
          ) : (
            <>
              {run?.result && <ResultBlock text={run.result} />}
              <StepLog steps={run?.steps || []} />
            </>
          )}
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
    </AppShell>
  )
}
