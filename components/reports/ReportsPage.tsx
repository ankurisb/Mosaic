'use client'
import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import type { SessionUser } from '@/lib/auth'
import AppShell from '@/components/AppShell'

function fmtDate(s: unknown) {
  if (!s) return '—'
  try { return new Date(String(s)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return String(s) }
}
function fmtSize(bytes: unknown) {
  const n = Number(bytes); if (!n) return ''
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`
}
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    completed: ['var(--green-bg)', 'var(--green-t)'], pending: ['var(--amber-bg)', 'var(--amber-t)'],
    failed: ['var(--red-bg)', 'var(--red-t)'], running: ['var(--blue-bg)', 'var(--blue-t)'],
  }
  const [bg, fg] = map[status] || ['var(--bg3)', 'var(--text3)']
  return <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 600, background: bg, color: fg }}>{status}</span>
}
function TypeBadge({ type }: { type: string }) {
  const map: Record<string, string> = { rca: 'var(--purple-t)', operational: 'var(--blue-t)', maintenance: 'var(--red-t)', scheduled: 'var(--green-t)' }
  const color = map[type] || '#6366f1'
  return <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 600, background: color + '18', color, border: `1px solid ${color}30` }}>{type}</span>
}

type Row = Record<string, unknown>

export default function ReportsPage({ user }: { user: SessionUser }) {
  const router = useRouter()
  const [templates, setTemplates] = useState<Row[]>([])
  const [runs, setRuns] = useState<Row[]>([])          // report_instances (runs + outputs)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [chatOpen, setChatOpen] = useState(false)
  const [showNewTemplate, setShowNewTemplate] = useState(false)
  const [newTemplate, setNewTemplate] = useState({ name: '', description: '', type: 'operational', schedule: '', recipients: '' })
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState<string | null>(null)

  const isAdmin = user.role === 'admin'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [tr, hr] = await Promise.all([
        fetch('/api/reports?type=templates').then(r => r.json()).catch(() => ({})),
        fetch('/api/reports?type=history').then(r => r.json()).catch(() => ({})),
      ])
      setTemplates(tr.templates || [])
      setRuns(hr.history || [])
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  // runs grouped by template
  const runsByTemplate = useMemo(() => {
    const m = new Map<string, Row[]>()
    for (const r of runs) {
      const tid = r.template_id ? String(r.template_id) : ''
      if (!tid) continue
      ;(m.get(tid) || m.set(tid, []).get(tid)!).push(r)
    }
    for (const list of m.values()) list.sort((a, b) => String(b.generated_at).localeCompare(String(a.generated_at)))
    return m
  }, [runs])
  const chatRuns = useMemo(
    () => runs.filter(r => !r.template_id).sort((a, b) => String(b.generated_at).localeCompare(String(a.generated_at))),
    [runs],
  )

  const visibleTemplates = templates.filter(t => !search ||
    String(t.name).toLowerCase().includes(search.toLowerCase()) ||
    String(t.description || '').toLowerCase().includes(search.toLowerCase()))
  const visibleChat = chatRuns.filter(r => !search || String(r.name).toLowerCase().includes(search.toLowerCase()))

  function toggleExpand(id: string) {
    setExpanded(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  async function deleteTemplate(id: string) {
    if (!confirm('Delete this digest? Its past runs remain accessible.')) return
    await fetch('/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete_template', id }) })
    load()
  }
  async function toggleActive(id: string, active: boolean) {
    await fetch('/api/reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'toggle_template', id, active }) })
    load()
  }
  async function saveTemplate() {
    if (!newTemplate.name) return
    setSaving(true)
    try {
      await fetch('/api/reports', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_template', name: newTemplate.name, description: newTemplate.description, type: newTemplate.type,
          schedule: newTemplate.schedule || null,
          recipients: newTemplate.recipients.split(',').map(r => r.trim()).filter(Boolean),
        }),
      })
      setShowNewTemplate(false)
      setNewTemplate({ name: '', description: '', type: 'operational', schedule: '', recipients: '' })
      load()
    } finally { setSaving(false) }
  }
  async function runTemplate(id: string, name: string) {
    setRunning(id)
    try {
      const res = await fetch('/api/reports/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ template_id: id }) })
      const d = await res.json()
      if (!res.ok || d.error) { alert(d.error || 'Failed to generate digest'); return }
      setExpanded(s => new Set(s).add(id))
      await load()
    } catch { alert('Failed to generate digest') }
    finally { setRunning(null) }
  }

  const INP: React.CSSProperties = { width: '100%', padding: '7px 10px', border: '1.5px solid var(--border2)', borderRadius: 7, fontSize: 13, background: 'var(--bg)', color: 'var(--text)', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }
  const btn: React.CSSProperties = { padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border2)', background: 'var(--bg)', color: 'var(--text2)', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 5 }

  function runRow(r: Row) {
    const id = String(r.id)
    const deliveries = Number(r.sent_count) > 0 ? `${r.sent_count}/${r.delivery_count} sent` : r.delivery_count ? `${r.delivery_count} pending` : null
    const viewable = r.pdf_path && r.status !== 'failed'
    return (
      <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 14px 8px 18px', borderTop: '1px solid var(--border)', fontSize: 12 }}>
        <span style={{ color: 'var(--text3)', whiteSpace: 'nowrap', minWidth: 140 }}>{fmtDate(r.generated_at)}</span>
        <span style={{ color: 'var(--text4)', textTransform: 'capitalize' }}>{String(r.trigger || '—')}</span>
        {deliveries && <span style={{ color: 'var(--text4)' }}>· {deliveries}</span>}
        {r.pdf_size ? <span style={{ color: 'var(--text4)' }}>· {fmtSize(r.pdf_size)}</span> : null}
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <StatusBadge status={String(r.status)} />
          {viewable && <button onClick={() => router.push(`/reports/view/${id}`)} style={{ ...btn, color: 'var(--accent)', borderColor: 'var(--accent)' }}>Open</button>}
          {r.pdf_path ? <a href={`/api/reports/download?id=${id}`} download style={{ ...btn, textDecoration: 'none' }}>Download</a> : null}
        </span>
      </div>
    )
  }

  const nothing = !loading && templates.length === 0 && runs.length === 0

  return (
    <AppShell user={user}>
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '0 24px', height: 52, display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <span style={{ fontSize: 13, color: 'var(--text3)' }}>Chat</span>
        <span style={{ fontSize: 13, color: 'var(--text3)' }}>/</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Digests</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 24px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0 }}>
        <input placeholder="Search digests…" value={search} onChange={e => setSearch(e.target.value)} style={{ ...INP, maxWidth: 320 }} />
        {isAdmin && (
          <button onClick={() => setShowNewTemplate(true)}
            style={{ marginLeft: 'auto', padding: '7px 14px', borderRadius: 999, border: 'none', background: 'var(--accent)', color: 'var(--accent-fg)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            + New digest
          </button>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px', maxWidth: 940, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        {loading && <div style={{ padding: 40, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>Loading…</div>}

        {nothing && (
          <div style={{ padding: '44px 20px', textAlign: 'center', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text3)', fontSize: 13 }}>
            No digests yet — create one to schedule an AI summary for your team, or export an RCA from a chat.
          </div>
        )}

        {!loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {visibleTemplates.map(t => {
              const id = String(t.id)
              const tRuns = runsByTemplate.get(id) || []
              const last = tRuns[0]
              const isOpen = expanded.has(id)
              const active = t.active === 1 || t.active === true || t.active === undefined
              return (
                <div key={id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: 'var(--shadow)', opacity: active ? 1 : 0.65, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px' }}>
                    <button onClick={() => toggleExpand(id)} aria-label={isOpen ? 'Collapse' : 'Expand'}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', padding: 2, display: 'flex' }}>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform .12s' }}><path d="M4 2.5L8 6l-4 3.5" /></svg>
                    </button>
                    <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => toggleExpand(id)}>
                      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 3, display: 'flex', alignItems: 'center', gap: 8 }}>
                        {String(t.name)}
                        {!active && <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text4)', border: '1px solid var(--border2)', borderRadius: 999, padding: '1px 7px' }}>Paused</span>}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text3)', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                        <TypeBadge type={String(t.type)} />
                        <span>⏱ {t.schedule ? String(t.schedule) : 'Manual'}</span>
                        {last ? <span>· last run {fmtDate(last.generated_at)}</span> : <span style={{ color: 'var(--text4)' }}>· never run</span>}
                        {tRuns.length ? <span style={{ color: 'var(--text4)' }}>· {tRuns.length} run{tRuns.length > 1 ? 's' : ''}</span> : null}
                      </div>
                    </div>
                    {last ? <StatusBadge status={String(last.status)} /> : null}
                    {isAdmin && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => runTemplate(id, String(t.name))} disabled={running === id} style={btn}>
                          {running === id ? 'Running…' : <><svg width="10" height="10" viewBox="0 0 10 10" fill="none"><polygon points="2,1 9,5 2,9" fill="currentColor" /></svg> Run now</>}
                        </button>
                        <button onClick={() => router.push(`/reports/template/edit/${id}`)} style={btn}>Edit</button>
                        <button onClick={() => toggleActive(id, !active)} style={btn}>{active ? 'Pause' : 'Resume'}</button>
                        <button onClick={() => deleteTemplate(id)} style={{ ...btn, color: 'var(--red-t)', borderColor: 'color-mix(in srgb, var(--red-t) 35%, transparent)', background: 'var(--red-bg)' }}>Delete</button>
                      </div>
                    )}
                  </div>
                  {isOpen && (
                    tRuns.length
                      ? <div>{tRuns.map(runRow)}</div>
                      : <div style={{ padding: '10px 18px', borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--text4)' }}>No runs yet. {isAdmin ? 'Use “Run now”, or wait for the schedule.' : 'Waiting for its schedule.'}</div>
                  )}
                </div>
              )
            })}

            {/* From chat — only when RCA exports exist */}
            {visibleChat.length > 0 && (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: 'var(--shadow)', overflow: 'hidden', marginTop: 4 }}>
                <div onClick={() => setChatOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 16px', cursor: 'pointer' }}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="var(--text3)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ transform: chatOpen ? 'rotate(90deg)' : 'none', transition: 'transform .12s' }}><path d="M4 2.5L8 6l-4 3.5" /></svg>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>From chat</span>
                  <span style={{ fontSize: 11, color: 'var(--text4)' }}>{visibleChat.length} export{visibleChat.length > 1 ? 's' : ''} · RCAs you saved from a conversation</span>
                </div>
                {chatOpen && <div>{visibleChat.map(runRow)}</div>}
              </div>
            )}
          </div>
        )}
      </div>

      {/* New digest modal */}
      {showNewTemplate && (
        <div onClick={e => { if (e.target === e.currentTarget) setShowNewTemplate(false) }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', borderRadius: 14, padding: 28, width: 460, maxWidth: '100%', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>New digest</div>
              <button onClick={() => setShowNewTemplate(false)} style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid var(--border2)', background: 'var(--bg)', fontSize: 15, cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text2)', marginBottom: 5 }}>Digest name *</label>
                <input style={INP} placeholder="e.g. Weekly OEE Summary — Line B" value={newTemplate.name} onChange={e => setNewTemplate(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text2)', marginBottom: 5 }}>Description</label>
                <input style={INP} placeholder="What this digest summarises" value={newTemplate.description} onChange={e => setNewTemplate(p => ({ ...p, description: e.target.value }))} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text2)', marginBottom: 5 }}>Schedule (cron, optional)</label>
                <input style={INP} placeholder="e.g. 0 7 * * 1  (Mon 07:00) — leave blank for manual" value={newTemplate.schedule} onChange={e => setNewTemplate(p => ({ ...p, schedule: e.target.value }))} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text2)', marginBottom: 5 }}>Recipients (comma-separated emails)</label>
                <input style={INP} placeholder="ops@acme.com, plant.manager@acme.com" value={newTemplate.recipients} onChange={e => setNewTemplate(p => ({ ...p, recipients: e.target.value }))} />
              </div>
              <div style={{ fontSize: 11, color: 'var(--text4)' }}>You can add the AI-narrated sections after creating it (Edit).</div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                <button onClick={() => setShowNewTemplate(false)} style={{ ...btn, padding: '8px 14px' }}>Cancel</button>
                <button onClick={saveTemplate} disabled={saving || !newTemplate.name}
                  style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: 'var(--accent-fg)', fontSize: 13, fontWeight: 600, cursor: newTemplate.name ? 'pointer' : 'default', opacity: newTemplate.name ? 1 : 0.6, fontFamily: 'inherit' }}>
                  {saving ? 'Creating…' : 'Create digest'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  )
}
