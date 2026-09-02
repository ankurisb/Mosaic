'use client'
import React from 'react'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import type { SessionUser } from '@/lib/auth'
import ThemeToggle from '@/components/ThemeToggle'
import PanelChart from './PanelChart'
import PanelBuilder from './PanelBuilder'
import { SupersetEmbed } from './SupersetEmbed'
import { SupersetConnectDiagram } from './SupersetConnectDiagram'
import { useSuperset } from './useSuperset'

interface Panel {
  id: string; title: string; subtitle: string
  source_type: string; source_id: string
  query: string; chart_type: string; chart_config: Record<string, unknown>
  refresh_sec: number | null; col: number; row: number; w: number; h: number
}
interface PanelResult { panel_id: string; ok: boolean; data?: unknown; error?: string; latency_ms: number }
interface Dashboard { id: string; name: string; description: string; refresh_sec: number; is_public: boolean; owner_id: string; superset_embed_uuid?: string }

const TIME_WINDOW_OPTS = [
  { label: "Today", value: "today" },
  { label: "Last 15m", value: "15m" },
  { label: "Last 1h", value: "1h" },
  { label: "Last 6h", value: "6h" },
  { label: "Last 24h", value: "24h" },
  { label: "Last 7d", value: "7d" },
  { label: "Last 30d", value: "30d" },
  { label: "Custom range…", value: "custom" },
]
const REFRESH_OPTS = [
  { label: 'Manual', value: 0 }, { label: '1 min', value: 60 },
  { label: '5 min', value: 300 }, { label: '15 min', value: 900 },
  { label: '1 hour', value: 3600 }, { label: '1 day', value: 86400 },
]

// -- Panel resize hook -----------------------------------------
function useResizePanel(onResize: (id: string, w: number, h: number) => void) {
  const stateRef = React.useRef<{
    id: string; startX: number; startY: number
    startW: number; startH: number
    colW: number; rowH: number
    curW: number; curH: number
  } | null>(null)

  const start = React.useCallback((
    e: React.MouseEvent, id: string, w: number, h: number,
    colW: number, rowH: number
  ) => {
    e.preventDefault()
    e.stopPropagation()
    stateRef.current = { id, startX: e.clientX, startY: e.clientY, startW: w, startH: h, colW, rowH, curW: w, curH: h }
    function onMove(ev: MouseEvent) {
      if (!stateRef.current) return
      const dx = ev.clientX - stateRef.current.startX
      const dy = ev.clientY - stateRef.current.startY
      const newW = Math.max(1, Math.min(4, stateRef.current.startW + Math.round(dx / stateRef.current.colW)))
      const newH = Math.max(1, Math.min(2, stateRef.current.startH + Math.round(dy / (stateRef.current.rowH * 0.6))))
      stateRef.current.curW = newW
      stateRef.current.curH = newH
    }
    function onUp() {
      if (!stateRef.current) return
      onResize(stateRef.current.id, stateRef.current.curW, stateRef.current.curH)
      stateRef.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [onResize])

  return { start }
}


export default function DashboardView({ id, user }: { id: string; user: SessionUser }) {
  const router = useRouter()
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [panels, setPanels] = useState<Panel[]>([])
  const [results, setResults] = useState<Record<string, PanelResult>>({})
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastFetch, setLastFetch] = useState<Date | null>(null)
  const [showBuilder, setShowBuilder] = useState(false)
  const [editingPanel, setEditingPanel] = useState<Panel | null>(null)
  const [timeWindow, setTimeWindow] = useState('today')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo,   setCustomTo]   = useState('')
  const [toast, setToast] = useState('')
  const [guestToken, setGuestToken] = useState<string|null>(null)
  const [guestTokenLoading, setGuestTokenLoading] = useState(false)
  const [embedError, setEmbedError] = useState<string|null>(null)
  // Browser-facing Superset origin (Caddy, :8445) — never the internal Docker
  // hostname, which the browser can't resolve. Served by /api/superset/status.
  const { status: supersetStatus } = useSuperset()
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500) }

  const fetchGuestToken = async (dashboardId: string) => {
    setGuestTokenLoading(true)
    try {
      const r = await fetch(`/api/superset/guest-token?dashboard_id=${dashboardId}`)
      const d = await r.json()
      if (d.token) {
        setGuestToken(d.token)
        setEmbedError(null)
      } else if (d.error === 'embedding_not_enabled') {
        // BYO Superset that isn't set up for embedding — show a helpful message
        // with an "open in Superset" fallback, not a broken iframe.
        setEmbedError(d.message || 'This Superset instance is not set up for embedding.')
      } else {
        setEmbedError('Could not load the embedded dashboard.')
      }
    } catch {
      setEmbedError('Could not reach Superset to load the embedded dashboard.')
    } finally {
      setGuestTokenLoading(false)
    }
  }

  // -- Load structure then data ----------------------------------
  const loadStructure = useCallback(async () => {
    const r = await fetch(`/api/dashboards/${id}`)
    const d = await r.json()
    if (d.error) { router.push('/dashboards'); return }
    setDashboard(d.dashboard)
    setPanels(d.panels)
    return d.dashboard
  }, [id, router])

  const fetchData = useCallback(async (showSpinner = true) => {
    if (showSpinner) setRefreshing(true)
    try {
      const tw = timeWindow === 'custom' && customFrom && customTo ? `custom&time_from=${encodeURIComponent(customFrom + 'T00:00:00')}&time_to=${encodeURIComponent(customTo + 'T23:59:59')}` : timeWindow
      const r = await fetch(`/api/dashboards/${id}/data?time_window=${tw}`)
      const d = await r.json()
      const map: Record<string, PanelResult> = {}
      for (const res of (d.results || [])) map[res.panel_id] = res
      setResults(map)
      setLastFetch(new Date())
    } finally { setRefreshing(false) }
  }, [id, timeWindow, customFrom, customTo])

  useEffect(() => {
    setLoading(true)
    loadStructure().then(dash => {
      if (!dash) return
      // Only take the Superset-embed path when Superset is actually configured.
      // A dashboard may carry a stale superset_embed_uuid from an edition/env that
      // had Superset; without it (e.g. desktop), fall through to Mosaic's own
      // native panel rendering rather than trying to embed a Superset that isn't
      // there.
      if (dash.superset_embed_uuid && supersetStatus?.configured) {
        fetchGuestToken(id).finally(() => setLoading(false))
      } else {
        fetchData(true).finally(() => setLoading(false))
      }
      // Set up auto-refresh
      if (dash.refresh_sec > 0) {
        timerRef.current = setInterval(() => fetchData(false), dash.refresh_sec * 1000)
      }
    })
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [loadStructure, fetchData])

  // Reset timer when refresh_sec changes
  const resetTimer = (sec: number) => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (sec > 0) timerRef.current = setInterval(() => fetchData(false), sec * 1000)
  }

  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 2500); return () => clearTimeout(t) } }, [toast])

  // -- Panel CRUD ------------------------------------------------
  const { start: startResize } = useResizePanel(async (panelId, newW, newH) => {
    await fetch('/api/dashboards', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update_panel', id: panelId, w: newW, h: newH }),
    })
    setPanels(p => p.map(x => x.id === panelId ? { ...x, w: newW, h: newH } : x))
  })

  async function savePanel(data: Omit<Panel, 'id'> & { id?: string }) {
    const action = data.id ? 'update_panel' : 'add_panel'
    await fetch('/api/dashboards', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, dashboard_id: id, ...data }),
    })
    setShowBuilder(false); setEditingPanel(null)
    await loadStructure()
    await fetchData(true)
    showToast(data.id ? 'Panel updated' : 'Panel added')
  }

  async function deletePanel(panelId: string, title: string) {
    if (!confirm(`Delete panel "${title}"?`)) return
    await fetch('/api/dashboards', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete_panel', id: panelId }),
    })
    setPanels(p => p.filter(x => x.id !== panelId))
    showToast('Panel deleted')
  }

  async function updateDashboard(updates: Partial<Dashboard>) {
    if (!dashboard) return
    const merged = { ...dashboard, ...updates }
    await fetch('/api/dashboards', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update_dashboard', id, ...merged }),
    })
    setDashboard(merged)
    if (updates.refresh_sec !== undefined) resetTimer(updates.refresh_sec)
    showToast('Dashboard updated')
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', fontSize: 13 }}>
      Loading dashboard...
    </div>
  )
  if (!dashboard) return null

  const isOwner = dashboard.owner_id === user.id

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '0 24px', height: 52, display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <button onClick={() => router.push('/dashboards')} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, color: 'var(--text3)', fontSize: 12, fontFamily: 'inherit', padding: 0 }}>
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M8 2L3 6.5l5 4.5"/></svg>
          Dashboards
        </button>
        <div style={{ width: 1, height: 14, background: 'var(--border2)' }} />
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', flex: 1 }}>{dashboard.name}</span>

        {/* Time window selector — hidden for Superset embeds */}
        {!dashboard?.superset_embed_uuid && <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" style={{ color: 'var(--text3)' }}><rect x="1" y="2" width="10" height="9" rx="1"/><path d="M1 5h10M4 1v2M8 1v2"/></svg>
          <select value={timeWindow} onChange={e => setTimeWindow(e.target.value)}
            style={{ background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', padding: '4px 8px', fontSize: 12, color: 'var(--text2)', fontFamily: 'inherit', cursor: 'pointer', outline: 'none' }}>
            {TIME_WINDOW_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {timeWindow === 'custom' ? (
            <>
              <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} style={{ background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', padding: '4px 6px', fontSize: 12, color: 'var(--text2)', fontFamily: 'inherit', outline: 'none' }} />
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>to</span>
              <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} style={{ background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', padding: '4px 6px', fontSize: 12, color: 'var(--text2)', fontFamily: 'inherit', outline: 'none' }} />
              <button onClick={() => fetchData(false)} disabled={!customFrom || !customTo} style={{ padding: '4px 10px', background: 'var(--accent-bg)', color: 'var(--accent-fg)', border: 'none', borderRadius: 'var(--radius-sm)', fontSize: 12, cursor: !customFrom || !customTo ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: !customFrom || !customTo ? 0.5 : 1 }}>Apply</button>
            </>
          ) : (
            <button onClick={() => fetchData(false)} style={{ padding: '4px 10px', background: 'var(--accent-bg)', color: 'var(--accent-fg)', border: 'none', borderRadius: 'var(--radius-sm)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Apply</button>
          )}
        </div>}

        {!dashboard?.superset_embed_uuid && <>{/* Refresh selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" style={{ color: 'var(--text3)' }}>
            <circle cx="6" cy="6" r="5"/><path d="M6 3.5v3l2 1.5"/>
          </svg>
          <select value={dashboard.refresh_sec} onChange={e => updateDashboard({ refresh_sec: Number(e.target.value) })}
            style={{ background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', padding: '4px 8px', fontSize: 12, color: 'var(--text2)', fontFamily: 'inherit', cursor: 'pointer', outline: 'none' }}>
            {REFRESH_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        {lastFetch && (
          <span style={{ fontSize: 11, color: 'var(--text4)' }}>
            Updated {lastFetch.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        )}

        <button onClick={() => fetchData(true)} disabled={refreshing}
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-pill)', fontSize: 12, color: 'var(--text2)', cursor: refreshing ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: refreshing ? 0.6 : 1 }}>
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
            style={{ animation: refreshing ? 'spin .7s linear infinite' : 'none' }}>
            <path d="M10 5.5a4.5 4.5 0 1 1-1.3-3.1"/><path d="M10 1v3H7"/>
          </svg>
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>

        {isOwner && (
          <button onClick={() => { setEditingPanel(null); setShowBuilder(true) }}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', background: 'var(--accent-bg)', color: 'var(--accent-fg)', border: 'none', borderRadius: 'var(--radius-pill)', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', boxShadow: 'var(--shadow)' }}>
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><line x1="5.5" y1="1" x2="5.5" y2="10"/><line x1="1" y1="5.5" x2="10" y2="5.5"/></svg>
            Add panel
          </button>
        )}</>}
        <ThemeToggle />
      </div>

      {/* Panel builder drawer */}
      {showBuilder && (
        <PanelBuilder
          initial={editingPanel}
          onSave={savePanel}
          onCancel={() => { setShowBuilder(false); setEditingPanel(null) }}
        />
      )}

      {/* Dashboard grid or Superset embed */}
      {dashboard?.superset_embed_uuid ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {guestTokenLoading ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', fontSize: 13 }}>Loading dashboard...</div>
          ) : embedError ? (
            // A BYO Superset that can't be embedded (usually a local http Superset
            // blocked as mixed content on Mosaic's https page) gets the friendly
            // "opens in Superset" explainer with a diagram — this is the intended
            // Personal-edition behaviour, not a failure. Other embed errors (a
            // genuinely misconfigured bundled Superset) keep the plain notice.
            /mixed content|http:\/\//i.test(embedError) ? (
              <SupersetConnectDiagram
                supersetUrl={supersetStatus?.url}
                onOpen={() => {}}
              />
            ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, textAlign: 'center' }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text4)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text2)' }}>Dashboard can&rsquo;t be embedded</div>
              <div style={{ fontSize: 12.5, color: 'var(--text3)', lineHeight: 1.6, maxWidth: 440 }}>{embedError}</div>
              {supersetStatus?.url && (
                <a href={supersetStatus.url} target="_blank" rel="noopener noreferrer"
                  style={{ marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 999, border: '1px solid var(--border2)', background: 'var(--bg)', fontSize: 12.5, fontWeight: 500, color: 'var(--text)', textDecoration: 'none' }}>
                  Open in Superset
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6M10 14L21 3"/></svg>
                </a>
              )}
            </div>
            )
          ) : guestToken && supersetStatus?.url ? (
            <SupersetEmbed
              embedUuid={dashboard.superset_embed_uuid!}
              guestToken={guestToken}
              supersetUrl={supersetStatus.url}
              onError={(msg) => setEmbedError(msg)}
            />
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', fontSize: 13 }}>Failed to load dashboard</div>
          )}
        </div>
      ) : (
      <div style={{ flex: 1, padding: '20px 24px', overflowY: 'auto' }}>
        {panels.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 400, gap: 12 }}>
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ color: 'var(--text4)' }}>
              <rect x="4" y="20" width="12" height="24" rx="2"/><rect x="18" y="12" width="12" height="32" rx="2"/><rect x="32" y="4" width="12" height="40" rx="2"/>
            </svg>
            <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text2)' }}>No panels yet</div>
            <div style={{ fontSize: 13, color: 'var(--text3)' }}>Add a panel to start visualising your data.</div>
            {isOwner && (
              <button onClick={() => setShowBuilder(true)}
                style={{ marginTop: 8, padding: '8px 20px', background: 'var(--accent-bg)', color: 'var(--accent-fg)', border: 'none', borderRadius: 'var(--radius-pill)', fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>
                Add first panel
              </button>
            )}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, alignItems: 'start' }} data-panel-grid>
            {panels.map(panel => (
              <PanelChart
                key={panel.id}
                panel={panel}
                result={results[panel.id]}
                isOwner={isOwner}
                onEdit={() => { setEditingPanel(panel); setShowBuilder(true) }}
                onDelete={() => deletePanel(panel.id, panel.title)}
                onResizeStart={(e: React.MouseEvent) => {
                  const grid = e.currentTarget.closest('[data-panel-grid]') as HTMLElement
                  if (!grid) return
                  const colW = grid.getBoundingClientRect().width / 4
                  const card = e.currentTarget.closest('[data-panel-id]') as HTMLElement
                  const rowH = card ? card.getBoundingClientRect().height : 200
                  startResize(e, panel.id, panel.w, panel.h, colW, rowH)
                }}
                onRefresh={() => {
                  // Refresh just this panel
                  fetch(`/api/dashboards/${id}/data?time_window=${timeWindow === 'custom' && customFrom && customTo ? 'custom&time_from=' + encodeURIComponent(customFrom + 'T00:00:00') + '&time_to=' + encodeURIComponent(customTo + 'T23:59:59') : timeWindow}`)
                    .then(r => r.json())
                    .then(d => {
                      const r = (d.results || []).find((x: PanelResult) => x.panel_id === panel.id)
                      if (r) setResults(p => ({ ...p, [panel.id]: r }))
                    })
                }}
              />
            ))}
          </div>
        )}
      </div>

      )}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: 'var(--text)', color: 'var(--bg)', padding: '9px 18px', borderRadius: 'var(--radius-pill)', fontSize: 13, fontWeight: 500, boxShadow: 'var(--shadow-lg)', zIndex: 999 }}>{toast}</div>
      )}
    </div>
  )
}
