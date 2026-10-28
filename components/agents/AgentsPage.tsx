'use client'
import { useState, useEffect, useCallback } from 'react'
import type { SessionUser } from '@/lib/auth'

// Agents surface — ported from the approved prototype. Views: Agents grid (with
// pagination), Builder, Run, and the centralised fleet Report. Backed by the real
// /api/agents endpoints and the headless runner.

interface Agent { id: string; name: string; goal: string; tools: string; trigger_type: string; status: string; guardrails: string }
interface RunRow { id: string; agent_name: string; status: string; trigger_source: string; cost_usd: number; stop_reason: string; result: string; started_at: string }
interface Step { type: string; tool?: string; result?: string; at: string }

const ALL_TOOLS = [
  { id: 'query_database', g: 'Data', w: false }, { id: 'query_prism', g: 'Data', w: false }, { id: 'call_api', g: 'Data', w: false },
  { id: 'query_airbyte', g: 'Data', w: false }, { id: 'query_mcp', g: 'Data', w: false }, { id: 'read_file_server', g: 'Data', w: false },
  { id: 'web_search', g: 'Data', w: false }, { id: 'run_statistical_analysis', g: 'Analysis', w: false }, { id: 'run_code', g: 'Analysis', w: false },
  { id: 'deep_diagnose', g: 'Analysis', w: false }, { id: 'render_chart', g: 'Analysis', w: false },
  { id: 'build_dashboard', g: 'Actions', w: true }, { id: 'create_alert', g: 'Actions', w: true }, { id: 'save_memory', g: 'Actions', w: true },
]
const PAGE = 8

const card: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, boxShadow: 'var(--shadow)' }
const btn: React.CSSProperties = { border: '1px solid var(--border2)', background: 'var(--surface)', color: 'var(--text)', fontSize: 13, fontWeight: 600, padding: '8px 14px', borderRadius: 9, cursor: 'pointer', fontFamily: 'inherit' }
const btnPri: React.CSSProperties = { ...btn, background: 'var(--accent, #2f6df6)', borderColor: 'transparent', color: '#fff' }

export default function AgentsPage({ user }: { user: SessionUser }) {
  const [view, setView] = useState<'agents' | 'run' | 'report'>('agents')
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [run, setRun] = useState<{ agent: string; steps: Step[]; status: string; stop: string; result: string; cost: number } | null>(null)
  const [running, setRunning] = useState(false)
  const [runs, setRuns] = useState<RunRow[]>([])
  const [stats, setStats] = useState<{ total: number; success_rate: number | null; pending_approval: number; spend_usd: number } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try { const r = await fetch('/api/agents'); const d = await r.json(); setAgents(d.agents || []) } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])
  const loadRuns = useCallback(async () => {
    const r = await fetch('/api/agents/runs'); const d = await r.json(); setRuns(d.runs || []); setStats(d.stats || null)
  }, [])
  useEffect(() => { if (view === 'report') loadRuns() }, [view, loadRuns])

  async function runNow(a: Agent) {
    setRunning(true); setView('run'); setRun({ agent: a.name, steps: [], status: 'running', stop: '', result: '', cost: 0 })
    try {
      const r = await fetch(`/api/agents/${a.id}`, { method: 'POST' })
      const d = await r.json()
      if (d.run) setRun({ agent: a.name, steps: d.run.steps || [], status: d.run.status, stop: d.run.stop_reason, result: d.run.result, cost: d.run.cost_usd })
      else setRun({ agent: a.name, steps: [], status: 'failed', stop: d.error || 'error', result: d.error || 'Run failed', cost: 0 })
    } catch (e) { setRun({ agent: a.name, steps: [], status: 'failed', stop: 'error', result: String(e), cost: 0 }) }
    finally { setRunning(false) }
  }
  async function toggle(a: Agent) {
    const next = a.status === 'active' ? 'paused' : 'active'
    await fetch(`/api/agents/${a.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: next }) })
    load()
  }

  const pageCount = Math.max(1, Math.ceil(agents.length / PAGE))
  const pageAgents = agents.slice(page * PAGE, page * PAGE + PAGE)
  const activeN = agents.filter(a => a.status === 'active').length

  return (
    <div style={{ padding: '22px max(18px, env(safe-area-inset-left)) 54px', maxWidth: 1160, margin: '0 auto' }}>
      <div style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 11, width: 'fit-content', marginBottom: 22 }}>
        {(['agents', 'run', 'report'] as const).map(v => (
          <button key={v} onClick={() => setView(v)} style={{ border: '1px solid ' + (view === v ? 'var(--border)' : 'transparent'), background: view === v ? 'var(--surface)' : 'transparent', color: view === v ? 'var(--text)' : 'var(--text2)', fontSize: 12.5, fontWeight: 600, padding: '7px 14px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', textTransform: 'capitalize' }}>{v === 'report' ? 'Report' : v}</button>
        ))}
      </div>

      {view === 'agents' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--text3)' }}>{agents.length} agents · {activeN} active</div>
          </div>
          {loading ? <div style={{ color: 'var(--text3)', padding: 30 }}>Loading…</div> : agents.length === 0 ? (
            <div style={{ ...card, padding: 30, color: 'var(--text3)' }}>No agents yet.</div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(228px, 1fr))', gap: 14 }}>
                {pageAgents.map(a => (
                  <div key={a.id} style={{ ...card, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                      <div style={{ width: 44, height: 44, borderRadius: 13, background: 'var(--accent, #2f6df6)', display: 'grid', placeItems: 'center', color: '#fff', flexShrink: 0 }}>
                        <svg width="22" height="22" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="3" width="11" height="8" rx="1.5"/><path d="M5.5 1.5v1.5M10.5 1.5v1.5M6 13h4"/><circle cx="6" cy="7" r=".8" fill="currentColor" stroke="none"/><circle cx="10" cy="7" r=".8" fill="currentColor" stroke="none"/></svg>
                      </div>
                      <div style={{ fontWeight: 700, fontSize: 15, flex: 1, minWidth: 0 }}>{a.name}</div>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{a.goal}</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 'auto' }}>
                      <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 99, background: a.status === 'active' ? 'var(--green-bg, #ecfdf5)' : 'var(--bg3)', color: a.status === 'active' ? 'var(--green-t, #0a8f5b)' : 'var(--text2)' }}>{a.status === 'active' ? 'Active' : 'Paused'}</span>
                      <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 99, background: 'var(--bg3)', color: 'var(--text2)', textTransform: 'capitalize' }}>{a.trigger_type}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 7 }}>
                      <button style={{ ...btnPri, flex: 1, padding: '6px 10px', fontSize: 12 }} disabled={running || a.status === 'paused'} onClick={() => runNow(a)}>Run now</button>
                      <button style={{ ...btn, padding: '6px 10px', fontSize: 12 }} onClick={() => toggle(a)}>{a.status === 'active' ? 'Pause' : 'Resume'}</button>
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

      {view === 'run' && (
        <div style={card}>
          <div style={{ padding: 18, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{run?.agent || 'Run'}</div>
            <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 99, background: run?.status === 'succeeded' ? 'var(--green-bg,#ecfdf5)' : run?.status === 'paused_for_approval' ? 'var(--amber-bg,#fffbeb)' : run?.status === 'running' ? 'var(--blue-bg,#eff6ff)' : 'var(--red-bg,#fef2f2)', color: run?.status === 'succeeded' ? 'var(--green-t,#0a8f5b)' : run?.status === 'running' ? 'var(--blue-t,#2563eb)' : run?.status === 'paused_for_approval' ? 'var(--amber-t,#b45309)' : 'var(--red-t,#dc2626)' }}>{running ? 'Running…' : run?.status === 'paused_for_approval' ? 'Paused · approval' : run?.status || '—'}{run?.stop && run.status !== 'succeeded' && !running ? ` · ${run.stop}` : ''}</span>
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
            {run && !running && <span style={{ fontSize: 11.5, color: 'var(--text3)' }}>cost ${run.cost.toFixed(2)} · {run.steps.length} steps</span>}
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
                <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 99, background: r.status === 'succeeded' ? 'var(--green-bg,#ecfdf5)' : r.status === 'paused_for_approval' ? 'var(--amber-bg,#fffbeb)' : 'var(--red-bg,#fef2f2)', color: r.status === 'succeeded' ? 'var(--green-t,#0a8f5b)' : r.status === 'paused_for_approval' ? 'var(--amber-t,#b45309)' : 'var(--red-t,#dc2626)' }}>{r.status}</span>
                <span className="mono" style={{ fontSize: 11.5, color: 'var(--text2)', fontFamily: 'var(--font-mono)' }}>${Number(r.cost_usd || 0).toFixed(2)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
