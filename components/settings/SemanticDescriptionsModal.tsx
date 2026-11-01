'use client'
// Semantic dictionary editor for one data source. Loads stored table/column entries
// (descriptions + the structured model: role, unit, aggregation, accumulation, status),
// can propose them from the real schema + samples with AI ("Analyze with AI" → everything
// comes back status='proposed'; nothing is auto-verified), and lets a human verify. This
// teaches Mosaic how to aggregate, label and accelerate each field.
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Btn, Spinner, Alert } from './ui'

type Role = 'measure' | 'dimension' | 'time' | 'identifier' | 'attribute'
type Status = 'proposed' | 'verified' | 'rejected'
interface Row {
  object_type: 'table' | 'column'
  object_key: string
  description: string
  role?: Role | null
  data_type?: string | null
  unit?: string | null
  default_aggregation?: string | null
  accumulation?: string | null
  status?: Status | null
  confidence?: number | null
  evidence?: string | null
  _dirty?: boolean
}

const ROLES: Role[] = ['measure', 'dimension', 'time', 'identifier', 'attribute']
const AGGS = ['sum', 'avg', 'min', 'max', 'last', 'count', 'count_distinct']
const ACCS = ['raw', 'cumulative_counter', 'rate']
const HIGH_CONF = 0.8
type Filter = 'all' | 'review' | 'verified'

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
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')

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
      // Merge: fill new keys and blank descriptions; always overlay AI's proposed
      // structured fields on existing rows that aren't verified yet.
      setRows(cur => {
        const byKey = new Map(cur.map(r => [r.object_key, r]))
        for (const dr of draft) {
          const ex = byKey.get(dr.object_key)
          if (!ex) byKey.set(dr.object_key, dr)
          else if (ex.status !== 'verified') byKey.set(dr.object_key, { ...ex, ...dr, description: ex.description?.trim() || dr.description, _dirty: true })
        }
        return sortRows(Array.from(byKey.values()))
      })
      const n = draft.filter(r => r.object_type === 'column').length
      setMsg(d.structured
        ? `Proposed ${n} field${n === 1 ? '' : 's'}. Nothing is saved as verified — review the flagged ones, then Verify or Save.`
        : (d.summary ? `${d.summary} Review and save.` : `Proposed ${n} — review and save.`))
      if (d.warning) setWarning(d.warning)
      setFilter('review')
    } catch (e) { setError(e instanceof Error ? e.message : 'Generation failed') }
    finally { setGenerating(false) }
  }

  async function save() {
    setSaving(true); setError(''); setMsg('')
    try {
      const items = rows.map(r => ({
        object_type: r.object_type, object_key: r.object_key, description: (r.description || '').trim(),
        role: r.role ?? null, data_type: r.data_type ?? null, unit: r.unit ?? null,
        default_aggregation: r.default_aggregation ?? null, accumulation: r.accumulation ?? null,
        status: r.status ?? null, confidence: r.confidence ?? null,
      }))
      const r = await fetch('/api/semantic', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'upsert', source_type: sourceType, source_id: sourceId, items }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Save failed')
      setMsg(`Saved ${d.saved} field${d.saved === 1 ? '' : 's'}.`)
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed') }
    finally { setSaving(false) }
  }

  const patch = (key: string, p: Partial<Row>) =>
    setRows(cur => cur.map(r => r.object_key === key ? { ...r, ...p, _dirty: true } : r))
  const verify = (key: string) => patch(key, { status: 'verified' })
  function verifyAllHighConfidence() {
    setRows(cur => cur.map(r =>
      r.object_type === 'column' && r.status === 'proposed' && r.role && (r.confidence ?? 0) >= HIGH_CONF
        ? { ...r, status: 'verified', _dirty: true } : r))
    setMsg('High-confidence fields marked verified — review the rest, then Save.')
  }

  function addColumnRow() {
    const isDb = sourceType === 'database'
    const key = prompt(isDb ? 'Column key as table.column (e.g. readings.kWh_sf):' : 'Field / key name (e.g. kWh_sf):')?.trim()
    if (!key) return
    const objectType: Row['object_type'] = isDb ? (key.includes('.') ? 'column' : 'table') : 'column'
    setRows(cur => cur.some(r => r.object_key === key) ? cur : [...cur, { object_type: objectType, object_key: key, description: '', status: 'verified', _dirty: true }])
  }

  const cols = rows.filter(r => r.object_type === 'column')
  const counts = useMemo(() => ({
    verified: cols.filter(r => r.status === 'verified').length,
    review: cols.filter(r => r.status === 'proposed' || (!r.status && r.role)).length,
    total: cols.length,
  }), [cols])
  const highConfPending = cols.filter(r => r.status === 'proposed' && r.role && (r.confidence ?? 0) >= HIGH_CONF).length

  // Search by field name or description — essential when a source has thousands of fields.
  const q = search.trim().toLowerCase()
  const matchesSearch = (r: Row) => !q || r.object_key.toLowerCase().includes(q) || (r.description || '').toLowerCase().includes(q)
  const inFilter = (r: Row) => filter === 'all' ? true
    : filter === 'verified' ? r.status === 'verified'
    : (r.status === 'proposed' || (!r.status && !!r.role))   // review
  const visible = (r: Row) => inFilter(r) && matchesSearch(r)
  const tables = rows.filter(r => r.object_type === 'table' && filter === 'all' && matchesSearch(r))
  const visCols = cols.filter(visible)
  // Flatten tables + visible columns into one list and WINDOW it: only the rows on screen
  // (plus a small overscan) are mounted, so a source with thousands of fields stays smooth.
  // Heights are measured dynamically — a row grows when you give it a role — via
  // measureElement/ResizeObserver, so variable-height rows reposition correctly.
  type Item = { kind: 'table' | 'col'; row: Row }
  const items: Item[] = [
    ...tables.map(r => ({ kind: 'table' as const, row: r })),
    ...visCols.map(r => ({ kind: 'col' as const, row: r })),
  ]
  const scrollRef = useRef<HTMLDivElement>(null)
  const virt = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 64,
    overscan: 10,
    getItemKey: (i) => items[i].row.object_key,
  })

  return (
    <div style={overlay}>
      <div style={page}>
        {/* Title bar */}
        <div style={headerBar}>
          <button onClick={onClose} style={backBtn} title="Back to data sources">← Back</button>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>Data dictionary — {sourceLabel}</div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--text3)', lineHeight: 1 }}>×</button>
        </div>

        {/* Sticky toolbar (stays visible over a long list) */}
        <div style={toolbarBar}>
          <div style={contentWrap}>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 10 }}>
              How Mosaic aggregates, labels (units) and accelerates each field. Analyze with AI to propose roles & units — everything is <b>proposed</b> until you verify it.
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Btn size="sm" onClick={generate} disabled={generating || loading}>{generating ? <Spinner size={11} /> : 'Analyze with AI'}</Btn>
              {highConfPending > 0 && <Btn size="sm" variant="ghost" onClick={verifyAllHighConfidence} disabled={loading}>Accept {highConfPending} high-confidence</Btn>}
              <Btn size="sm" variant="ghost" onClick={addColumnRow} disabled={loading}>+ Add</Btn>
              <input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search fields…"
                style={{ flex: '1 1 220px', minWidth: 160, padding: '6px 10px', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', background: 'var(--bg)', color: 'var(--text)', fontSize: 12, fontFamily: 'inherit', outline: 'none' }}
              />
              <div style={{ display: 'flex', gap: 2, background: 'var(--bg)', borderRadius: 'var(--radius-sm)', padding: 2 }}>
                {(['all', 'review', 'verified'] as Filter[]).map(f => (
                  <button key={f} onClick={() => setFilter(f)} style={segBtn(filter === f)}>
                    {f === 'all' ? `All ${counts.total}` : f === 'review' ? `Needs review ${counts.review}` : `Verified ${counts.verified}`}
                  </button>
                ))}
              </div>
              <Btn size="sm" onClick={save} disabled={saving || loading || rows.length === 0}>{saving ? <Spinner size={11} /> : 'Save'}</Btn>
            </div>
            <div style={{ marginTop: error || msg || warning ? 8 : 0 }}>
              {error && <Alert variant="error">{error}</Alert>}
              {msg && !error && <Alert variant="success">{msg}</Alert>}
              {warning && !error && <Alert variant="warning">{warning}</Alert>}
            </div>
          </div>
        </div>

        {/* Scrollable, virtualized field list */}
        <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', background: 'var(--bg)' }}>
          <div style={{ ...contentWrap, paddingTop: 12, paddingBottom: 40 }}>
            {loading ? <div style={{ padding: 24, textAlign: 'center' }}><Spinner size={16} /></div>
              : rows.length === 0 ? <div style={{ fontSize: 12, color: 'var(--text4)', padding: '16px 0' }}>No fields yet. Click “Analyze with AI” to propose roles, units and aggregations from your schema.</div>
              : items.length === 0 ? <div style={{ fontSize: 12, color: 'var(--text4)', padding: '12px 0' }}>Nothing in this view.</div>
              : (
                <div style={{ position: 'relative', width: '100%', height: virt.getTotalSize() }}>
                  {virt.getVirtualItems().map(vi => {
                    const it = items[vi.index]
                    return (
                      <div key={vi.key} data-index={vi.index} ref={virt.measureElement}
                        style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start}px)`, paddingBottom: 6 }}>
                        {it.kind === 'table' ? (
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <code style={codeCell}>{it.row.object_key}</code>
                            <input value={it.row.description} onChange={e => patch(it.row.object_key, { description: e.target.value })}
                              placeholder="what one row represents…" style={descInput(it.row._dirty)} />
                          </div>
                        ) : (
                          <ColumnRow r={it.row} onPatch={patch} onVerify={verify} />
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
          </div>
        </div>
      </div>
    </div>
  )
}

function ColumnRow({ r, onPatch, onVerify }: { r: Row; onPatch: (k: string, p: Partial<Row>) => void; onVerify: (k: string) => void }) {
  const isMeasure = r.role === 'measure'
  const isTime = r.role === 'time'
  const proposed = r.status === 'proposed'
  const conf = r.confidence != null ? Math.round(r.confidence * 100) : null
  return (
    <div style={{ padding: '8px 8px 10px', borderRadius: 'var(--radius-sm)', background: proposed ? 'color-mix(in srgb, var(--warning,var(--amber-t)) 7%, transparent)' : 'transparent', border: `1px solid ${r._dirty ? 'var(--accent-bg)' : 'var(--border2)'}` }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <StatusChip status={r.status} />
        <code style={{ ...codeCell, width: 170 }}>{r.object_key}</code>
        <select value={r.role ?? ''} onChange={e => onPatch(r.object_key, { role: (e.target.value || null) as Role })} style={sel}>
          <option value="">— role —</option>
          {ROLES.map(x => <option key={x} value={x}>{x}</option>)}
        </select>
        {isMeasure && <>
          <input value={r.unit ?? ''} onChange={e => onPatch(r.object_key, { unit: e.target.value })} placeholder="unit" style={{ ...sel, width: 64 }} />
          <select value={r.default_aggregation ?? ''} onChange={e => onPatch(r.object_key, { default_aggregation: e.target.value || null })} style={sel}>
            <option value="">agg</option>{AGGS.map(x => <option key={x} value={x}>{x}</option>)}
          </select>
          <select value={r.accumulation ?? ''} onChange={e => onPatch(r.object_key, { accumulation: e.target.value || null })} style={sel}>
            <option value="">accum</option>{ACCS.map(x => <option key={x} value={x}>{x}</option>)}
          </select>
        </>}
        {conf != null && proposed && <span style={{ fontSize: 10, color: conf >= 80 ? 'var(--text3)' : 'var(--warning,var(--amber-t))', marginLeft: 'auto' }}>{conf}%</span>}
        {proposed && <button onClick={() => onVerify(r.object_key)} style={verifyBtn}>Verify</button>}
      </div>
      <input value={r.description ?? ''} onChange={e => onPatch(r.object_key, { description: e.target.value })}
        placeholder="what it means (units where relevant)…" style={{ ...descInput(false), marginTop: 6, width: '100%', boxSizing: 'border-box' }} />
      {proposed && r.evidence && <div style={{ fontSize: 10, color: 'var(--text4)', marginTop: 4, fontStyle: 'italic' }}>AI: {r.evidence}</div>}
    </div>
  )
}

function StatusChip({ status }: { status?: Status | null }) {
  const map = { verified: ['✓', 'var(--success,var(--green-t))'], proposed: ['⚠', 'var(--warning,var(--amber-t))'], rejected: ['✕', 'var(--text4)'] } as const
  const [icon, color] = status && map[status] ? map[status] : ['•', 'var(--text4)']
  return <span title={status || 'unset'} style={{ flexShrink: 0, width: 14, textAlign: 'center', color, fontSize: 12 }}>{icon}</span>
}

function sortRows(rows: Row[]): Row[] {
  return rows.sort((a, b) =>
    a.object_type === b.object_type ? a.object_key.localeCompare(b.object_key) : (a.object_type === 'table' ? -1 : 1))
}

const codeCell: React.CSSProperties = { flexShrink: 0, width: 200, fontSize: 11, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
const descInput = (dirty?: boolean): React.CSSProperties => ({ flex: 1, padding: '6px 10px', border: `1px solid ${dirty ? 'var(--accent-bg)' : 'var(--border2)'}`, borderRadius: 'var(--radius-sm)', background: 'var(--bg)', color: 'var(--text)', fontSize: 12, fontFamily: 'inherit', outline: 'none' })
const sel: React.CSSProperties = { padding: '5px 6px', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', background: 'var(--bg)', color: 'var(--text)', fontSize: 11, fontFamily: 'inherit', outline: 'none' }
const verifyBtn: React.CSSProperties = { padding: '4px 8px', border: '1px solid var(--success,var(--green-t))', borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--success,var(--green-t))', fontSize: 11, cursor: 'pointer' }
const segBtn = (on: boolean): React.CSSProperties => ({ padding: '4px 9px', border: 'none', borderRadius: 'var(--radius-sm)', background: on ? 'var(--surface)' : 'transparent', color: on ? 'var(--text)' : 'var(--text3)', fontSize: 11, cursor: 'pointer', fontWeight: on ? 600 : 400 })

// Full-page (not a centered dialog): a source can have thousands of fields, so the
// dictionary takes over the whole viewport with a sticky toolbar and a scrolling list.
const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'var(--bg)', zIndex: 1000, display: 'flex' }
const page: React.CSSProperties = { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg)' }
const headerBar: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }
const toolbarBar: React.CSSProperties = { borderBottom: '1px solid var(--border)', background: 'var(--surface)', padding: '12px 0' }
const contentWrap: React.CSSProperties = { maxWidth: 1200, margin: '0 auto', width: '100%', padding: '0 20px', boxSizing: 'border-box' }
const backBtn: React.CSSProperties = { background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '4px 10px', cursor: 'pointer', color: 'var(--text2)', fontSize: 12, fontWeight: 600, fontFamily: 'inherit' }
