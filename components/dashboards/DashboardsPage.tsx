'use client'
import AppShell from '@/components/AppShell'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import type { SessionUser } from '@/lib/auth'
import { SupersetLink } from './SupersetLink'
import { useSuperset } from './useSuperset'
import { safeJson } from '@/lib/fetch'

interface Dashboard {
  id: string; name: string; description: string
  owner_id: string; is_public: boolean; refresh_sec: number
  panel_count: number; updated_at: string; superset_embed_uuid?: string
  // Set when Mosaic BUILT this dashboard in Superset from a query.
  source_kind?: string | null; source_sql?: string | null
  source_connection?: string | null; superset_dashboard_id?: number | null
}

const REFRESH_OPTS = [
  { label: 'Manual',  value: 0 },
  { label: '1 min',   value: 60 },
  { label: '5 min',   value: 300 },
  { label: '15 min',  value: 900 },
  { label: '1 hour',  value: 3600 },
  { label: '1 day',   value: 86400 },
]

export default function DashboardsPage({ user }: { user: SessionUser }) {
  const router = useRouter()
  const isAdmin = user.role === 'admin'
  // Superset ("Mosaic Analytics") is an optional/Enterprise capability. When it
  // isn't configured (e.g. the desktop edition, which uses Mosaic's own built-in
  // dashboards), the whole external-analytics linking UI is hidden — no dangling
  // references to a Superset that isn't there.
  const { status: supersetStatus } = useSuperset()
  const supersetAvailable = !!supersetStatus?.configured
  const [dashboards, setDashboards] = useState<Dashboard[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedQuery, setExpandedQuery] = useState<string | null>(null)  // dashboard id whose SQL is shown
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', is_public: false, refresh_sec: 300 })
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500) }
  const [supersetDashboards, setSupersetDashboards] = useState<{id:number,title:string}[]>([])
  const [linkingId, setLinkingId] = useState<string|null>(null)
  const [linkLoading, setLinkLoading] = useState(false)

  useEffect(() => { load(); fetchSupersetDashboards() }, [])
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 2500); return () => clearTimeout(t) } }, [toast])

  async function fetchSupersetDashboards() {
    try {
      const r = await fetch('/api/superset/dashboards')
      const d = await r.json()
      setSupersetDashboards(d.dashboards || [])
    } catch {}
  }

  async function linkSuperset(mosaicId: string, supersetId: number) {
    setLinkLoading(true)
    try {
      const r = await fetch('/api/superset/embed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mosaic_dashboard_id: mosaicId, superset_dashboard_id: supersetId }),
      })
      const { data: d, error: err } = await safeJson<{ ok?: boolean; error?: string }>(r)
      if (err) { showToast('Failed to link: ' + err); return }
      if (d?.ok) { showToast('Superset dashboard linked'); setLinkingId(null); await load() }
      else showToast('Failed to link: ' + (d?.error || 'unknown error'))
    } catch (e) { showToast('Failed to link: ' + (e instanceof Error ? e.message : 'Network error')) }
    finally { setLinkLoading(false) }
  }

  async function unlinkSuperset(mosaicId: string) {
    await fetch('/api/superset/embed', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mosaic_dashboard_id: mosaicId }),
    })
    showToast('Superset dashboard unlinked')
    await load()
  }

  async function load() {
    setLoading(true)
    try {
      const r = await fetch('/api/dashboards')
      const d = await r.json()
      setDashboards(d.dashboards || [])
    } finally { setLoading(false) }
  }

  async function create() {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      const r = await fetch('/api/dashboards', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_dashboard', ...form }),
      })
      const { data: d, error: err } = await safeJson<{ id?: string }>(r)
      if (err) { showToast('Error: ' + err); return }
      if (d?.id) { router.push(`/dashboards/${d.id}`) }
    } catch (e) { showToast('Error: ' + (e instanceof Error ? e.message : 'Create failed')) }
    finally { setSaving(false) }
  }

  async function deleteDash(id: string, name: string) {
    if (!confirm(`Delete "${name}"?`)) return
    await fetch('/api/dashboards', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete_dashboard', id }),
    })
    setDashboards(p => p.filter(d => d.id !== id))
    setToast('Dashboard deleted')
  }

  const fmt = (sec: number) => REFRESH_OPTS.find(o => o.value === sec)?.label ?? `${sec}s`
  const timeAgo = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime()
    if (diff < 60000) return 'just now'
    if (diff < 3600000) return `${Math.floor(diff/60000)}m ago`
    if (diff < 86400000) return `${Math.floor(diff/3600000)}h ago`
    return `${Math.floor(diff/86400000)}d ago`
  }

  return (
    <AppShell user={user}>
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '0 32px', height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <button onClick={() => router.push('/')} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text2)', fontSize: 13, fontFamily: 'inherit', padding: 0 }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M9 2L4 7l5 5"/></svg>
            Chat
          </button>
          <div style={{ width: 1, height: 16, background: 'var(--border2)' }} />
          <span style={{ fontFamily: 'var(--font-serif)', fontSize: 15, color: 'var(--text)' }}>Dashboards</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>

        </div>
      </div>

      <div style={{ flex: 1, padding: '32px', maxWidth: 960, margin: '0 auto', width: '100%' }}>
        {/* Title row */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 26, fontWeight: 400, color: 'var(--text)', marginBottom: 4 }}>Analytics dashboards</h1>
            <p style={{ fontSize: 13, color: 'var(--text3)' }}>Self-service dashboards that query your connected data sources and auto-refresh.</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <SupersetLink />
            <button onClick={() => setShowForm(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', background: 'var(--accent-bg)', color: 'var(--accent-fg)', border: 'none', borderRadius: 'var(--radius-pill)', fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', boxShadow: 'var(--shadow)', flexShrink: 0 }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><line x1="6" y1="1" x2="6" y2="11"/><line x1="1" y1="6" x2="11" y2="6"/></svg>
            New dashboard
          </button>
          </div>
        </div>

        {/* Create form */}
        {showForm && (
          <div className="fade-in" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 20, marginBottom: 20, boxShadow: 'var(--shadow-md)' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 14 }}>New dashboard</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text2)', marginBottom: 5 }}>Name *</div>
                <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. OEE overview -- Line A"
                  style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', padding: '8px 11px', fontSize: 13, color: 'var(--text)', outline: 'none', fontFamily: 'inherit' }} />
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text2)', marginBottom: 5 }}>Auto-refresh</div>
                <select value={form.refresh_sec} onChange={e => setForm(p => ({ ...p, refresh_sec: Number(e.target.value) }))}
                  style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', padding: '8px 11px', fontSize: 13, color: 'var(--text)', outline: 'none', fontFamily: 'inherit', cursor: 'pointer' }}>
                  {REFRESH_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text2)', marginBottom: 5 }}>Description</div>
              <input value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                placeholder="What does this dashboard show?"
                style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', padding: '8px 11px', fontSize: 13, color: 'var(--text)', outline: 'none', fontFamily: 'inherit' }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text2)', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.is_public} onChange={e => setForm(p => ({ ...p, is_public: e.target.checked }))} />
                Visible to all users
              </label>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={create} disabled={saving || !form.name.trim()}
                style={{ padding: '8px 16px', background: 'var(--accent-bg)', color: 'var(--accent-fg)', border: 'none', borderRadius: 'var(--radius-pill)', fontSize: 13, fontWeight: 500, cursor: saving || !form.name.trim() ? 'not-allowed' : 'pointer', opacity: saving || !form.name.trim() ? 0.5 : 1, fontFamily: 'inherit' }}>
                {saving ? 'Creating...' : 'Create & open'}
              </button>
              <button onClick={() => setShowForm(false)} style={{ padding: '8px 16px', background: 'var(--surface)', color: 'var(--text2)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-pill)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
            </div>
          </div>
        )}

        {/* Dashboard grid */}
        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 60, color: 'var(--text3)', fontSize: 13 }}>Loading dashboards...</div>
        ) : dashboards.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.3 }}>
              <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ display: 'inline-block' }}>
                <rect x="4" y="20" width="12" height="24" rx="2"/><rect x="18" y="12" width="12" height="32" rx="2"/><rect x="32" y="4" width="12" height="40" rx="2"/>
              </svg>
            </div>
            <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text2)', marginBottom: 6 }}>No dashboards yet</div>
            <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 20 }}>Create your first dashboard to start visualising data from your connected sources.</div>
            <button onClick={() => setShowForm(true)} style={{ padding: '8px 20px', background: 'var(--accent-bg)', color: 'var(--accent-fg)', border: 'none', borderRadius: 'var(--radius-pill)', fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>Create dashboard</button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
            {dashboards.map(d => (
              <div key={d.id} className="fade-in"
                onClick={() => {
                  // Query-built dashboards live in Superset, not as an in-Mosaic embed —
                  // clicking the card body does nothing (use "open in Superset" / "view
                  // query"). Native/embedded dashboards open their Mosaic view.
                  if (d.source_kind === 'superset_query') return
                  router.push(`/dashboards/${d.id}`)
                }}
                style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '16px 18px', cursor: d.source_kind === 'superset_query' ? 'default' : 'pointer', boxShadow: 'var(--shadow)', transition: 'box-shadow .15s, transform .1s' }}
                onMouseEnter={e => { e.currentTarget.style.boxShadow = 'var(--shadow-md)'; e.currentTarget.style.transform = 'translateY(-1px)' }}
                onMouseLeave={e => { e.currentTarget.style.boxShadow = 'var(--shadow)'; e.currentTarget.style.transform = 'none' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', lineHeight: 1.4, flex: 1, marginRight: 8 }}>{d.name}</div>
                  <button onClick={e => { e.stopPropagation(); deleteDash(d.id, d.name) }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text4)', fontSize: 16, padding: '0 2px', lineHeight: 1, flexShrink: 0 }}></button>
                </div>
                {d.description && <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 10, lineHeight: 1.5 }}>{d.description}</div>}

                {/* Query-built dashboards (Mosaic authored the SQL, built it in Superset).
                    Show the connection, a toggle to view the SQL, and a direct link. */}
                {d.source_kind === 'superset_query' && (
                  <div onClick={e => e.stopPropagation()} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 'var(--radius-pill)', background: 'var(--bg3)', color: 'var(--text2)', border: '1px solid var(--border)' }}>
                        Built from query
                      </span>
                      {d.source_connection && (
                        <span style={{ fontSize: 11, color: 'var(--text3)' }}>on {d.source_connection}</span>
                      )}
                      {d.source_sql && (
                        <button
                          onClick={() => setExpandedQuery(expandedQuery === d.id ? null : d.id)}
                          style={{ fontSize: 11, color: 'var(--blue-t)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}
                        >
                          {expandedQuery === d.id ? 'hide query' : 'view query'}
                        </button>
                      )}
                      {supersetStatus?.url && d.superset_dashboard_id != null && (
                        <a
                          href={`${supersetStatus.url.replace(/\/$/, '')}/superset/dashboard/${d.superset_dashboard_id}/`}
                          target="_blank" rel="noopener noreferrer"
                          style={{ fontSize: 11, color: 'var(--blue-t)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3, marginLeft: 'auto' }}
                        >
                          open in Superset
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6M10 14L21 3"/></svg>
                        </a>
                      )}
                    </div>
                    {expandedQuery === d.id && d.source_sql && (
                      <pre style={{ marginTop: 8, padding: '8px 10px', background: 'var(--bg3)', borderRadius: 'var(--radius-sm)', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text2)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 140, overflow: 'auto' }}>{d.source_sql}</pre>
                    )}
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, color: 'var(--text3)' }}>
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" style={{ marginRight: 3, verticalAlign: 'middle' }}><rect x="1" y="2" width="4" height="3" rx=".5"/><rect x="5.5" y="5" width="3.5" height="3" rx=".5"/><rect x="1" y="6" width="3" height="2" rx=".5"/></svg>
                    {d.panel_count} panel{d.panel_count !== 1 ? 's' : ''}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text3)' }}>
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" style={{ marginRight: 3, verticalAlign: 'middle' }}><circle cx="5" cy="5" r="4"/><path d="M5 3v2.5l1.5 1"/></svg>
                    {fmt(d.refresh_sec)}
                  </span>
                  {d.is_public && (
                    <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 'var(--radius-pill)', background: 'var(--blue-bg)', color: 'var(--blue-t)', border: '1px solid rgba(37,99,235,.2)' }}>Public</span>
                  )}
                  <span style={{ fontSize: 11, color: 'var(--text4)', marginLeft: 'auto' }}>{timeAgo(d.updated_at)}</span>
                </div>

                {/* Superset link row — only for native/embed dashboards, not query-built
                    ones (those already live in Superset). */}
                {supersetAvailable && d.source_kind !== 'superset_query' && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }} onClick={e => e.stopPropagation()}>
                  {d.superset_embed_uuid ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 11, color: 'var(--text3)' }}>
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" style={{ marginRight: 3, verticalAlign: 'middle', color: 'var(--green)' }}><polyline points="1.5 5 4 7.5 8.5 2.5"/></svg>
                        Mosaic Analytics linked
                      </span>
                      {isAdmin && (
                        <button onClick={() => unlinkSuperset(d.id)} style={{ fontSize: 10, color: 'var(--text4)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>unlink</button>
                      )}
                    </div>
                  ) : isAdmin ? (
                    linkingId === d.id ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
                        <select
                          style={{ flex: 1, background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', padding: '3px 6px', fontSize: 11, color: 'var(--text)', fontFamily: 'inherit', outline: 'none' }}
                          defaultValue=""
                          onChange={e => { if (e.target.value) linkSuperset(d.id, Number(e.target.value)) }}
                          disabled={linkLoading}
                        >
                          <option value="" disabled>{linkLoading ? 'Linking...' : 'Select Superset dashboard'}</option>
                          {supersetDashboards.map(s => (
                            <option key={s.id} value={s.id}>{s.title}</option>
                          ))}
                        </select>
                        <button onClick={() => setLinkingId(null)} style={{ fontSize: 10, color: 'var(--text4)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>cancel</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setLinkingId(d.id); if (supersetDashboards.length === 0) fetchSupersetDashboards() }}
                        style={{ fontSize: 11, color: 'var(--text3)', background: 'none', border: '1px dashed var(--border2)', borderRadius: 'var(--radius-sm)', padding: '2px 8px', cursor: 'pointer', fontFamily: 'inherit' }}
                      >
                        + Link Mosaic Analytics
                      </button>
                    )
                  ) : null}
                </div>
                )}

              </div>
            ))}
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: 'var(--text)', color: 'var(--bg)', padding: '9px 18px', borderRadius: 'var(--radius-pill)', fontSize: 13, fontWeight: 500, boxShadow: 'var(--shadow-lg)', zIndex: 999 }}>{toast}</div>
      )}
    </div>
    </AppShell>
  )
}
