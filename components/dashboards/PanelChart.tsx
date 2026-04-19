'use client'
import React from 'react'

interface Panel {
  id: string; title: string; subtitle: string; source_type?: string; source_id?: string; query?: string; refresh_sec?: number | null
  chart_type: string; chart_config: Record<string, unknown>
  col: number; row: number; w: number; h: number
}
interface PanelResult { ok: boolean; data?: unknown; error?: string; latency_ms: number }

interface Props {
  panel: Panel
  result?: PanelResult
  isOwner: boolean
  onEdit: () => void
  onDelete: () => void
  onRefresh: () => void
  onResizeStart?: (e: React.MouseEvent) => void
}

// -- Colour palette --------------------------------------------
const COLOURS = ['#2563eb','#16a34a','#d97706','#7c3aed','#dc2626','#0891b2','#059669','#c026d3']

// -- Data normaliser -------------------------------------------
function normalise(raw: unknown): { rows: Record<string, unknown>[]; keys: string[] } {
  if (!raw) return { rows: [], keys: [] }
  // query_database returns { rows, fields }
  const r = raw as Record<string, unknown>
  let rows: Record<string, unknown>[] = []
  if (Array.isArray(r.rows)) rows = r.rows as Record<string, unknown>[]
  else if (Array.isArray(raw)) rows = raw as Record<string, unknown>[]
  const keys = rows.length ? Object.keys(rows[0]) : []
  return { rows, keys }
}

// -- SVG bar chart ---------------------------------------------
function BarChart({ rows, keys, config }: { rows: Record<string, unknown>[]; keys: string[]; config: Record<string, unknown> }) {
  if (!rows.length || keys.length < 2) return <EmptyChart label="Need 2 columns" />
  const labelKey = config.label_key as string || keys[0]
  const valueKey = config.value_key as string || keys[1]
  const vals = rows.map(r => Number(r[valueKey]) || 0)
  const max = Math.max(...vals) || 1
  const W = 400, H = 160, pL = 40, pB = 28, pT = 10, pR = 8
  const cW = W - pL - pR, cH = H - pT - pB
  const bW = Math.max(4, (cW / rows.length) * 0.65)
  const gap = (cW / rows.length)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }}>
      {[0, 0.25, 0.5, 0.75, 1].map(f => (
        <line key={f} x1={pL} y1={pT + cH * (1 - f)} x2={pL + cW} y2={pT + cH * (1 - f)}
          stroke="var(--border)" strokeWidth="1" />
      ))}
      {rows.map((row, i) => {
        const v = Number(row[valueKey]) || 0
        const bH = Math.max(2, (v / max) * cH)
        const x = pL + gap * i + gap * 0.175
        return (
          <g key={i}>
            <rect x={x} y={pT + cH - bH} width={bW} height={bH}
              fill={COLOURS[i % COLOURS.length]} rx="2" opacity="0.85" />
            <text x={x + bW / 2} y={H - 6} textAnchor="middle"
              fontFamily="var(--font-sans)" fontSize="9" fill="var(--text3)">
              {String(row[labelKey] || '').slice(0, 8)}
            </text>
          </g>
        )
      })}
      {[0, 0.5, 1].map(f => (
        <text key={f} x={pL - 4} y={pT + cH * (1 - f) + 3}
          textAnchor="end" fontFamily="var(--font-mono)" fontSize="8" fill="var(--text3)">
          {Math.round(max * f)}
        </text>
      ))}
    </svg>
  )
}

// -- SVG line chart --------------------------------------------
function LineChart({ rows, keys, config }: { rows: Record<string, unknown>[]; keys: string[]; config: Record<string, unknown> }) {
  if (!rows.length || keys.length < 2) return <EmptyChart label="Need 2 columns" />
  const labelKey = config.label_key as string || keys[0]
  const valueKeys = (config.value_keys as string[]) || [keys[1]]
  const W = 400, H = 150, pL = 38, pB = 24, pT = 10, pR = 8
  const cW = W - pL - pR, cH = H - pT - pB
  const n = rows.length
  const xf = (i: number) => pL + (i / (n - 1)) * cW
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }}>
      {[0, 0.25, 0.5, 0.75, 1].map(f => (
        <line key={f} x1={pL} y1={pT + cH * (1 - f)} x2={pL + cW} y2={pT + cH * (1 - f)}
          stroke="var(--border)" strokeWidth="1" />
      ))}
      {valueKeys.map((vk, vi) => {
        const vals = rows.map(r => Number(r[vk]) || 0)
        const max = Math.max(...vals) || 1, min = 0
        const yf = (v: number) => pT + cH - ((v - min) / (max - min)) * cH
        const pts = vals.map((v, i) => `${xf(i).toFixed(1)},${yf(v).toFixed(1)}`).join(' ')
        return (
          <g key={vk}>
            <polyline points={pts} fill="none" stroke={COLOURS[vi % COLOURS.length]} strokeWidth="2" strokeLinejoin="round" />
            {vals.map((v, i) => <circle key={i} cx={xf(i)} cy={yf(v)} r="3" fill={COLOURS[vi % COLOURS.length]} stroke="var(--surface)" strokeWidth="1.5" />)}
          </g>
        )
      })}
      {rows.map((row, i) => (i === 0 || i === Math.floor(n/2) || i === n-1) && (
        <text key={i} x={xf(i)} y={H - 6} textAnchor="middle"
          fontFamily="var(--font-mono)" fontSize="8" fill="var(--text3)">
          {String(row[labelKey] || '').slice(0, 10)}
        </text>
      ))}
    </svg>
  )
}

// -- KPI number card -------------------------------------------
function NumberCard({ rows, keys, config }: { rows: Record<string, unknown>[]; keys: string[]; config: Record<string, unknown> }) {
  const valueKey = config.value_key as string || keys[0]
  const val = rows.length ? rows[0][valueKey] : '--'
  const unit = config.unit as string || ''
  const prev = config.prev_value as number | undefined
  const delta = prev !== undefined && typeof val === 'number' ? ((val - prev) / prev * 100).toFixed(1) : null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '12px 8px' }}>
      <div style={{ fontSize: 40, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.03em', lineHeight: 1 }}>
        {String(val)}{unit}
      </div>
      {delta && (
        <div style={{ fontSize: 12, fontWeight: 600, color: Number(delta) >= 0 ? 'var(--green-t)' : 'var(--red-t)', marginTop: 6 }}>
          {Number(delta) >= 0 ? '+' : ''}{delta}% vs prev
        </div>
      )}

    </div>
  )
}

// -- Data table ------------------------------------------------
function TableView({ rows, keys }: { rows: Record<string, unknown>[]; keys: string[] }) {
  const displayKeys = keys.slice(0, 6)
  return (
    <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 200 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr>{displayKeys.map(k => (
            <th key={k} style={{ padding: '5px 8px', textAlign: 'left', fontWeight: 600, color: 'var(--text3)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '.06em', borderBottom: '1px solid var(--border2)', whiteSpace: 'nowrap' }}>{k}</th>
          ))}</tr>
        </thead>
        <tbody>
          {rows.slice(0, 20).map((row, i) => (
            <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : 'var(--bg3)' }}>
              {displayKeys.map(k => (
                <td key={k} style={{ padding: '5px 8px', color: 'var(--text2)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {String(row[k] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 20 && (
        <div style={{ padding: '4px 8px', fontSize: 10, color: 'var(--text3)' }}>+{rows.length - 20} more rows</div>
      )}
    </div>
  )
}

// -- Donut chart -----------------------------------------------
function DonutChart({ rows, keys, config }: { rows: Record<string, unknown>[]; keys: string[]; config: Record<string, unknown> }) {
  if (!rows.length || keys.length < 2) return <EmptyChart label="Need 2 columns" />
  const labelKey = config.label_key as string || keys[0]
  const valueKey = config.value_key as string || keys[1]
  const total = rows.reduce((s, r) => s + (Number(r[valueKey]) || 0), 0) || 1
  const cx = 80, cy = 80, r = 55, ir = 32
  let angle = -Math.PI / 2
  const slices = rows.slice(0, 6).map((row, i) => {
    const v = Number(row[valueKey]) || 0
    const sweep = (v / total) * 2 * Math.PI
    const x1 = cx + r * Math.cos(angle), y1 = cy + r * Math.sin(angle)
    const x2 = cx + r * Math.cos(angle + sweep), y2 = cy + r * Math.sin(angle + sweep)
    const xi1 = cx + ir * Math.cos(angle), yi1 = cy + ir * Math.sin(angle)
    const xi2 = cx + ir * Math.cos(angle + sweep), yi2 = cy + ir * Math.sin(angle + sweep)
    const large = sweep > Math.PI ? 1 : 0
    const path = `M${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 ${large} 1 ${x2.toFixed(1)},${y2.toFixed(1)} L${xi2.toFixed(1)},${yi2.toFixed(1)} A${ir},${ir} 0 ${large} 0 ${xi1.toFixed(1)},${yi1.toFixed(1)} Z`
    angle += sweep
    return { path, color: COLOURS[i % COLOURS.length], label: String(row[labelKey] || ''), pct: Math.round(v / total * 100) }
  })
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <svg viewBox="0 0 160 160" style={{ width: 120, flexShrink: 0 }}>
        {slices.map((s, i) => <path key={i} d={s.path} fill={s.color} opacity="0.85" />)}
        <circle cx={cx} cy={cy} r={ir - 2} fill="var(--surface)" />
        <text x={cx} y={cy + 4} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="13" fontWeight="700" fill="var(--text)">{rows.length}</text>
        <text x={cx} y={cy + 16} textAnchor="middle" fontFamily="var(--font-sans)" fontSize="8" fill="var(--text3)">categories</text>
      </svg>
      <div style={{ flex: 1 }}>
        {slices.map((s, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: s.color, flexShrink: 0 }} />
            <span style={{ fontSize: 10, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{s.label}</span>
            <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text3)', flexShrink: 0 }}>{s.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// -- Gauge -----------------------------------------------------
function Gauge({ rows, keys, config }: { rows: Record<string, unknown>[]; keys: string[]; config: Record<string, unknown> }) {
  const valueKey = config.value_key as string || keys[0]
  const val = rows.length ? Number(rows[0][valueKey]) || 0 : 0
  const min = Number(config.min ?? 0), max = Number(config.max ?? 100)
  const unit = config.unit as string || '%'
  const pct = Math.min(1, Math.max(0, (val - min) / (max - min)))
  const angle = -150 + pct * 300
  const rad = (a: number) => a * Math.PI / 180
  const cx = 90, cy = 90, r = 64
  const x = cx + r * Math.cos(rad(angle)), y = cy + r * Math.sin(rad(angle))
  const arcPct = (start: number, end: number, col: string) => {
    const x1 = cx + r * Math.cos(rad(start)), y1 = cy + r * Math.sin(rad(start))
    const x2 = cx + r * Math.cos(rad(end)),   y2 = cy + r * Math.sin(rad(end))
    const large = Math.abs(end - start) > 180 ? 1 : 0
    return <path d={`M${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 ${large} 1 ${x2.toFixed(1)},${y2.toFixed(1)}`} fill="none" stroke={col} strokeWidth="10" strokeLinecap="round" />
  }
  const col = pct > 0.75 ? 'var(--green)' : pct > 0.4 ? 'var(--amber)' : 'var(--red)'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg viewBox="0 0 180 120" style={{ width: 160 }}>
        {arcPct(-150, 150, 'var(--border2)')}
        {arcPct(-150, angle, col)}
        <line x1={cx} y1={cy} x2={x.toFixed(1)} y2={y.toFixed(1)} stroke="var(--text2)" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r="5" fill="var(--text2)" />
        <text x={cx} y={cy + 22} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="18" fontWeight="700" fill="var(--text)">{val.toFixed(1)}{unit}</text>
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', width: 140, marginTop: -8 }}>
        <span style={{ fontSize: 10, color: 'var(--text4)' }}>{min}{unit}</span>
        <span style={{ fontSize: 10, color: 'var(--text4)' }}>{max}{unit}</span>
      </div>
    </div>
  )
}

function EmptyChart({ label }: { label: string }) {
  return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 80, color: 'var(--text4)', fontSize: 11 }}>{label}</div>
}

// -- Chart router ----------------------------------------------
// -- Heatmap ---------------------------------------------------
interface HeatmapData {
  rows: string[]; cols: string[]; values: number[][]
  unit?: string; low?: number; high?: number; good_high?: boolean
}
function HeatmapChart({ data }: { data: unknown }) {
  const d = data as HeatmapData
  const rows = d?.rows || [], cols = d?.cols || [], vals = d?.values || []
  const unit = d?.unit || '', low = d?.low ?? 0, high = d?.high ?? 100
  const goodHigh = d?.good_high !== false
  if (!rows.length || !cols.length) return <EmptyChart label="No data" />

  function cellColor(v: number): string {
    const pct = Math.max(0, Math.min(1, (v - low) / ((high - low) || 1)))
    let r: number, g: number, b: number
    if (goodHigh) {
      if (pct < 0.5) { const t = pct * 2; r = Math.round(220 - t * 3); g = Math.round(38 + t * 81); b = Math.round(38 - t * 32) }
      else           { const t = (pct - 0.5) * 2; r = Math.round(217 - t * 195); g = Math.round(119 + t * 44); b = Math.round(6 + t * 68) }
    } else {
      if (pct < 0.5) { const t = pct * 2; r = Math.round(37 + t * 180); g = Math.round(99 + t * 20); b = Math.round(235 - t * 229) }
      else           { const t = (pct - 0.5) * 2; r = Math.round(217 + t * 3); g = Math.round(119 - t * 81); b = Math.round(6 + t * 32) }
    }
    return `rgb(${r},${g},${b})`
  }
  function textColor(v: number): string {
    const pct = Math.max(0, Math.min(1, (v - low) / ((high - low) || 1)))
    return (pct < 0.25 || pct > 0.75) ? 'rgba(255,255,255,.92)' : 'rgba(0,0,0,.7)'
  }

  const nC = cols.length, nR = rows.length
  const lblW = 70
  const cellW = Math.max(20, Math.min(40, Math.floor((460 - lblW) / nC)))
  const cellH = Math.max(20, Math.min(32, Math.floor(160 / nR)))
  const W = lblW + cellW * nC, H = 20 + cellH * nR + 28
  const legW = Math.min(160, W - lblW)
  const steps = 20

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block', minWidth: lblW + nC * 22 }}>
        {cols.map((col, ci) => (
          <text key={ci}
            x={lblW + ci * cellW + cellW / 2} y={14}
            textAnchor="middle" fontFamily="var(--font-sans)" fontSize="7.5" fill="var(--text3)"
            transform={col.length > 6 ? `rotate(-35,${lblW + ci * cellW + cellW / 2},14)` : undefined}>
            {col}
          </text>
        ))}
        {rows.map((row, ri) => {
          const y = 20 + ri * cellH
          return (
            <g key={ri}>
              <text x={lblW - 4} y={y + cellH / 2 + 3.5}
                textAnchor="end" fontFamily="var(--font-sans)" fontSize="8.5" fill="var(--text2)">{row}</text>
              {(vals[ri] || []).map((v, ci) => (
                <g key={ci}>
                  <rect x={lblW + ci * cellW} y={y} width={cellW - 1} height={cellH - 1}
                    fill={cellColor(v)} rx={2} />
                  {cellW >= 26 && cellH >= 20 && (
                    <text x={lblW + ci * cellW + cellW / 2} y={y + cellH / 2 + 3.5}
                      textAnchor="middle" fontFamily="var(--font-mono)" fontSize="8" fill={textColor(v)}>
                      {v}{unit}
                    </text>
                  )}
                </g>
              ))}
            </g>
          )
        })}
        {Array.from({ length: steps }, (_, i) => {
          const v = low + (i / steps) * (high - low)
          return <rect key={i} x={lblW + i * (legW / steps)} y={H - 22}
            width={legW / steps + 0.5} height={7} fill={cellColor(v)} />
        })}
        <text x={lblW} y={H - 6} fontFamily="var(--font-mono)" fontSize="7.5" fill="var(--text3)">{low}{unit}</text>
        <text x={lblW + legW} y={H - 6} textAnchor="end" fontFamily="var(--font-mono)" fontSize="7.5" fill="var(--text3)">{high}{unit}</text>
        <text x={lblW + legW / 2} y={H - 6} textAnchor="middle" fontFamily="var(--font-sans)" fontSize="7.5" fill="var(--text3)">
          {goodHigh ? 'Low  High' : 'Good  Bad'}
        </text>
      </svg>
    </div>
  )
}

// -- Box plot --------------------------------------------------
function BoxplotChart({ rows, keys, config }: { rows: Record<string, unknown>[]; keys: string[]; config: Record<string, unknown> }) {
  if (!rows.length || keys.length < 2) return <EmptyChart label="Need group + value columns" />
  const gKey = (config.group_key as string) || keys[0]
  const vKey = (config.value_key as string) || keys[1]
  const unit = (config.unit as string) || ''

  const groups: Record<string, number[]> = {}
  const order: string[] = []
  rows.forEach(r => {
    const g = String(r[gKey] || 'Unknown')
    if (!groups[g]) { groups[g] = []; order.push(g) }
    groups[g].push(Number(r[vKey]) || 0)
  })

  function quartiles(arr: number[]) {
    const s = [...arr].sort((a, b) => a - b); const n = s.length
    const q1 = s[Math.floor(n * 0.25)], q3 = s[Math.floor(n * 0.75)]
    const iqr = q3 - q1
    const lo = Math.max(s[0], q1 - 1.5 * iqr)
    const hi = Math.min(s[n - 1], q3 + 1.5 * iqr)
    const med = n % 2 === 0 ? (s[n / 2 - 1] + s[n / 2]) / 2 : s[Math.floor(n / 2)]
    const mean = s.reduce((a, b) => a + b, 0) / n
    return { q1, med, q3, lo, hi, outliers: s.filter(v => v < lo || v > hi), mean }
  }

  const stats = order.map(g => ({ g, s: quartiles(groups[g]) }))
  const allVals = rows.map(r => Number(r[vKey]) || 0)
  const spread = Math.max(...allVals) - Math.min(...allVals)
  const pad = (spread || 1) * 0.1
  const minV = Math.min(...allVals) - pad, maxV = Math.max(...allVals) + pad
  const nG = order.length
  const W = Math.max(300, nG * 80 + 60), H = 170
  const pL = 38, pR = 12, pT = 10, pB = 28
  const cW = W - pL - pR, cH = H - pT - pB
  const bW = Math.min(28, (cW / nG) * 0.55)
  const yf = (v: number) => pT + cH - ((v - minV) / (maxV - minV)) * cH
  const xc = (i: number) => pL + (i + 0.5) * (cW / nG)

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block', minWidth: Math.max(200, nG * 60) }}>
        {[0, 0.25, 0.5, 0.75, 1].map(f => {
          const v = minV + (maxV - minV) * f
          return (
            <g key={f}>
              <line x1={pL} y1={yf(v)} x2={pL + cW} y2={yf(v)} stroke="rgba(0,0,0,.06)" strokeWidth={1} />
              <text x={pL - 4} y={yf(v) + 3} textAnchor="end" fontFamily="var(--font-mono)" fontSize="7.5" fill="var(--text4)">{Math.round(v)}</text>
            </g>
          )
        })}
        {stats.map(({ g, s }, i) => {
          const cx = xc(i), x0 = cx - bW / 2, x1 = cx + bW / 2
          const boxT = Math.min(yf(s.q1), yf(s.q3))
          const boxH = Math.abs(yf(s.q1) - yf(s.q3))
          return (
            <g key={g}>
              <line x1={cx} y1={yf(s.lo)} x2={cx} y2={yf(s.hi)} stroke="#9ca3af" strokeWidth={1.2} strokeDasharray="3,2" />
              <line x1={cx - bW * 0.3} y1={yf(s.lo)} x2={cx + bW * 0.3} y2={yf(s.lo)} stroke="#9ca3af" strokeWidth={1.5} />
              <line x1={cx - bW * 0.3} y1={yf(s.hi)} x2={cx + bW * 0.3} y2={yf(s.hi)} stroke="#9ca3af" strokeWidth={1.5} />
              <rect x={x0} y={boxT} width={bW} height={boxH} fill="rgba(37,99,235,.12)" stroke="#2563eb" strokeWidth={1.5} rx={2} />
              <line x1={x0} y1={yf(s.med)} x2={x1} y2={yf(s.med)} stroke="#2563eb" strokeWidth={2.5} />
              <circle cx={cx} cy={yf(s.mean)} r={2.5} fill="#d97706" stroke="var(--surface)" strokeWidth={1} />
              {s.outliers.map((ov, oi) => (
                <circle key={oi} cx={cx} cy={yf(ov)} r={2} fill="none" stroke="#dc2626" strokeWidth={1.2} />
              ))}
              <text x={cx} y={H - 8} textAnchor="middle" fontFamily="var(--font-sans)" fontSize="8.5" fill="var(--text2)">{g}</text>
              <text x={x1 + 3} y={yf(s.med) + 3} fontFamily="var(--font-mono)" fontSize="7.5" fill="#2563eb">{Math.round(s.med)}{unit}</text>
            </g>
          )
        })}
      </svg>
      <div style={{ display: 'flex', gap: 12, marginTop: 3, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: 'var(--text3)' }}>
          <div style={{ width: 10, height: 10, background: 'rgba(37,99,235,.15)', border: '1px solid #2563eb', borderRadius: 1 }} />IQR
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: 'var(--text3)' }}>
          <div style={{ width: 12, height: 2, background: '#2563eb' }} />Median
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: 'var(--text3)' }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#d97706' }} />Mean
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: 'var(--text3)' }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', border: '1px solid #dc2626' }} />Outlier
        </div>
      </div>
    </div>
  )
}

// -- Sankey chart ----------------------------------------------
function SankeyChart({ rows, keys, config }: { rows: Record<string, unknown>[]; keys: string[]; config: Record<string, unknown> }) {
  if (!rows.length) return <EmptyChart label="No data" />
  const sKey = (config.source_key as string) || keys[0]
  const tKey = (config.target_key as string) || keys[1]
  const vKey = (config.value_key as string) || keys[2] || keys[1]
  const unit = (config.unit as string) || ''

  const flowMap: Record<string, { s: string; t: string; v: number }> = {}
  rows.forEach(r => {
    const s = String(r[sKey] || ''), t = String(r[tKey] || ''), v = Number(r[vKey]) || 0
    const k = `${s}${t}`
    if (!flowMap[k]) flowMap[k] = { s, t, v: 0 }
    flowMap[k].v += v
  })
  const flows = Object.values(flowMap)
  const lTotals: Record<string, number> = {}, rTotals: Record<string, number> = {}
  flows.forEach(f => {
    lTotals[f.s] = (lTotals[f.s] || 0) + f.v
    rTotals[f.t] = (rTotals[f.t] || 0) + f.v
  })
  const lNodes = Object.keys(lTotals).sort(), rNodes = Object.keys(rTotals).sort()
  const totalFlow = lNodes.reduce((s, k) => s + lTotals[k], 0) || 1
  const W = 460, nW = 14, pL = 14, pR = 14, pT = 12
  const H = Math.max(140, Math.max(lNodes.length, rNodes.length) * 32 + 24)
  const cH = H - pT * 2
  const lX = pL + nW, rX = W - pR - nW
  const lPos: Record<string, number> = {}, rPos: Record<string, number> = {}
  lNodes.forEach((n, i) => { lPos[n] = pT + (i + 0.5) * (cH / lNodes.length) })
  rNodes.forEach((n, i) => { rPos[n] = pT + (i + 0.5) * (cH / rNodes.length) })
  const lOff: Record<string, number> = {}, rOff: Record<string, number> = {}
  lNodes.forEach(n => { lOff[n] = lPos[n] - (lTotals[n] / totalFlow) * cH * 0.5 })
  rNodes.forEach(n => { rOff[n] = rPos[n] - (rTotals[n] / totalFlow) * cH * 0.5 })
  const mx = (lX + rX) / 2

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }}>
      {flows.map((f, fi) => {
        const fH = Math.max(2, (f.v / totalFlow) * cH * 0.85)
        const lY = lOff[f.s], rY = rOff[f.t]
        lOff[f.s] += fH + 1; rOff[f.t] += fH + 1
        const col = COLOURS[lNodes.indexOf(f.s) % COLOURS.length]
        const path = `M ${lX},${lY + fH / 2} C ${mx},${lY + fH / 2} ${mx},${rY + fH / 2} ${rX},${rY + fH / 2}`
        return (
          <g key={fi}>
            <path d={path} fill="none" stroke={col} strokeWidth={fH} opacity={0.35} />
            {fH >= 8 && (
              <text x={mx} y={Math.min(lY, rY) + fH / 2 + 3}
                textAnchor="middle" fontFamily="var(--font-mono)" fontSize="7.5" fill={col} opacity={0.8}>
                {Math.round(f.v)}{unit}
              </text>
            )}
          </g>
        )
      })}
      {lNodes.map((n, i) => {
        const nH = Math.max(10, (lTotals[n] / totalFlow) * cH * 0.85)
        const y = lPos[n] - nH / 2, col = COLOURS[i % COLOURS.length]
        return (
          <g key={n}>
            <rect x={pL} y={y} width={nW} height={nH} fill={col} rx={2} />
            <text x={pL + nW + 5} y={y + nH / 2 + 3.5} fontFamily="var(--font-sans)" fontSize="9" fill="var(--text)" fontWeight="500">{n}</text>
            <text x={pL + nW + 5} y={y + nH / 2 + 13.5} fontFamily="var(--font-mono)" fontSize="7.5" fill="var(--text3)">{Math.round(lTotals[n])}{unit}</text>
          </g>
        )
      })}
      {rNodes.map(n => {
        const nH = Math.max(10, (rTotals[n] / totalFlow) * cH * 0.85)
        const y = rPos[n] - nH / 2
        return (
          <g key={n}>
            <rect x={rX} y={y} width={nW} height={nH} fill="#94a3b8" rx={2} />
            <text x={rX - 5} y={y + nH / 2 + 3.5} textAnchor="end" fontFamily="var(--font-sans)" fontSize="9" fill="var(--text)" fontWeight="500">{n}</text>
            <text x={rX - 5} y={y + nH / 2 + 13.5} textAnchor="end" fontFamily="var(--font-mono)" fontSize="7.5" fill="var(--text3)">{Math.round(rTotals[n])}{unit}</text>
          </g>
        )
      })}
    </svg>
  )
}


function ChartBody({ type, data, config }: { type: string; data: unknown; config: Record<string, unknown> }) {
  const { rows, keys } = normalise(data)
  if (!rows.length) return <EmptyChart label="No data" />
  switch (type) {
    case 'bar':    return <BarChart    rows={rows} keys={keys} config={config} />
    case 'line':   return <LineChart   rows={rows} keys={keys} config={config} />
    case 'number': return <NumberCard  rows={rows} keys={keys} config={config} />
    case 'table':  return <TableView   rows={rows} keys={keys} />
    case 'donut':  return <DonutChart  rows={rows} keys={keys} config={config} />
    case 'gauge':   return <Gauge        rows={rows} keys={keys} config={config} />
    case 'heatmap': return <HeatmapChart data={data} />
    case 'boxplot': return <BoxplotChart rows={rows} keys={keys} config={config} />
    case 'sankey':  return <SankeyChart  rows={rows} keys={keys} config={config} />
    default:        return <BarChart     rows={rows} keys={keys} config={config} />
  }
}

// -- Panel card ------------------------------------------------
export default function PanelChart({ panel, result, isOwner, onEdit, onDelete, onRefresh, onResizeStart }: Props) {
  const colSpan = Math.min(Math.max(panel.w, 1), 4)
  const rowSpan = panel.h >= 2 ? 2 : 1
  return (
    <div className="fade-in" data-panel-id={panel.id} style={{ gridColumn: `span ${colSpan}`, gridRow: `span ${rowSpan}`, position: 'relative', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
      {/* Panel header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '12px 14px 8px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{panel.title}</div>
          {panel.subtitle && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>{panel.subtitle}</div>}
        </div>
        <div style={{ display: 'flex', gap: 4, marginLeft: 8, flexShrink: 0 }}>
          <button onClick={onRefresh} title="Refresh panel"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text4)', padding: '2px 4px', borderRadius: 4, fontSize: 11, fontFamily: 'inherit' }}>
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M10 5.5a4.5 4.5 0 1 1-1.3-3.1"/><path d="M10 1v3H7"/>
            </svg>
          </button>
          {isOwner && <>
            <button onClick={onEdit} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text4)', padding: '2px 4px', borderRadius: 4, fontSize: 11, fontFamily: 'inherit' }}>
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M7.5 1.5l2 2-6 6-2.5.5.5-2.5z"/></svg>
            </button>
            <button onClick={onDelete} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text4)', padding: '2px 4px', borderRadius: 4, fontSize: 11, fontFamily: 'inherit' }}>
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><line x1="2" y1="2" x2="9" y2="9"/><line x1="9" y1="2" x2="2" y2="9"/></svg>
            </button>
          </>}
        </div>
      </div>

      {/* Panel body */}
      <div style={{ padding: '4px 14px 12px' }}>
        {!result ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 80, color: 'var(--text4)', fontSize: 12 }}>
            <span style={{ display: 'inline-block', width: 14, height: 14, border: '1.5px solid var(--border2)', borderTopColor: 'var(--text3)', borderRadius: '50%', animation: 'spin .7s linear infinite', marginRight: 6 }} />
            Loading...
          </div>
        ) : !result.ok ? (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: '8px 10px', background: 'var(--red-bg)', border: '1px solid rgba(220,38,38,.2)', borderRadius: 6, fontSize: 11, color: 'var(--red-t)' }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ flexShrink: 0, marginTop: 1 }}><circle cx="6" cy="6" r="5.5"/><path d="M6 4v3M6 8.5v.5"/></svg>
            {result.error}
          </div>
        ) : (
          <ChartBody type={panel.chart_type} data={result.data} config={panel.chart_config} />
        )}
        {result && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
            <span style={{ fontSize: 9, color: 'var(--text4)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{panel.source_type}</span>
            <span style={{ fontSize: 9, color: 'var(--text4)', fontFamily: 'var(--font-mono)' }}>{result.latency_ms}ms</span>
          </div>
        )}
      </div>
    </div>
  )
}
