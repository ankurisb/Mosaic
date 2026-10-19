'use client'
// Semantic dictionary editor for one data source. Loads stored table/column
// descriptions, can auto-generate a draft from the real schema + samples (AI
// proposes → user confirms/edits), and saves. This is what teaches Mosaic what
// opaque columns (kWh_sf, v1n, machine_status) mean so NL→SQL stops guessing.
import React, { useState, useEffect, useCallback } from 'react'
import { Btn, Spinner, Alert } from './ui'

interface Row { object_type: 'table' | 'column'; object_key: string; description: string; _dirty?: boolean }

export default function SemanticDescriptionsModal({
  sourceId, sourceLabel, sourceType = 'database', onClose,
}: { sourceId: string; sourceLabel: string; sourceType?: string; onClose: () => void }) {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')
  const [warning, setWarning] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const r = await fetch(`/api/semantic?source_type=${encodeURIComponent(sourceType)}&source_id=${encodeURIComponent(sourceId)}`)
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Failed to load')
      setRows((Array.isArray(d.descriptions) ? d.descriptions : []).map((x: Row) => ({ ...x })))
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load') }
    finally { setLoading(false) }
  }, [sourceId, sourceType])

  useEffect(() => { load() }, [load])

  async function generate() {
    setGenerating(true); setError(''); setMsg(''); setWarning('')
    try {
      const r = await fetch('/api/semantic', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generate', source_type: sourceType, source_id: sourceId }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Generation failed')
      const draft: Row[] = (d.draft || []).map((x: Row) => ({ ...x, _dirty: true }))
      // Merge: keep any existing non-empty description; fill blanks/new keys from the draft.
      setRows(cur => {
        const byKey = new Map(cur.map(r => [r.object_key, r]))
        for (const dr of draft) {
          const ex = byKey.get(dr.object_key)
          if (!ex) byKey.set(dr.object_key, dr)
          else if (!ex.description?.trim()) byKey.set(dr.object_key, { ...ex, description: dr.description, _dirty: true })
        }
        return Array.from(byKey.values()).sort((a, b) =>
          a.object_type === b.object_type ? a.object_key.localeCompare(b.object_key) : (a.object_type === 'table' ? -1 : 1))
      })
      setMsg(d.summary ? `${d.summary} Review and save.` : `Proposed ${draft.length} description${draft.length === 1 ? '' : 's'} — review and save.`)
      if (d.warning) setWarning(d.warning)
    } catch (e) { setError(e instanceof Error ? e.message : 'Generation failed') }
    finally { setGenerating(false) }
  }

  async function save() {
    setSaving(true); setError(''); setMsg('')
    try {
      const items = rows.map(r => ({ object_type: r.object_type, object_key: r.object_key, description: r.description.trim() }))
      const r = await fetch('/api/semantic', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'upsert', source_type: sourceType, source_id: sourceId, items }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Save failed')
      setMsg(`Saved ${d.saved} description${d.saved === 1 ? '' : 's'}.`)
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed') }
    finally { setSaving(false) }
  }

  function edit(key: string, v: string) {
    setRows(cur => cur.map(r => r.object_key === key ? { ...r, description: v, _dirty: true } : r))
  }
  function addColumnRow() {
    // database keys are table.column; prism telemetry keys and api fields are bare names.
    const isDb = sourceType === 'database'
    const key = prompt(isDb ? 'Column key as table.column (e.g. readings.kWh_sf):' : 'Field / key name (e.g. kWh_sf):')?.trim()
    if (!key) return
    const objectType: Row['object_type'] = isDb ? (key.includes('.') ? 'column' : 'table') : 'column'
    setRows(cur => cur.some(r => r.object_key === key) ? cur : [...cur, { object_type: objectType, object_key: key, description: '', _dirty: true }])
  }

  const tables = rows.filter(r => r.object_type === 'table')
  const cols = rows.filter(r => r.object_type === 'column')

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>Data dictionary — {sourceLabel}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text3)', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12 }}>
          Plain-language descriptions so Mosaic knows what each table and column means. Mosaic can draft these from your schema and sample data — review, edit, and save. These feed every AI query over this source.
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <Btn size="sm" onClick={generate} disabled={generating || loading}>{generating ? <Spinner size={11} /> : 'Describe with AI'}</Btn>
          <Btn size="sm" variant="ghost" onClick={addColumnRow} disabled={loading}>+ Add entry</Btn>
          <div style={{ flex: 1 }} />
          <Btn size="sm" onClick={save} disabled={saving || loading || rows.length === 0}>{saving ? <Spinner size={11} /> : 'Save dictionary'}</Btn>
        </div>

        {error && <Alert variant="error">{error}</Alert>}
        {msg && !error && <Alert variant="success">{msg}</Alert>}
        {warning && !error && <Alert variant="warning">{warning}</Alert>}

        {loading ? <div style={{ padding: 24, textAlign: 'center' }}><Spinner size={16} /></div> : (
          <div style={{ overflowY: 'auto', flex: 1, marginTop: 4 }}>
            {rows.length === 0 && <div style={{ fontSize: 12, color: 'var(--text4)', padding: '16px 0' }}>No descriptions yet. Click “Describe with AI” to draft them from your schema.</div>}
            {tables.length > 0 && <Section title="Tables" items={tables} onEdit={edit} />}
            {cols.length > 0 && <Section title="Columns" items={cols} onEdit={edit} />}
          </div>
        )}
      </div>
    </div>
  )
}

function Section({ title, items, onEdit }: { title: string; items: Row[]; onEdit: (k: string, v: string) => void }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--text4)', marginBottom: 6 }}>{title}</div>
      {items.map(r => (
        <div key={r.object_key} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
          <code style={{ flexShrink: 0, width: 200, fontSize: 11, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.object_key}</code>
          <input value={r.description} onChange={e => onEdit(r.object_key, e.target.value)}
            placeholder="what it means (units where relevant)…"
            style={{ flex: 1, padding: '6px 10px', border: `1px solid ${r._dirty ? 'var(--accent-bg)' : 'var(--border2)'}`, borderRadius: 'var(--radius-sm)', background: 'var(--bg)', color: 'var(--text)', fontSize: 12, fontFamily: 'inherit', outline: 'none' }} />
        </div>
      ))}
    </div>
  )
}

const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }
const modal: React.CSSProperties = { background: 'var(--surface)', border: '1px solid var(--border2)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-lg)', width: 'min(760px, 100%)', maxHeight: '85vh', display: 'flex', flexDirection: 'column', padding: 20 }
