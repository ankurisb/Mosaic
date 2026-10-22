'use client'
import React from 'react'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import type { SessionUser } from '@/lib/auth'
import ThemeToggle from '@/components/ThemeToggle'
import PanelChart from './PanelChart'
import PanelBuilder from './PanelBuilder'
import DashboardChatDock from './DashboardChatDock'
import { SupersetEmbed } from './SupersetEmbed'
import { SupersetConnectDiagram } from './SupersetConnectDiagram'
import { useSuperset } from './useSuperset'
import { allowedGrains, defaultGrain, windowMsFor, GRAIN_LABEL } from '@/lib/dashboard-grain'
import { MAX_OVERLAY_ENTITIES } from '@/lib/dashboard-entity'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy, arrayMove, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

// Wraps a PanelChart as a dnd-kit sortable item: the card is the drag node, the header grip
// (dragListeners) is the handle, and the grid reflows as items reorder.
function SortablePanel(props: React.ComponentProps<typeof PanelChart>) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.panel.id })
  return <PanelChart {...props}
    sortableRef={setNodeRef}
    sortableStyle={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 20 : undefined }}
    sortableAttributes={attributes as unknown as Record<string, unknown>}
    dragListeners={props.isOwner ? (listeners as unknown as Record<string, unknown>) : undefined}
    isDragging={isDragging} />
}

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
  { label: "Last 90d", value: "90d" },
  { label: "Last 1y", value: "1y" },
  { label: "All time", value: "all" },
  { label: "Custom range…", value: "custom" },
]
const REFRESH_OPTS = [
  { label: 'Manual', value: 0 }, { label: '1 min', value: 60 },
  { label: '5 min', value: 300 }, { label: '15 min', value: 900 },
  { label: '1 hour', value: 3600 }, { label: '1 day', value: 86400 },
]

// -- Panel resize hook -----------------------------------------
// Panels live on a 12-column grid, so width snaps in 1/12ths (quarter = 3,
// third = 4, half = 6, full = 12) — far finer than the old 4-column grid.
// `onLive` paints the new size during the drag so resizing feels continuous
// instead of jumping only on release.
const GRID_COLS = 12
const MAX_ROWS = 3
function useResizePanel(
  onResize: (id: string, w: number, h: number) => void,
  onLive?: (id: string, w: number, h: number) => void,
) {
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
      const newW = Math.max(1, Math.min(GRID_COLS, stateRef.current.startW + Math.round(dx / stateRef.current.colW)))
      const newH = Math.max(1, Math.min(MAX_ROWS, stateRef.current.startH + Math.round(dy / (stateRef.current.rowH * 0.5))))
      if (newW !== stateRef.current.curW || newH !== stateRef.current.curH) {
        stateRef.current.curW = newW
        stateRef.current.curH = newH
        onLive?.(stateRef.current.id, newW, newH)
      }
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
  }, [onResize, onLive])

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
  // Right-side dock: closed | AI chat | manual panel editor. The panel editor and
  // the AI chat share one full-height pane (toggle between them).
  const [rightMode, setRightMode] = useState<'closed' | 'chat' | 'edit'>('closed')
  const [editingPanel, setEditingPanel] = useState<Panel | null>(null)
  const openEdit = (panel: Panel | null) => { setEditingPanel(panel); setRightMode('edit') }
  // Drag-to-reorder panels (dnd-kit sortable). A small activation distance so clicking the
  // header buttons doesn't start a drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    setPanels(prev => {
      const oldI = prev.findIndex(p => p.id === active.id)
      const newI = prev.findIndex(p => p.id === over.id)
      if (oldI < 0 || newI < 0) return prev
      const arr = arrayMove(prev, oldI, newI)
      fetch('/api/dashboards', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reorder_panels', panels: arr.map(p => ({ id: p.id, col: p.col, row: p.row, w: p.w, h: p.h })) }) }).catch(() => {})
      return arr
    })
  }
  const [timeWindow, setTimeWindow] = useState('today')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo,   setCustomTo]   = useState('')
  const [grain, setGrain] = useState<string>(() => defaultGrain(windowMsFor('today')))
  // Entity/device filter (Phase 9). Populated from /entities when the dashboard is bound.
  const [entityBound, setEntityBound] = useState(false)
  const [entityOpts, setEntityOpts] = useState<{ id: string; label: string }[]>([])
  // id → device label, so overlay chart legends/tooltips show meter names, not raw ids.
  const entityLabelMap = React.useMemo(() => Object.fromEntries(entityOpts.map(e => [e.id, e.label])), [entityOpts])
  const [selectedEntities, setSelectedEntities] = useState<string[]>([])
  const [entityOpen, setEntityOpen] = useState(false)
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

  // Current window kept in a ref so fetchData stays STABLE across window/date
  // changes. Previously fetchData depended on timeWindow/customFrom/customTo, so
  // every date keystroke re-created it and re-ran the structure-load effect
  // (which calls setLoading(true)) — blanking the whole page. Now only the data
  // refetches; the header/grid stay mounted.
  const windowRef = useRef({ timeWindow, customFrom, customTo, grain, selectedEntities })
  windowRef.current = { timeWindow, customFrom, customTo, grain, selectedEntities }

  // Per-user device selection persists across refresh in localStorage, keyed by dashboard.
  const entityLsKey = `mosaic.dash.${id}.entities`
  // Load the entity filter options once per dashboard (if bound). The selection is restored
  // from localStorage (this user's last pick) and falls back to the dashboard's entity_config
  // default (the device the builder chose), then the first device.
  useEffect(() => {
    let alive = true
    fetch(`/api/dashboards/${id}/entities`)
      .then(r => r.ok ? r.json() : { bound: false })
      .then((d: { bound?: boolean; entities?: { id: string; label: string }[]; default?: string[] }) => {
        if (!alive || !d.bound) return
        setEntityBound(true)
        const opts = d.entities || []
        setEntityOpts(opts)
        let saved: string[] = []
        try { const raw = localStorage.getItem(entityLsKey); if (raw) saved = JSON.parse(raw) } catch { /* private mode / disabled */ }
        const valid = Array.isArray(saved) ? saved.filter(idv => opts.some(o => o.id === idv)).slice(0, MAX_OVERLAY_ENTITIES) : []
        setSelectedEntities(prev => prev.length ? prev : (valid.length ? valid : (d.default || (opts[0] ? [opts[0].id] : []))))
      })
      .catch(() => {})
    return () => { alive = false }
  }, [id, entityLsKey])

  // Persist the device selection whenever it changes (best-effort; survives refresh).
  useEffect(() => {
    if (!entityBound) return
    try { localStorage.setItem(entityLsKey, JSON.stringify(selectedEntities)) } catch { /* ignore */ }
  }, [selectedEntities, entityBound, entityLsKey])

  const fetchData = useCallback(async (showSpinner = true) => {
    if (showSpinner) setRefreshing(true)
    try {
      const { timeWindow: tw0, customFrom: cf, customTo: ct, grain: g, selectedEntities: ents } = windowRef.current
      const tw = tw0 === 'custom' && cf && ct
        ? `custom&time_from=${encodeURIComponent(cf + 'T00:00:00')}&time_to=${encodeURIComponent(ct + 'T23:59:59')}`
        : tw0
      const entParam = ents && ents.length ? `&entity=${ents.map(encodeURIComponent).join(',')}` : ''
      const r = await fetch(`/api/dashboards/${id}/data?time_window=${tw}${g ? `&grain=${g}` : ''}${entParam}`)
      const d = await r.json()
      const map: Record<string, PanelResult> = {}
      for (const res of (d.results || [])) map[res.panel_id] = res
      setResults(map)
      setLastFetch(new Date())
    } finally { setRefreshing(false) }
  }, [id])

  // Reload structure + data after the AI dock changes the dashboard (add/edit/remove).
  const reloadAfterEdit = useCallback(() => { loadStructure(); fetchData(false) }, [loadStructure, fetchData])

  // Load STRUCTURE once per dashboard (not on window changes). This is the only
  // place `loading` (full-page) is toggled, so changing the time window never
  // blanks the page — only the panels refresh (via the effect below).
  const appliedDefaultWindow = useRef(false)
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    loadStructure().then(dash => {
      if (cancelled) return
      if (!dash) { setLoading(false); return }
      const KNOWN = ['today','15m','1h','6h','24h','7d','30d','90d','1y','all']
      if (!appliedDefaultWindow.current) {
        appliedDefaultWindow.current = true
        const dw = dash.default_time_window as string | undefined
        if (dw && KNOWN.includes(dw) && dw !== windowRef.current.timeWindow) setTimeWindow(dw)
      }
      if (dash.superset_embed_uuid && supersetStatus?.configured) fetchGuestToken(id)
      if (dash.refresh_sec > 0) timerRef.current = setInterval(() => fetchData(false), dash.refresh_sec * 1000)
      setLoading(false)   // structure ready → header + grid stay; panel data loads below
    })
    return () => { cancelled = true; if (timerRef.current) clearInterval(timerRef.current) }
  }, [id, loadStructure, supersetStatus?.configured, fetchData])

  // Refetch panel data when the PRESET window changes. Custom ranges fetch only on
  // Apply (so typing dates doesn't refetch), and this never toggles `loading`.
  useEffect(() => {
    if (dashboard?.superset_embed_uuid) return
    if (timeWindow === 'custom') return
    fetchData(true)
  }, [id, timeWindow, grain, selectedEntities, dashboard?.superset_embed_uuid, fetchData])

  // Reset timer when refresh_sec changes
  const resetTimer = (sec: number) => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (sec > 0) timerRef.current = setInterval(() => fetchData(false), sec * 1000)
  }

  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 2500); return () => clearTimeout(t) } }, [toast])

  // -- Panel CRUD ------------------------------------------------
  const { start: startResize } = useResizePanel(
    // Commit on release: geometry-only update (title/query absent → the API leaves
    // the panel's content intact and touches only w/h).
    async (panelId, newW, newH) => {
      setPanels(p => p.map(x => x.id === panelId ? { ...x, w: newW, h: newH } : x))
      await fetch('/api/dashboards', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_panel', id: panelId, w: newW, h: newH }),
      })
    },
    // Live preview during the drag so the panel grows/shrinks continuously.
    (panelId, newW, newH) => setPanels(p => p.map(x => x.id === panelId ? { ...x, w: newW, h: newH } : x)),
  )

  async function savePanel(data: Omit<Panel, 'id'> & { id?: string }) {
    const action = data.id ? 'update_panel' : 'add_panel'
    await fetch('/api/dashboards', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, dashboard_id: id, ...data }),
    })
    setRightMode('closed'); setEditingPanel(null)
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
    <div style={{ height: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
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
          <select value={timeWindow} onChange={e => { const v = e.target.value; setTimeWindow(v); setGrain(defaultGrain(windowMsFor(v, customFrom, customTo))) }}
            style={{ background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', padding: '4px 8px', fontSize: 12, color: 'var(--text2)', fontFamily: 'inherit', cursor: 'pointer', outline: 'none' }}>
            {TIME_WINDOW_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {/* Aggregation grain — options constrained to what the window allows. A bar
             icon marks it as "aggregate every N", distinct from the refresh (clock) control. */}
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" style={{ color: 'var(--text3)', marginLeft: 2 }} aria-label="Aggregation"><path d="M2 10V6M6 10V2M10 10V7"/></svg>
          <select value={grain} onChange={e => setGrain(e.target.value)} title="Aggregation interval — bucket size the data is rolled up to (limited to what the time range supports)"
            style={{ background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', padding: '4px 8px', fontSize: 12, color: 'var(--text2)', fontFamily: 'inherit', cursor: 'pointer', outline: 'none' }}>
            {allowedGrains(windowMsFor(timeWindow, customFrom, customTo)).map(g => <option key={g} value={g}>{GRAIN_LABEL[g]}</option>)}
          </select>
          {/* Device/entity filter (only when the dashboard is bound to a multi-entity source) */}
          {entityBound && (
            <div style={{ position: 'relative' }}>
              <button onClick={() => setEntityOpen(o => !o)} title="Choose which device(s) the panels show"
                style={{ background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', padding: '4px 8px', fontSize: 12, color: 'var(--text2)', fontFamily: 'inherit', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, width: 170, flexShrink: 0, whiteSpace: 'nowrap', overflow: 'hidden' }}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" style={{ flexShrink: 0 }}><rect x="1.5" y="2" width="9" height="6" rx="1"/><path d="M4 10h4"/></svg>
                {/* Fixed width + ellipsis so changing the label doesn't reflow the Apply button. */}
                <span style={{ flex: 1, minWidth: 0, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {selectedEntities.length === 0 ? 'Device: none'
                    : selectedEntities.length === 1 ? `Device: ${entityOpts.find(e => e.id === selectedEntities[0])?.label || '1'}`
                    : `Devices: ${selectedEntities.length}`}
                </span>
                <span style={{ color: 'var(--text4)', flexShrink: 0 }}>▾</span>
              </button>
              {entityOpen && (
                <div style={{ position: 'absolute', top: '110%', left: 0, zIndex: 50, background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', boxShadow: 'var(--shadow-lg)', padding: 6, minWidth: 220, maxHeight: 280, overflowY: 'auto' }}>
                  {entityOpts.length === 0 && <div style={{ fontSize: 11, color: 'var(--text4)', padding: 6 }}>No devices found.</div>}
                  {entityOpts.map(e => {
                    const on = selectedEntities.includes(e.id)
                    const atCap = !on && selectedEntities.length >= MAX_OVERLAY_ENTITIES
                    return (
                      <label key={e.id} title={atCap ? `Maximum ${MAX_OVERLAY_ENTITIES} devices — deselect one to add another` : undefined}
                        style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 6px', fontSize: 12, color: atCap ? 'var(--text4)' : 'var(--text2)', cursor: atCap ? 'not-allowed' : 'pointer', borderRadius: 4 }}>
                        <input type="checkbox" checked={on} disabled={atCap} onChange={() => setSelectedEntities(prev => {
                          if (on) return prev.filter(x => x !== e.id)
                          if (prev.length >= MAX_OVERLAY_ENTITIES) return prev   // overlay cap
                          return [...prev, e.id]
                        })} style={{ cursor: atCap ? 'not-allowed' : 'pointer' }} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.label}</span>
                      </label>
                    )
                  })}
                  {entityOpts.length > 0 && <div style={{ fontSize: 10, color: 'var(--text4)', padding: '4px 6px 2px' }}>{selectedEntities.length >= MAX_OVERLAY_ENTITIES ? `Maximum ${MAX_OVERLAY_ENTITIES} selected — deselect to add another.` : `Overlay up to ${MAX_OVERLAY_ENTITIES} devices (${selectedEntities.length} selected).`}</div>}
                </div>
              )}
            </div>
          )}
          {timeWindow === 'custom' ? (
            <>
              <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} style={{ background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', padding: '4px 6px', fontSize: 12, color: 'var(--text2)', fontFamily: 'inherit', outline: 'none' }} />
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>to</span>
              <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} style={{ background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', padding: '4px 6px', fontSize: 12, color: 'var(--text2)', fontFamily: 'inherit', outline: 'none' }} />
              <button onClick={() => { setGrain(defaultGrain(windowMsFor('custom', customFrom, customTo))); fetchData(true) }} disabled={!customFrom || !customTo} style={{ padding: '4px 10px', background: 'var(--accent-bg)', color: 'var(--accent-fg)', border: 'none', borderRadius: 'var(--radius-sm)', fontSize: 12, cursor: !customFrom || !customTo ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: !customFrom || !customTo ? 0.5 : 1 }}>Apply</button>
            </>
          ) : (
            <button onClick={() => fetchData(true)} style={{ padding: '4px 10px', background: 'var(--accent-bg)', color: 'var(--accent-fg)', border: 'none', borderRadius: 'var(--radius-sm)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Apply</button>
          )}
        </div>}

        {!dashboard?.superset_embed_uuid && <>{/* Refresh selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" style={{ color: 'var(--text3)' }}>
            <circle cx="6" cy="6" r="5"/><path d="M6 3.5v3l2 1.5"/>
          </svg>
          <select value={dashboard.refresh_sec} onChange={e => updateDashboard({ refresh_sec: Number(e.target.value) })} title="Auto-refresh interval — how often the dashboard re-queries live data (not an aggregation)"
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

        {isOwner && !dashboard?.superset_embed_uuid && (
          <button onClick={() => setRightMode(m => m === 'chat' ? 'closed' : 'chat')} title="Evolve this dashboard with AI"
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', background: rightMode === 'chat' ? 'var(--accent-bg)' : 'var(--bg)', color: rightMode === 'chat' ? 'var(--accent-fg)' : 'var(--text2)', border: rightMode === 'chat' ? 'none' : '1px solid var(--border2)', borderRadius: 'var(--radius-pill)', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15.5 10.1 10.9 5.5 9l4.6-1.4L12 3z"/></svg>
            Edit with AI
          </button>
        )}
        {isOwner && (
          <button onClick={() => openEdit(null)}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', background: rightMode === 'edit' && !editingPanel ? 'var(--accent-bg)' : 'var(--bg)', color: rightMode === 'edit' && !editingPanel ? 'var(--accent-fg)' : 'var(--text2)', border: rightMode === 'edit' && !editingPanel ? 'none' : '1px solid var(--border2)', borderRadius: 'var(--radius-pill)', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><line x1="5.5" y1="1" x2="5.5" y2="10"/><line x1="1" y1="5.5" x2="10" y2="5.5"/></svg>
            Add panel
          </button>
        )}</>}
        <ThemeToggle />
      </div>


      {/* Dashboard grid or Superset embed (+ AI chat dock) */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
      {dashboard?.superset_embed_uuid ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {guestTokenLoading ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', fontSize: 13 }}>Loading dashboard...</div>
          ) : (typeof window !== 'undefined' && window.location.protocol === 'https:' && /^http:\/\//i.test(supersetStatus?.url || '')) ? (
            // Synchronous mixed-content short-circuit: Mosaic is on https but the
            // (BYO) Superset URL is http, so the browser would block the embed.
            // Show the Personal-edition "opens in Superset" explainer directly —
            // don't even attempt the embed. This is the intended behaviour, not a
            // failure. (Checked here rather than via the embed SDK's async error so
            // it never falls through to a bare "Failed to load".)
            <SupersetConnectDiagram supersetUrl={supersetStatus?.url} onOpen={() => {}} />
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
              <button onClick={() => openEdit(null)}
                style={{ marginTop: 8, padding: '8px 20px', background: 'var(--accent-bg)', color: 'var(--accent-fg)', border: 'none', borderRadius: 'var(--radius-pill)', fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>
                Add first panel
              </button>
            )}
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={panels.map(p => p.id)} strategy={rectSortingStrategy}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 14, alignItems: 'start' }} data-panel-grid>
            {panels.map(panel => (
              <SortablePanel
                key={panel.id}
                panel={panel}
                result={results[panel.id]}
                isOwner={isOwner}
                seriesLabels={entityLabelMap}
                onEdit={() => openEdit(panel)}
                onDelete={() => deletePanel(panel.id, panel.title)}
                onResizeStart={(e: React.MouseEvent) => {
                  const grid = e.currentTarget.closest('[data-panel-grid]') as HTMLElement
                  if (!grid) return
                  const colW = grid.getBoundingClientRect().width / 12
                  const card = e.currentTarget.closest('[data-panel-id]') as HTMLElement
                  const rowH = card ? card.getBoundingClientRect().height : 200
                  startResize(e, panel.id, panel.w, panel.h, colW, rowH)
                }}
                onRefresh={() => {
                  // Refresh just this panel
                  fetch(`/api/dashboards/${id}/data?time_window=${timeWindow === 'custom' && customFrom && customTo ? 'custom&time_from=' + encodeURIComponent(customFrom + 'T00:00:00') + '&time_to=' + encodeURIComponent(customTo + 'T23:59:59') : timeWindow}${grain ? `&grain=${grain}` : ''}${selectedEntities.length ? `&entity=${selectedEntities.map(encodeURIComponent).join(',')}` : ''}`)
                    .then(r => r.json())
                    .then(d => {
                      const r = (d.results || []).find((x: PanelResult) => x.panel_id === panel.id)
                      if (r) setResults(p => ({ ...p, [panel.id]: r }))
                    })
                }}
              />
            ))}
          </div>
          </SortableContext>
          </DndContext>
        )}
      </div>

      )}
        </div>
        {isOwner && rightMode !== 'closed' && !dashboard?.superset_embed_uuid && (
          <div style={{ width: 400, flexShrink: 0, borderLeft: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Shared pane header — toggle between AI chat and the manual panel editor */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              <button onClick={() => setRightMode('chat')}
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 'var(--radius-pill)', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, background: rightMode === 'chat' ? 'var(--accent-bg)' : 'transparent', color: rightMode === 'chat' ? 'var(--accent-fg)' : 'var(--text3)' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15.5 10.1 10.9 5.5 9l4.6-1.4L12 3z"/></svg>
                Edit with AI
              </button>
              <button onClick={() => openEdit(editingPanel)}
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 'var(--radius-pill)', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, background: rightMode === 'edit' ? 'var(--accent-bg)' : 'transparent', color: rightMode === 'edit' ? 'var(--accent-fg)' : 'var(--text3)' }}>
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M7.5 1.5l2 2-6 6-2.5.5.5-2.5z"/></svg>
                {editingPanel ? 'Edit panel' : 'Add panel'}
              </button>
              <div style={{ flex: 1 }} />
              <button onClick={() => { setRightMode('closed'); setEditingPanel(null) }} title="Close"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 18, lineHeight: 1 }}>×</button>
            </div>
            {rightMode === 'chat'
              ? <DashboardChatDock dashboardId={id} onChanged={reloadAfterEdit} />
              : <PanelBuilder embedded initial={editingPanel} onSave={savePanel} onCancel={() => { setRightMode('closed'); setEditingPanel(null) }} />}
          </div>
        )}
      </div>
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: 'var(--text)', color: 'var(--bg)', padding: '9px 18px', borderRadius: 'var(--radius-pill)', fontSize: 13, fontWeight: 500, boxShadow: 'var(--shadow-lg)', zIndex: 999 }}>{toast}</div>
      )}
    </div>
  )
}
