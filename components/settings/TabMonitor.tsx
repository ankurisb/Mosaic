'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { PageTitle, PageSub, Btn, StatusDot, Spinner } from './ui'

interface Svc { id: string; label: string; category: string; status: string; latencyMs: number | null; message?: string }
interface Data { services: Svc[]; summary: { healthy: number; degraded: number; down: number; total: number } }

interface LogEntry {
  time: string
  level: string
  service: string
  msg: string
  err?: string
  [key: string]: unknown
}

const CAT: Record<string, string> = { infrastructure: 'Infrastructure', database: 'Databases', api: 'External APIs', api_service: 'API Services' }

const LEVEL_COLOR: Record<string, string> = {
  info:  'var(--text3)',
  warn:  'var(--amber-t)',
  error: 'var(--red-t)',
  fatal: 'var(--red-t)',
  debug: 'var(--text4)',
  trace: 'var(--text4)',
}

export default function TabMonitor() {
  const [data,        setData]        = useState<Data | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [last,        setLast]        = useState('')
  const [logs,        setLogs]        = useState<LogEntry[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [levelFilter, setLevelFilter] = useState('all')
  const [svcFilter,   setSvcFilter]   = useState('all')
  const [sinceFilter, setSinceFilter] = useState('1h')
  const [linesLimit,  setLinesLimit]  = useState('200')
  const [services,    setServices]    = useState<string[]>([])
  const [autoScroll,  setAutoScroll]  = useState(true)
  const [logNote,     setLogNote]     = useState('')
  const logEndRef = useRef<HTMLDivElement>(null)
  const logBoxRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try { const r = await fetch('/api/monitor'); if (r.ok) { setData(await r.json()); setLast(new Date().toLocaleTimeString()) } }
    finally { setLoading(false) }
  }, [])

  const loadLogs = useCallback(async () => {
    setLogsLoading(true)
    try {
      const params = new URLSearchParams({ lines: linesLimit, level: levelFilter, service: svcFilter, since: sinceFilter })
      const r = await fetch(`/api/logs?${params}`)
      if (r.ok) {
        const d = await r.json()
        setLogs(d.entries || [])
        setServices(d.services || [])
        if (d.note) setLogNote(d.note)
        else setLogNote('')
      }
    } finally { setLogsLoading(false) }
  }, [levelFilter, svcFilter, sinceFilter, linesLimit])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadLogs() }, [loadLogs])

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs, autoScroll])

  // Detect manual scroll up to pause auto-scroll
  function handleLogScroll() {
    const box = logBoxRef.current
    if (!box) return
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40
    setAutoScroll(atBottom)
  }

  function formatTime(iso: string) {
    try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) }
    catch { return iso }
  }

  const byCat = data ? data.services.reduce((a, s) => { if (!a[s.category]) a[s.category] = []; a[s.category].push(s); return a }, {} as Record<string, Svc[]>) : {}

  const sel: React.CSSProperties = {
    background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)',
    padding: '4px 8px', fontSize: 12, color: 'var(--text)', fontFamily: 'inherit', cursor: 'pointer',
  }

  return (
    <div className="fade-in">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <PageTitle>Monitoring</PageTitle>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {loading && <Spinner />}
          {last && <span style={{ fontSize: 12, color: 'var(--text3)' }}>checked {last}</span>}
          <Btn size="sm" onClick={load}>Refresh</Btn>
        </div>
      </div>
      <PageSub>Live health status of all connected services.</PageSub>

      {/* Summary cards */}
      {data && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 24 }}>
          {[
            { label: 'Healthy',  value: data.summary.healthy,  color: 'var(--green-t)' },
            { label: 'Degraded', value: data.summary.degraded, color: 'var(--amber-t)' },
            { label: 'Down',     value: data.summary.down,     color: 'var(--red-t)' },
            { label: 'Total',    value: data.summary.total,    color: 'var(--text)' },
          ].map(c => (
            <div key={c.label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', padding: '16px 18px' }}>
              <div style={{ fontSize: 28, fontWeight: 600, color: c.color, lineHeight: 1 }}>{c.value}</div>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>{c.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Service rows */}
      {loading && !data ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spinner size={24} /></div>
      ) : (
        Object.entries(CAT).map(([cat, label]) => {
          const svcs = byCat[cat] || []; if (!svcs.length) return null
          return (
            <div key={cat} style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8 }}>{label}</div>
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
                {svcs.map((s, i) => (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 18px', borderBottom: i < svcs.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <StatusDot status={s.status} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{s.label}</div>
                      {s.message && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>{s.message}</div>}
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 500, color: s.status === 'healthy' ? 'var(--green-t)' : s.status === 'degraded' ? 'var(--amber-t)' : 'var(--red-t)' }}>{s.status}</span>
                    <div style={{ textAlign: 'right', minWidth: 54 }}>
                      <div style={{ fontSize: 12, color: 'var(--text2)' }}>{s.latencyMs != null ? `${s.latencyMs}ms` : '--'}</div>
                    </div>
                    <div style={{ width: 64, height: 4, background: 'var(--bg3)', borderRadius: 99, overflow: 'hidden', flexShrink: 0 }}>
                      {s.latencyMs != null && <div style={{ height: '100%', borderRadius: 99, width: `${Math.min(100, s.latencyMs / 10)}%`, background: s.latencyMs > 500 ? 'var(--red)' : s.latencyMs > 200 ? 'var(--amber)' : 'var(--green)', transition: 'width .3s' }} />}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })
      )}

      {/* ── Server Logs ─────────────────────────────────────────────── */}
      <div style={{ marginTop: 32, marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>
          Server logs {logs.length > 0 && <span style={{ fontWeight: 400, textTransform: 'none', marginLeft: 4 }}>({logs.length} entries)</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Since filter */}
          <select value={sinceFilter} onChange={e => setSinceFilter(e.target.value)} style={sel}>
            <option value="15m">Last 15 min</option>
            <option value="1h">Last 1 hour</option>
            <option value="6h">Last 6 hours</option>
            <option value="24h">Last 24 hours</option>
            <option value="all">All time</option>
          </select>
          {/* Lines limit */}
          <select value={linesLimit} onChange={e => setLinesLimit(e.target.value)} style={sel}>
            <option value="100">100 lines</option>
            <option value="200">200 lines</option>
            <option value="500">500 lines</option>
          </select>
          {/* Level filter */}
          <select value={levelFilter} onChange={e => setLevelFilter(e.target.value)} style={sel}>
            <option value="all">All levels</option>
            <option value="warn">Warn +</option>
            <option value="error">Errors only</option>
          </select>
          {/* Service filter */}
          {services.length > 0 && (
            <select value={svcFilter} onChange={e => setSvcFilter(e.target.value)} style={sel}>
              <option value="all">All services</option>
              {services.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          <Btn size="sm" onClick={loadLogs}>Refresh</Btn>
        </div>
      </div>

      <div
        ref={logBoxRef}
        onScroll={handleLogScroll}
        style={{
          background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
          height: 360, overflowY: 'auto',
          padding: '10px 0',
        }}
      >
        {logsLoading && logs.length === 0 ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Spinner size={16} /></div>
        ) : logNote ? (
          <div style={{ padding: '16px 16px', color: 'var(--text3)', fontSize: 12, fontFamily: 'inherit' }}>{logNote}</div>
        ) : logs.length === 0 ? (
          <div style={{ padding: '16px 16px', color: 'var(--text3)', fontSize: 12, fontFamily: 'inherit' }}>No log entries found.</div>
        ) : (
          logs.map((entry, i) => (
            <div
              key={i}
              style={{
                display: 'flex', alignItems: 'baseline', gap: 10, padding: '3px 14px',
                background: entry.level === 'error' || entry.level === 'fatal' ? 'rgba(220,38,38,.04)' :
                            entry.level === 'warn' ? 'rgba(217,119,6,.04)' : 'transparent',
              }}
            >
              <span style={{ color: 'var(--text4)', flexShrink: 0, minWidth: 54, fontSize: 11, fontFamily: 'var(--font-mono)' }}>{formatTime(entry.time)}</span>
              <span style={{ color: LEVEL_COLOR[entry.level] || 'var(--text3)', flexShrink: 0, minWidth: 38, textTransform: 'uppercase', fontWeight: 600, fontSize: 10, fontFamily: 'var(--font-sans)' }}>{entry.level}</span>
              <span style={{ color: 'var(--text4)', flexShrink: 0, minWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11, fontFamily: 'var(--font-sans)' }}>{entry.service}</span>
              <span style={{ color: 'var(--text)', flex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12, fontFamily: 'var(--font-sans)' }}>
                {entry.msg}
                {entry.err && <span style={{ color: 'var(--red-t)', marginLeft: 6, fontFamily: 'var(--font-mono)', fontSize: 11 }}>{String(entry.err)}</span>}
              </span>
            </div>
          ))
        )}
        <div ref={logEndRef} />
      </div>

      {/* Auto-scroll indicator */}
      {!autoScroll && (
        <div style={{ marginTop: 6, display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={() => { setAutoScroll(true); logEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }}
            style={{ background: 'none', border: '1px solid var(--border2)', borderRadius: 'var(--radius-pill)', padding: '3px 10px', fontSize: 11, color: 'var(--text3)', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Scroll to bottom
          </button>
        </div>
      )}
    </div>
  )
}
