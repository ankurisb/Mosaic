'use client'
import React, { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { SessionUser } from '@/lib/auth'

type Tab = 'library' | 'templates' | 'history'

function fmtDate(s: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function fmtSize(bytes: number | null) {
  if (!bytes) return '—'
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    completed: ['#f0fdf4', '#16a34a'],
    pending:   ['#fffbeb', '#d97706'],
    failed:    ['#fef2f2', '#dc2626'],
    running:   ['#eff6ff', '#2563eb'],
  }
  const [bg, fg] = map[status] || ['var(--bg3)', 'var(--text3)']
  return <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 600, background: bg, color: fg }}>{status}</span>
}

function TypeBadge({ type }: { type: string }) {
  const map: Record<string, string> = { rca: '#7c3aed', operational: '#2563eb', maintenance: '#dc2626', scheduled: '#059669' }
  const color = map[type] || '#6366f1'
  return <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 600, background: color + '18', color, border: `1px solid ${color}30` }}>{type}</span>
}

export default function ReportsPage({ user }: { user: SessionUser }) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('library')
  const [library, setLibrary] = useState<Record<string,unknown>[]>([])
  const [templates, setTemplates] = useState<Record<string,unknown>[]>([])
  const [history, setHistory] = useState<Record<string,unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showNewTemplate, setShowNewTemplate] = useState(false)
  const [newTemplate, setNewTemplate] = useState({ name: '', description: '', type: 'operational', schedule: '', recipients: '' })
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState<string | null>(null)

  const isAdmin = user.role === 'admin'

  const load = useCallback(async (t: Tab) => {
    setLoading(true)
    try {
      const r = await fetch(`/api/reports?type=${t === 'library' ? 'instances' : t}`)
      const d = await r.json()
      if (t === 'library') setLibrary(d.instances || [])
      else if (t === 'templates') setTemplates(d.templates || [])
      else setHistory(d.history || [])
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load(tab) }, [tab, load])

  async function deleteTemplate(id: string) {
    if (!confirm('Delete this template?')) return
    await fetch('/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete_template', id }) })
    load('templates')
  }

  async function saveTemplate() {
    if (!newTemplate.name) return
    setSaving(true)
    try {
      await fetch('/api/reports', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_template',
          name: newTemplate.name,
          description: newTemplate.description,
          type: newTemplate.type,
          schedule: newTemplate.schedule || null,
          recipients: newTemplate.recipients.split(',').map(r => r.trim()).filter(Boolean),
        })
      })
      setShowNewTemplate(false)
      setNewTemplate({ name: '', description: '', type: 'operational', schedule: '', recipients: '' })
      load('templates')
    } finally { setSaving(false) }
  }

  async function runTemplate(id: string, name: string) {
    setRunning(id)
    try {
      const res = await fetch('/api/reports/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template_id: id }),
      })
      const d = await res.json()
      if (!res.ok || d.error) { alert(d.error || 'Failed to generate report'); return }
      alert(`Report "${name}" generated successfully`)
      load('library')
      setTab('library')
    } catch (e) { alert('Failed to generate report') }
    finally { setRunning(null) }
  }

  const INP: React.CSSProperties = { width: '100%', padding: '7px 10px', border: '1.5px solid var(--border2)', borderRadius: 7, fontSize: 13, background: 'var(--bg)', color: 'var(--text)', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }

  const filteredLibrary = library.filter(r => !search || String(r.name).toLowerCase().includes(search.toLowerCase()))
  const filteredHistory = history.filter(r => !search || String(r.name).toLowerCase().includes(search.toLowerCase()) || String(r.trigger).toLowerCase().includes(search.toLowerCase()))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg)' }}>
      {/* Header */}
      <div style={{ padding: '20px 28px 0', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <button onClick={() => router.push('/')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'inherit', padding: 0 }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M8 2L4 6l4 4"/></svg>
            Back to chat
          </button>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Reports</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 0 }}>
          <div style={{ display: 'flex', gap: 0 }}>
            {(['library', 'templates', 'history'] as Tab[]).map(t => (
              <button key={t} onClick={() => setTab(t)}
                style={{ padding: '10px 18px', background: 'none', border: 'none', borderBottom: tab === t ? '2px solid var(--blue)' : '2px solid transparent', cursor: 'pointer', fontSize: 13, fontWeight: tab === t ? 600 : 400, color: tab === t ? 'var(--blue-t)' : 'var(--text3)', fontFamily: 'inherit', textTransform: 'capitalize' }}>
                {t === 'library' ? 'Report library' : t === 'templates' ? 'Templates' : 'History'}
              </button>
            ))}
          </div>
          {isAdmin && tab === 'templates' && (
            <button onClick={() => router.push('/reports/template/new')}
              style={{ padding: '7px 14px', borderRadius: 999, border: 'none', background: 'var(--blue)', color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              + New template
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>

        {/* Search */}
        {(tab === 'library' || tab === 'history') && (
          <input placeholder={tab === 'library' ? 'Search reports...' : 'Search history...'}
            value={search} onChange={e => setSearch(e.target.value)}
            style={{ ...INP, marginBottom: 16 }} />
        )}

        {loading && <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>Loading…</div>}

        {/* Library */}
        {!loading && tab === 'library' && (
          filteredLibrary.length === 0
            ? <div style={{ padding: '40px 20px', textAlign: 'center', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text3)', fontSize: 13 }}>
                No reports generated yet. Export an RCA from chat to create your first report.
              </div>
            : <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {filteredLibrary.map(r => (
                  <div key={String(r.id)} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: 'var(--shadow)' }}>
                    <div style={{ width: 36, height: 36, borderRadius: 8, background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="#2563eb" strokeWidth="1.5" strokeLinecap="round">
                        <path d="M4 2h7l4 4v10a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"/><path d="M11 2v4h4M6 9h6M6 12h4"/>
                      </svg>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 3 }}>{String(r.name)}</div>
                      <div style={{ fontSize: 11, color: 'var(--text3)', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                        <TypeBadge type={String(r.type)} />
                        <span>{fmtDate(String(r.generated_at))}</span>
                        {r.pdf_size && <span>{fmtSize(Number(r.pdf_size))}</span>}
                        {r.page_count && <span>{String(r.page_count)} pages</span>}
                        {r.triggered_by_name && <span>by {String(r.triggered_by_name)}</span>}
                      </div>
                    </div>
                    <StatusBadge status={String(r.status)} />
                    {r.pdf_path && (
                      <a href={`/api/reports/download?id=${r.id}`} download
                        style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid var(--border2)', background: 'var(--bg)', color: 'var(--text2)', fontSize: 12, cursor: 'pointer', textDecoration: 'none', fontFamily: 'inherit' }}>
                        Download
                      </a>
                    )}
                  </div>
                ))}
              </div>
        )}

        {/* Templates */}
        {!loading && tab === 'templates' && (
          templates.length === 0
            ? <div style={{ padding: '40px 20px', textAlign: 'center', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text3)', fontSize: 13 }}>
                No templates yet. Create one to schedule recurring reports.
              </div>
            : <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {templates.map(t => (
                  <div key={String(t.id)} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: 'var(--shadow)', opacity: t.active ? 1 : 0.6 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 3 }}>{String(t.name)}</div>
                      <div style={{ fontSize: 11, color: 'var(--text3)', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                        <TypeBadge type={String(t.type)} />
                        {t.schedule && <span>⏱ {String(t.schedule)}</span>}
                        {t.description && <span>{String(t.description)}</span>}
                      </div>
                    </div>
                    {isAdmin && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => router.push(`/reports/template/edit/${t.id}`)}
                          style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border2)', background: 'var(--bg)', color: 'var(--text2)', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>
                          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M8.5 1.5l2 2L4 10H2v-2L8.5 1.5z"/></svg> Edit
                        </button>
                        <button onClick={() => runTemplate(String(t.id), String(t.name))} disabled={running === String(t.id)}
                          style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border2)', background: 'var(--bg)', color: 'var(--text2)', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>
                          {running === String(t.id) ? 'Generating…' : <><svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><polygon points="2,1 9,5 2,9" fill="currentColor" stroke="none"/></svg> Run now</>}
                        </button>
                        <button onClick={() => deleteTemplate(String(t.id))}
                          style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #fecaca', background: '#fef2f2', color: '#dc2626', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
        )}

        {/* History */}
        {!loading && tab === 'history' && (
          filteredHistory.length === 0
            ? <div style={{ padding: '40px 20px', textAlign: 'center', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text3)', fontSize: 13 }}>
                No report history yet.
              </div>
            : <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border)' }}>
                        {['Report', 'Type', 'Trigger', 'Generated', 'Triggered by', 'Deliveries', 'Status'].map(h => (
                          <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em', whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredHistory.map(r => (
                        <tr key={String(r.id)} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '10px 14px' }}>
                            <div style={{ fontSize: 13, fontWeight: 500 }}>{String(r.name)}</div>
                            {r.template_name && <div style={{ fontSize: 11, color: 'var(--text3)' }}>{String(r.template_name)}</div>}
                          </td>
                          <td style={{ padding: '10px 14px' }}><TypeBadge type={String(r.type)} /></td>
                          <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text3)' }}>{String(r.trigger)}</td>
                          <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text3)', whiteSpace: 'nowrap' }}>{fmtDate(String(r.generated_at))}</td>
                          <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text3)' }}>{String(r.triggered_by_name || '—')}</td>
                          <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text3)' }}>
                            {Number(r.sent_count) > 0 ? `${r.sent_count}/${r.delivery_count} sent` : r.delivery_count ? `${r.delivery_count} pending` : '—'}
                          </td>
                          <td style={{ padding: '10px 14px' }}><StatusBadge status={String(r.status)} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
        )}
      </div>

      {/* New Template Modal */}
      {showNewTemplate && (
        <div onClick={e => { if (e.target === e.currentTarget) setShowNewTemplate(false) }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: 'var(--surface)', borderRadius: 14, padding: 28, width: 460, maxWidth: '100%', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>New report template</div>
              <button onClick={() => setShowNewTemplate(false)} style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid var(--border2)', background: 'var(--bg)', fontSize: 15, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text2)', marginBottom: 5 }}>Template name *</label>
                <input style={INP} placeholder="e.g. Weekly OEE Summary — Line B" value={newTemplate.name} onChange={e => setNewTemplate(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text2)', marginBottom: 5 }}>Description</label>
                <input style={INP} placeholder="What this report covers" value={newTemplate.description} onChange={e => setNewTemplate(p => ({ ...p, description: e.target.value }))} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text2)', marginBottom: 5 }}>Type</label>
                <select style={INP} value={newTemplate.type} onChange={e => setNewTemplate(p => ({ ...p, type: e.target.value }))}>
                  <option value="operational">Operational</option>
                  <option value="maintenance">Maintenance</option>
                  <option value="quality">Quality</option>
                  <option value="rca">RCA</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text2)', marginBottom: 5 }}>Schedule</label>
                <input style={INP} placeholder="e.g. Every Monday at 06:00, or leave blank for manual" value={newTemplate.schedule} onChange={e => setNewTemplate(p => ({ ...p, schedule: e.target.value }))} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text2)', marginBottom: 5 }}>Recipients (comma-separated emails)</label>
                <input style={INP} placeholder="manager@company.com, ops@company.com" value={newTemplate.recipients} onChange={e => setNewTemplate(p => ({ ...p, recipients: e.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
              <button onClick={() => setShowNewTemplate(false)} style={{ padding: '7px 16px', borderRadius: 7, border: '1px solid var(--border2)', background: 'var(--bg)', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', color: 'var(--text2)' }}>Cancel</button>
              <button onClick={saveTemplate} disabled={saving || !newTemplate.name}
                style={{ padding: '7px 16px', borderRadius: 7, border: 'none', background: 'var(--blue)', color: 'white', cursor: newTemplate.name ? 'pointer' : 'not-allowed', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', opacity: !newTemplate.name ? 0.5 : 1 }}>
                {saving ? 'Saving…' : 'Create template'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
