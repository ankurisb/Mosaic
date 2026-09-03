'use client'

import { useState, useEffect, useCallback } from 'react'

// Chart types the create-dashboard engine supports (must match VizType).
const VIZ_TYPES: { value: string; label: string; needsDim: boolean }[] = [
  { value: 'bar',   label: 'Bar',   needsDim: true },
  { value: 'line',  label: 'Line',  needsDim: true },
  { value: 'donut', label: 'Donut', needsDim: true },
  { value: 'table', label: 'Table', needsDim: false },
  { value: 'kpi',   label: 'KPI (single number)', needsDim: false },
  { value: 'gauge', label: 'Gauge', needsDim: false },
]

/**
 * Build a Superset dashboard from the query the user just ran. Live-validates the
 * chart spec against the real result columns (via /api/superset/validate-dashboard)
 * as the user picks fields, so errors like "dimension and value are the same" or
 * "value column isn't numeric" show HERE, before anything is pushed to Superset.
 */
export function BuildDashboardPanel({ connectionLabel, sql, columns, onClose, onBuilt }: {
  connectionLabel: string
  sql: string
  columns: string[]
  onClose: () => void
  onBuilt: (msg: string) => void
}) {
  const [title, setTitle]   = useState('')
  const [vizType, setViz]   = useState('bar')
  const [dimension, setDim] = useState(columns[0] || '')
  const [value, setValue]   = useState(columns[1] || columns[0] || '')
  const [tableCols, setTableCols] = useState<string[]>(columns)

  const [validation, setValidation] = useState<{ valid: boolean; errors: string[]; warnings: string[] } | null>(null)
  const [validating, setValidating] = useState(false)
  const [building, setBuilding]     = useState(false)
  const [buildError, setBuildError] = useState('')

  const viz = VIZ_TYPES.find(v => v.value === vizType)!

  const chartSpec = useCallback(() => {
    if (vizType === 'table') return { vizType, columns: tableCols }
    if (vizType === 'kpi' || vizType === 'gauge') return { vizType, value }
    return { vizType, dimension, value }
  }, [vizType, dimension, value, tableCols])

  // Live validation, debounced, whenever the spec changes.
  useEffect(() => {
    let cancelled = false
    const t = setTimeout(async () => {
      setValidating(true)
      try {
        const res = await fetch('/api/superset/validate-dashboard', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connectionLabel, sql, chart: chartSpec() }),
        })
        const data = await res.json()
        if (!cancelled) setValidation({ valid: !!data.valid, errors: data.errors || [], warnings: data.warnings || [] })
      } catch {
        if (!cancelled) setValidation(null)
      } finally {
        if (!cancelled) setValidating(false)
      }
    }, 350)
    return () => { cancelled = true; clearTimeout(t) }
  }, [connectionLabel, sql, chartSpec])

  async function build() {
    if (!title.trim() || !validation?.valid) return
    setBuilding(true); setBuildError('')
    try {
      const res = await fetch('/api/superset/create-dashboard', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionLabel, sql, dashboardTitle: title.trim(), chartName: title.trim(), chart: chartSpec() }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        setBuildError(data.error || `Build failed (HTTP ${res.status})`)
        return
      }
      onBuilt(`Dashboard "${title.trim()}" built in Superset.`)
      onClose()
    } catch (e) {
      setBuildError(e instanceof Error ? e.message : 'Build failed')
    } finally {
      setBuilding(false)
    }
  }

  const field = (label: string, node: React.ReactNode) => (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text2)', marginBottom: 5 }}>{label}</div>
      {node}
    </div>
  )
  const selStyle: React.CSSProperties = { width: '100%', background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', padding: '7px 10px', fontSize: 13, color: 'var(--text)', fontFamily: 'inherit', outline: 'none' }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 24 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-md)', width: 'min(480px, 100%)', maxHeight: '86vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', fontFamily: 'Georgia, serif' }}>Build dashboard</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 20, lineHeight: 1, padding: 4 }}>&times;</button>
        </div>

        <div style={{ padding: 20 }}>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 16, lineHeight: 1.6 }}>
            Builds a Superset dashboard from this query on <b style={{ color: 'var(--text2)' }}>{connectionLabel}</b>. The result columns are: {columns.join(', ')}.
          </div>

          {field('Dashboard title', (
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Avg temperature by machine" style={selStyle} />
          ))}

          {field('Chart type', (
            <select value={vizType} onChange={e => setViz(e.target.value)} style={selStyle}>
              {VIZ_TYPES.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
            </select>
          ))}

          {vizType === 'table' ? (
            field('Columns to show', (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {columns.map(c => {
                  const on = tableCols.includes(c)
                  return (
                    <button key={c} onClick={() => setTableCols(on ? tableCols.filter(x => x !== c) : [...tableCols, c])}
                      style={{ fontSize: 12, padding: '4px 10px', borderRadius: 'var(--radius-pill)', border: '1px solid var(--border2)', background: on ? 'var(--bg3)' : 'var(--bg)', color: on ? 'var(--text)' : 'var(--text3)', cursor: 'pointer', fontFamily: 'inherit' }}>{c}</button>
                  )
                })}
              </div>
            ))
          ) : (
            <>
              {viz.needsDim && field('Category (x-axis)', (
                <select value={dimension} onChange={e => setDim(e.target.value)} style={selStyle}>
                  {columns.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              ))}
              {field(viz.needsDim ? 'Value (numeric)' : 'Value', (
                <select value={value} onChange={e => setValue(e.target.value)} style={selStyle}>
                  {columns.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              ))}
            </>
          )}

          {/* Live validation feedback */}
          <div style={{ minHeight: 20, marginTop: 4 }}>
            {validating && <div style={{ fontSize: 11.5, color: 'var(--text3)' }}>Checking…</div>}
            {!validating && validation && validation.errors.map((e, i) => (
              <div key={'e' + i} style={{ fontSize: 11.5, color: 'var(--red-t)', display: 'flex', gap: 6, alignItems: 'flex-start', marginTop: 3 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" style={{ flexShrink: 0, marginTop: 1 }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                {e}
              </div>
            ))}
            {!validating && validation && validation.warnings.map((w, i) => (
              <div key={'w' + i} style={{ fontSize: 11.5, color: 'var(--amber)', display: 'flex', gap: 6, alignItems: 'flex-start', marginTop: 3 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" style={{ flexShrink: 0, marginTop: 1 }}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                {w}
              </div>
            ))}
            {!validating && validation?.valid && validation.errors.length === 0 && (
              <div style={{ fontSize: 11.5, color: 'var(--green-t)', display: 'flex', gap: 6, alignItems: 'center', marginTop: 3 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><polyline points="20 6 9 17 4 12"/></svg>
                Ready to build
              </div>
            )}
          </div>

          {buildError && <div style={{ fontSize: 12, color: 'var(--red-t)', background: 'var(--red-bg, rgba(220,38,38,.06))', borderRadius: 'var(--radius-sm)', padding: '8px 12px', marginTop: 8 }}>{buildError}</div>}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
            <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: 'var(--radius-pill)', border: '1px solid var(--border2)', background: 'var(--bg)', color: 'var(--text2)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
            <button onClick={build} disabled={!title.trim() || !validation?.valid || building}
              style={{ padding: '8px 18px', borderRadius: 'var(--radius-pill)', border: 'none', background: (!title.trim() || !validation?.valid || building) ? 'var(--bg3)' : 'var(--accent-bg)', color: (!title.trim() || !validation?.valid || building) ? 'var(--text4)' : 'var(--accent-fg)', fontSize: 13, fontWeight: 500, cursor: (!title.trim() || !validation?.valid || building) ? 'default' : 'pointer', fontFamily: 'inherit' }}>
              {building ? 'Building…' : 'Build in Superset'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
