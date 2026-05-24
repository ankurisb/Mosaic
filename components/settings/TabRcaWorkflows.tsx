'use client'
import { useState, useEffect } from 'react'
import type { SessionUser } from '@/lib/auth'
import { PageTitle, PageSub, SectionLabel, Card, CardRow, Btn, Badge, Field, Grid, Alert, Toggle, Divider } from './ui'
import { safeJson } from '@/lib/fetch'

interface RcaWorkflow {
  id: string; name: string; description: string; trigger_keywords: string[]
  active: boolean; is_default: boolean; sort_order: number
  data_steps: unknown[]; renderers: string[]; output_config: unknown
  created_at: string
}

const EMPTY_FORM = {
  name: '', description: '', trigger_keywords: '', active: true,
  is_default: false, renderer_types: 'fishbone,pareto,timeline,cap',
}

const RENDERER_OPTIONS = [
  { value: 'fishbone',    label: 'Fishbone diagram' },
  { value: 'pareto',      label: 'Pareto chart' },
  { value: 'timeline',    label: 'Event timeline' },
  { value: 'cap',         label: 'CAP table' },
  { value: 'fta',         label: 'Fault tree' },
  { value: 'five_why',    label: '5 Whys' },
  { value: 'scatter',     label: 'Scatter plot' },
  { value: 'histogram',   label: 'Histogram' },
  { value: 'control',     label: 'Control chart' },
  { value: 'correlation', label: 'Correlation matrix' },
  { value: 'heatmap',     label: 'Heatmap' },
  { value: 'box_plot',    label: 'Box plot' },
  { value: 'sankey',      label: 'Sankey flow' },
  { value: 'comparison',  label: 'Comparison table' },
]

export default function TabRcaWorkflows({ user }: { user: SessionUser }) {
  const [workflows, setWorkflows] = useState<RcaWorkflow[]>([])
  const [loading,   setLoading]   = useState(true)
  const [showForm,  setShowForm]  = useState(false)
  const [editing,   setEditing]   = useState<string | null>(null)
  const [form,      setForm]      = useState({ ...EMPTY_FORM })
  const [saving,    setSaving]    = useState(false)
  const [toast,     setToast]     = useState('')

  useEffect(() => { load() }, [])
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 2500); return () => clearTimeout(t) } }, [toast])

  async function load() {
    setLoading(true)
    try {
      const r = await fetch('/api/rca-workflows', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'list' }) })
      const d = await r.json()
      setWorkflows(d.workflows || [])
    } finally { setLoading(false) }
  }

  async function save() {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      const action = editing ? 'update' : 'create'
      const body: Record<string, unknown> = {
        action, name: form.name.trim(), description: form.description,
        trigger_keywords: form.trigger_keywords.split(',').map(k => k.trim()).filter(Boolean),
        active: form.active, is_default: form.is_default,
        renderers: form.renderer_types.split(',').map(r => r.trim()).filter(Boolean),
      }
      if (editing) body.id = editing
      const r = await fetch('/api/rca-workflows', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const { error: err } = await safeJson(r)
      if (err) { setToast('Error: ' + err); return }
      setShowForm(false); setEditing(null); setForm({ ...EMPTY_FORM })
      setToast(editing ? 'Workflow updated' : 'Workflow created')
      await load()
    } catch (e) { setToast('Error: ' + (e instanceof Error ? e.message : 'Save failed')) }
    finally { setSaving(false) }
  }

  async function toggle(id: string) {
    await fetch('/api/rca-workflows', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'toggle_active', id }) })
    setWorkflows(p => p.map(w => w.id === id ? { ...w, active: !w.active } : w))
  }

  async function del(id: string, name: string) {
    if (!confirm(`Delete workflow "${name}"?`)) return
    await fetch('/api/rca-workflows', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', id }) })
    setWorkflows(p => p.filter(w => w.id !== id))
    setToast('Workflow deleted')
  }

  function startEdit(w: RcaWorkflow) {
    setEditing(w.id)
    setForm({
      name: w.name, description: w.description,
      trigger_keywords: w.trigger_keywords.join(', '),
      active: w.active, is_default: w.is_default,
      renderer_types: (w.renderers || []).join(', '),
    })
    setShowForm(true)
  }

  const isAdmin = user.role === 'admin'

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
        <PageTitle>RCA Workflows</PageTitle>
        {isAdmin && <Btn variant="primary" onClick={() => { setShowForm(true); setEditing(null); setForm({ ...EMPTY_FORM }) }}>+ New workflow</Btn>}
      </div>
      <PageSub>Define how Mosaic approaches root cause analysis -- which data to gather, which visualisations to render, and what output to produce. Triggered automatically when a message matches the keyword list.</PageSub>

      {/* Create / edit form */}
      {showForm && (
        <div className="fade-in" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 20, marginBottom: 20, boxShadow: 'var(--shadow-md)' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 16 }}>{editing ? 'Edit workflow' : 'New workflow'}</div>

          <Grid cols={2}>
            <Field label="Workflow name" required>
              <input style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', padding: '9px 12px', fontSize: 13, color: 'var(--text)', outline: 'none', fontFamily: 'inherit' }}
                value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                placeholder="e.g. Dimensional defect -- CNC" />
            </Field>
            <Field label="Active">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 4 }}>
                <Toggle on={form.active} onChange={v => setForm(p => ({ ...p, active: v }))} />
                <span style={{ fontSize: 13, color: 'var(--text2)' }}>{form.active ? 'Enabled' : 'Disabled'}</span>
              </div>
            </Field>
          </Grid>

          <Field label="Description">
            <input style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', padding: '9px 12px', fontSize: 13, color: 'var(--text)', outline: 'none', fontFamily: 'inherit' }}
              value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
              placeholder="What manufacturing problem does this workflow address?" />
          </Field>

          <Field label="Trigger keywords" hint="Comma-separated. Mosaic uses this workflow when a user message contains any of these keywords.">
            <input style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', padding: '9px 12px', fontSize: 13, color: 'var(--text)', outline: 'none', fontFamily: 'inherit' }}
              value={form.trigger_keywords} onChange={e => setForm(p => ({ ...p, trigger_keywords: e.target.value }))}
              placeholder="defect, rejection, rework, dimensional, surface finish" />
          </Field>

          <Field label="Renderers" hint="Comma-separated renderer types to include in the RCA output.">
            <input style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', padding: '9px 12px', fontSize: 13, color: 'var(--text)', outline: 'none', fontFamily: 'inherit' }}
              value={form.renderer_types} onChange={e => setForm(p => ({ ...p, renderer_types: e.target.value }))}
              placeholder="fishbone, pareto, timeline, cap" />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
              {RENDERER_OPTIONS.map(r => (
                <button key={r.value} onClick={() => {
                  const cur = form.renderer_types.split(',').map(x => x.trim()).filter(Boolean)
                  const next = cur.includes(r.value) ? cur.filter(x => x !== r.value) : [...cur, r.value]
                  setForm(p => ({ ...p, renderer_types: next.join(', ') }))
                }} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 'var(--radius-pill)', border: '1px solid var(--border2)', background: form.renderer_types.includes(r.value) ? 'var(--accent-bg)' : 'var(--bg)', color: form.renderer_types.includes(r.value) ? 'var(--accent-fg)' : 'var(--text2)', cursor: 'pointer', fontFamily: 'inherit', transition: 'all .12s' }}>
                  {r.label}
                </button>
              ))}
            </div>
          </Field>

          <div style={{ display: 'flex', gap: 8, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
            <Btn variant="primary" onClick={save} disabled={saving || !form.name.trim()}>{saving ? 'Saving...' : editing ? 'Update' : 'Create workflow'}</Btn>
            <Btn onClick={() => { setShowForm(false); setEditing(null) }}>Cancel</Btn>
          </div>
        </div>
      )}

      {/* Workflow list */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 48, color: 'var(--text3)', fontSize: 13 }}>Loading workflows...</div>
      ) : workflows.length === 0 ? (
        <Alert variant="info">No RCA workflows defined. Create one to start customising how Mosaic handles root cause analysis.</Alert>
      ) : (
        workflows.map((w, idx) => (
          <Card key={w.id}>
            <CardRow>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{w.name}</span>
                  {w.is_default && <Badge label="Default" color="blue" />}
                  <Badge label={w.active ? 'Active' : 'Paused'} color={w.active ? 'green' : 'gray'} />
                </div>
                {w.description && <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 4 }}>{w.description}</div>}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {w.trigger_keywords.slice(0, 6).map(k => (
                    <span key={k} style={{ fontSize: 11, padding: '1px 7px', borderRadius: 'var(--radius-pill)', background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text3)' }}>{k}</span>
                  ))}
                  {w.trigger_keywords.length > 6 && <span style={{ fontSize: 11, color: 'var(--text4)' }}>+{w.trigger_keywords.length - 6} more</span>}
                </div>
              </div>
              {isAdmin && (
                <div style={{ display: 'flex', gap: 6, flexShrink: 0, marginLeft: 12 }}>
                  <Btn size="sm" onClick={() => toggle(w.id)}>{w.active ? 'Pause' : 'Resume'}</Btn>
                  <Btn size="sm" onClick={() => startEdit(w)}>Edit</Btn>
                  <Btn size="sm" variant="danger" onClick={() => del(w.id, w.name)}>Delete</Btn>
                </div>
              )}
            </CardRow>
            {/* Renderer chips */}
            {w.renderers?.length > 0 && (
              <div style={{ padding: '8px 18px 10px', display: 'flex', flexWrap: 'wrap', gap: 5, borderTop: '1px solid var(--border)' }}>
                <span style={{ fontSize: 11, color: 'var(--text4)', marginRight: 4 }}>Renders:</span>
                {w.renderers.map(r => (
                  <span key={r} style={{ fontSize: 11, padding: '1px 7px', borderRadius: 'var(--radius-pill)', background: 'var(--purple-bg)', border: '1px solid rgba(124,58,237,.15)', color: 'var(--purple-t)' }}>{r}</span>
                ))}
              </div>
            )}
          </Card>
        ))
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: 'var(--text)', color: 'var(--bg)', padding: '9px 18px', borderRadius: 'var(--radius-pill)', fontSize: 13, fontWeight: 500, boxShadow: 'var(--shadow-lg)', zIndex: 999 }}>{toast}</div>
      )}
    </div>
  )
}
