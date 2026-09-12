'use client'
import { useState, useEffect } from 'react'
import { PageTitle, PageSub, SectionLabel, Card } from './ui'

interface Metric {
  id?: string
  name: string
  kind: string
  definition: string
  formula: string | null
  applies_to: string | null
  enabled: number
}

const BLANK: Metric = { name: '', kind: 'metric', definition: '', formula: '', applies_to: '', enabled: 1 }

export default function TabMetrics() {
  const [metrics, setMetrics] = useState<Metric[]>([])
  const [form, setForm] = useState<Metric | null>(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const load = () => fetch('/api/metrics').then(r => r.json()).then(d => setMetrics(d.metrics || [])).catch(() => {})
  useEffect(() => { load() }, [])

  const save = async () => {
    if (!form) return
    setSaving(true); setErr('')
    try {
      const r = await fetch('/api/metrics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      const d = await r.json()
      if (!r.ok) { setErr(d.error || 'Save failed'); setSaving(false); return }
      setForm(null); load()
    } catch (e) { setErr((e as Error).message) }
    setSaving(false)
  }
  const del = async (id?: string) => {
    if (!id) return
    await fetch(`/api/metrics?id=${id}`, { method: 'DELETE' })
    load()
  }

  const INP: React.CSSProperties = { width: '100%', padding: '8px 10px', background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', fontSize: 13, color: 'var(--text)', fontFamily: 'inherit' }
  const LBL: React.CSSProperties = { fontSize: 11.5, fontWeight: 500, color: 'var(--text2)', margin: '10px 0 4px', display: 'block' }

  return (
    <div>
      <PageTitle>Business definitions</PageTitle>
      <PageSub>Define how <em>your</em> plant computes its metrics and what your terms mean — OEE, first-pass yield, what counts as a defect, which machines make up &ldquo;Line A.&rdquo; Mosaic uses these exact definitions in every analysis, so answers reflect your standards, not generic assumptions.</PageSub>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '18px 0 8px' }}>
        <SectionLabel>Defined terms</SectionLabel>
        {!form && <button onClick={() => setForm({ ...BLANK })} style={{ padding: '6px 14px', background: 'var(--accent-bg)', color: 'var(--accent-fg)', border: 'none', borderRadius: 'var(--radius-pill)', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>+ New definition</button>}
      </div>

      {form && (
        <Card>
          <div style={{ padding: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
              <div>
                <label style={LBL}>Name</label>
                <input style={INP} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. OEE, First Pass Yield, Line A" />
              </div>
              <div>
                <label style={LBL}>Type</label>
                <select style={INP} value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}>
                  <option value="metric">Metric</option>
                  <option value="entity">Entity / grouping</option>
                  <option value="term">Term</option>
                </select>
              </div>
            </div>
            <label style={LBL}>Definition (plain language)</label>
            <textarea style={{ ...INP, minHeight: 64, resize: 'vertical' }} value={form.definition} onChange={e => setForm({ ...form, definition: e.target.value })} placeholder="e.g. OEE = Availability × Performance × Quality. Availability = run time / planned time..." />
            <label style={LBL}>Formula / expression (optional)</label>
            <input style={{ ...INP, fontFamily: 'var(--font-mono)', fontSize: 12 }} value={form.formula || ''} onChange={e => setForm({ ...form, formula: e.target.value })} placeholder="e.g. SUM(good_units) / SUM(total_units)" />
            <label style={LBL}>Applies to (optional — a data source or table)</label>
            <input style={INP} value={form.applies_to || ''} onChange={e => setForm({ ...form, applies_to: e.target.value })} placeholder="e.g. production_logs" />
            {err && <div style={{ fontSize: 12, color: 'var(--red-t, #dc2626)', marginTop: 10 }}>{err}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button onClick={save} disabled={saving} style={{ padding: '8px 18px', background: 'var(--accent-bg)', color: 'var(--accent-fg)', border: 'none', borderRadius: 'var(--radius-pill)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Save'}</button>
              <button onClick={() => { setForm(null); setErr('') }} style={{ padding: '8px 16px', background: 'var(--bg)', color: 'var(--text2)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-pill)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
            </div>
          </div>
        </Card>
      )}

      {metrics.length === 0 && !form && (
        <Card><div style={{ padding: '28px', textAlign: 'center', fontSize: 13, color: 'var(--text3)' }}>No definitions yet. Add your key metrics so Mosaic uses your plant&rsquo;s standards in every answer.</div></Card>
      )}

      {metrics.length > 0 && (
        <Card>
          <div style={{ padding: '0 16px' }}>
            {metrics.map((m, i) => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '12px 0', borderBottom: i < metrics.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{m.name}</span>
                    <span style={{ fontSize: 10, color: 'var(--text3)', background: 'var(--bg3)', padding: '1px 7px', borderRadius: 'var(--radius-pill)' }}>{m.kind}</span>
                    {!m.enabled && <span style={{ fontSize: 10, color: 'var(--text4)' }}>disabled</span>}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 3, lineHeight: 1.5 }}>{m.definition}</div>
                  {m.formula && <div style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--font-mono)', marginTop: 3 }}>{m.formula}</div>}
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button onClick={() => setForm({ ...m, formula: m.formula || '', applies_to: m.applies_to || '' })} style={{ fontSize: 11, padding: '4px 10px', background: 'var(--bg)', color: 'var(--text2)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontFamily: 'inherit' }}>Edit</button>
                  <button onClick={() => del(m.id)} style={{ fontSize: 11, padding: '4px 10px', background: 'var(--bg)', color: 'var(--red-t, #dc2626)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontFamily: 'inherit' }}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
