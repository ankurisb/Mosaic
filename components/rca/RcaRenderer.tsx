'use client'
import React from 'react'
import type { RcaBlock, RendererPayload } from '@/lib/rca'

// -- CSS variable aliases --------------------------------------------------
const V = {
  surface:   'var(--surface)',
  bg:        'var(--bg)',
  bg3:       'var(--bg3)',
  border:    'var(--border)',
  border2:   'var(--border2)',
  text:      'var(--text)',
  text2:     'var(--text2)',
  text3:     'var(--text3)',
  text4:     'var(--text4)',
  red:       'var(--red)',    redBg:   'var(--red-bg)',   redT:   'var(--red-t)',
  green:     'var(--green)',  greenBg: 'var(--green-bg)', greenT: 'var(--green-t)',
  amber:     'var(--amber)',  amberBg: 'var(--amber-bg)', amberT: 'var(--amber-t)',
  blue:      'var(--blue)',   blueBg:  'var(--blue-bg)',  blueT:  'var(--blue-t)',
  purple:    'var(--purple)', purpleBg:'var(--purple-bg)',
  radius:    'var(--radius)',
  radiusSm:  'var(--radius-sm)',
  radiusPill:'var(--radius-pill)',
  shadow:    'var(--shadow)',
  mono:      'var(--font-mono)',
  sans:      'var(--font-sans)',
}

// -- Shared primitives -----------------------------------------------------

function Wrap({ children }: { children: React.ReactNode }) {
  return <div style={{ borderTop: `1px solid ${V.border}`, background: V.bg, padding: '18px 0 6px', marginTop: 12 }}>{children}</div>
}

function RTitle({ num, label, sub }: { num: string; label: string; sub?: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: V.text3, textTransform: 'uppercase', letterSpacing: '.08em' }}>
        {num} {label}
      </div>
      {sub && <div style={{ fontSize: 12, fontWeight: 500, color: V.text, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function Insight({ text }: { text: string }) {
  return (
    <div style={{ background: V.blueBg, borderLeft: `3px solid ${V.blue}`, borderRadius: `0 ${V.radiusSm} ${V.radiusSm} 0`, padding: '9px 13px', margin: '10px 0', fontSize: 12, color: V.blueT, lineHeight: 1.6 }}>
      <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.09em', marginBottom: 3, opacity: 0.8 }}>Key insight</div>
      {text}
    </div>
  )
}

function Actions({ items }: { items: string[] }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
      {items.map(a => (
        <button key={a} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', border: `1px solid ${V.border2}`, borderRadius: V.radiusPill, background: V.surface, fontSize: 11, fontWeight: 500, color: V.text2, cursor: 'pointer', fontFamily: V.sans }}>
          {a}
          <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 8L8 2M4 2h4v4" /></svg>
        </button>
      ))}
    </div>
  )
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background: V.surface, border: `1px solid ${V.border}`, borderRadius: V.radius, boxShadow: V.shadow, overflow: 'hidden', marginBottom: 10, ...style }}>{children}</div>
}

function KpiGrid({ items }: { items: { label: string; value: string; sub?: string }[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(items.length, 4)}, 1fr)`, gap: 8, marginBottom: 14 }}>
      {items.map(k => (
        <div key={k.label} style={{ background: V.surface, border: `1px solid ${V.border}`, borderRadius: V.radius, padding: '11px 13px', boxShadow: V.shadow }}>
          <div style={{ fontSize: 10, fontWeight: 500, color: V.text3, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 3 }}>{k.label}</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: V.text, letterSpacing: '-.02em', lineHeight: 1 }}>{k.value}</div>
          {k.sub && <div style={{ fontSize: 10, color: V.text3, marginTop: 2 }}>{k.sub}</div>}
        </div>
      ))}
    </div>
  )
}

function Tbl({ children }: { children: React.ReactNode }) {
  return <table style={{ width: '100%', borderCollapse: 'collapse' }}>{children}</table>
}
function Th({ ch }: { ch: string }) {
  return <th style={{ padding: '7px 10px', textAlign: 'left', fontSize: 10, fontWeight: 600, color: V.text3, textTransform: 'uppercase', letterSpacing: '.06em', borderBottom: `1px solid ${V.border2}` }}>{ch}</th>
}
function Td({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <td style={{ padding: '9px 10px', borderBottom: `1px solid ${V.border}`, verticalAlign: 'middle', ...style }}>{children}</td>
}

function ClsBadge({ cls }: { cls: string }) {
  const styles: Record<string, React.CSSProperties> = {
    root:   { background: V.greenBg, color: V.greenT, border: `1px solid rgba(22,163,74,.2)` },
    vital:  { background: V.redBg,   color: V.redT,   border: `1px solid rgba(220,38,38,.2)` },
    useful: { background: V.amberBg, color: V.amberT, border: `1px solid rgba(217,119,6,.2)` },
  }
  const labels: Record<string, string> = { root: 'Root cause', vital: 'Vital few', useful: 'Useful many' }
  return <span style={{ display: 'inline-block', padding: '2px 7px', borderRadius: V.radiusPill, fontSize: 10, fontWeight: 600, ...styles[cls] }}>{labels[cls] ?? cls}</span>
}

function InlineBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontFamily: V.mono, fontSize: 11, fontWeight: 500, minWidth: 32 }}>{pct}%</span>
      <div style={{ width: 72, height: 4, background: V.border2, borderRadius: 99, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 99 }} />
      </div>
    </div>
  )
}

// -- R1: PARETO ------------------------------------------------------------
function ParetoR({ data, insight }: { data: Extract<RendererPayload,{type:'pareto'}>['data']; insight?: string }) {
  const { rows, total } = data
  const max = rows[0]?.defects || 1
  const vital = rows.filter((r: any) => r.vital).length
  let running = 0
  const cums = rows.map(r => { running += r.defects; return (running / total * 100).toFixed(0) })
  return (
    <Wrap>
      <RTitle num="" label="Pareto analysis" sub={`${total} defects . ${vital} vital categories`} />
      <KpiGrid items={[
        { label: 'Total defects', value: String(total) },
        { label: 'Vital few', value: `${vital} categories` },
        { label: 'Top cause', value: `${Math.round((rows[0]?.defects||0)/total*100)}%` },
        { label: '80% threshold', value: `${Math.round(total*0.8)} defects` },
      ]} />
      <Card>
        <div style={{ padding: '14px 14px 10px' }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: V.text3, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 12 }}>Pareto -- defect count by 6M category</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 110 }}>
            {rows.map((r, i) => {
              const h = Math.max(3, Math.round((r.defects / max) * 90))
              return (
                <div key={r.cat} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{ fontSize: 9, fontFamily: V.mono, color: (r as any).vital ? V.red : V.text3, marginBottom: 2 }}>{cums[i]}%</div>
                  <div title={`${r.cat}: ${r.defects}`} style={{ width: '100%', height: h, background: (r as any).vital ? V.red : '#c4bfb4', borderRadius: '3px 3px 0 0', opacity: 0.85 }} />
                  <div style={{ fontSize: 9, color: V.text3, marginTop: 4, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>{r.cat.slice(0, 5)}</div>
                </div>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
            {[['var(--red)', 'Vital few (80%)'], ['#c4bfb4', 'Useful many']].map(([c, l]) => (
              <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: V.text2 }}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: c }} />{l}
              </div>
            ))}
          </div>
        </div>
      </Card>
      {insight && <Insight text={insight} />}
      <Actions items={['Drill into top category', 'Show breakdown table', 'Export to Word']} />
    </Wrap>
  )
}

// -- R2: BREAKDOWN ---------------------------------------------------------
function BreakdownR({ data, insight }: { data: Extract<RendererPayload,{type:'breakdown'}>['data']; insight?: string }) {
  return (
    <Wrap>
      <RTitle num="" label="6M breakdown table" />
      <Card>
        <Tbl><thead><tr>{['Rank','Category','Defects','Share','Cumulative','Class'].map(h => <Th key={h} ch={h} />)}</tr></thead>
          <tbody>{data.rows.map((r, i) => (
            <tr key={r.cat}>
              <Td><span style={{ fontFamily: V.mono, fontSize: 11, color: V.text3 }}>{i+1}</span></Td>
              <Td><span style={{ fontWeight: 600, fontSize: 12 }}>{r.cat}</span></Td>
              <Td><span style={{ fontFamily: V.mono, fontWeight: 600 }}>{r.defects}</span></Td>
              <Td><InlineBar pct={r.share} color={(r as any).vital ? V.red : '#c4bfb4'} /></Td>
              <Td><span style={{ fontFamily: V.mono, fontSize: 11, color: V.text2 }}>{r.cumulative.toFixed(1)}%</span></Td>
              <Td><ClsBadge cls={r.cls} /></Td>
            </tr>
          ))}</tbody>
        </Tbl>
      </Card>
      {insight && <Insight text={insight} />}
      <Actions items={['Drill into top category', 'Export to Word']} />
    </Wrap>
  )
}

// -- R3: SUBCAUSE ----------------------------------------------------------
function SubcauseR({ data, insight }: { data: Extract<RendererPayload,{type:'subcause'}>['data']; insight?: string }) {
  return (
    <Wrap>
      <RTitle num="" label="Sub-cause breakdown" sub={`Drilling into ${data.bone} . ${data.rows.reduce((s,r)=>s+r.defects,0)} of ${data.total} defects`} />
      <Card>
        <Tbl><thead><tr>{['Rank','Sub-cause','Defects',`Share of ${data.bone}`,'Share of all','Cumulative','Class'].map(h => <Th key={h} ch={h} />)}</tr></thead>
          <tbody>{data.rows.map((r, i) => {
            const fc = r.cls==='root' ? V.green : r.cls==='vital' ? V.red : '#c4bfb4'
            return (
              <tr key={r.cause}>
                <Td><span style={{ fontFamily: V.mono, fontSize: 11, color: V.text3 }}>{i+1}</span></Td>
                <Td><div style={{ fontWeight: 600, fontSize: 12 }}>{r.cause}</div><div style={{ fontSize: 10, color: V.text3, marginTop: 1 }}>{r.sub}</div></Td>
                <Td><span style={{ fontFamily: V.mono, fontWeight: 600 }}>{r.defects}</span></Td>
                <Td><InlineBar pct={r.share_bone} color={fc} /></Td>
                <Td><span style={{ fontFamily: V.mono, fontSize: 11, color: V.text2 }}>{r.share_all}%</span></Td>
                <Td><span style={{ fontFamily: V.mono, fontSize: 11, color: V.text2 }}>{r.cum}%</span></Td>
                <Td><ClsBadge cls={r.cls} /></Td>
              </tr>
            )
          })}</tbody>
        </Tbl>
      </Card>
      {insight && <Insight text={insight} />}
      <Actions items={['Run 5 Whys on top cause', 'Back to Pareto', 'Export to Word']} />
    </Wrap>
  )
}

// -- R4: FISHBONE ----------------------------------------------------------
const BONE_COL: Record<string, { stroke: string; light: string }> = {
  Machine:     { stroke: '#1d5fa0', light: '#eef3fb' },
  Method:      { stroke: '#2d8a5e', light: '#edf7f2' },
  Material:    { stroke: '#6b4ea0', light: '#f3eefb' },
  Manpower:    { stroke: '#b0451a', light: '#fdf3ec' },
  Measurement: { stroke: '#8a6000', light: '#fdf7e6' },
  Environment: { stroke: '#2d6a4f', light: '#edf7f2' },
}
const DEFAULT_COL = { stroke: '#6b6760', light: '#f5f5f3' }
function FishboneR({ data, insight }: { data: Extract<RendererPayload,{type:'fishbone'}>['data']; insight?: string }) {
  const top = data.bones.filter((_, i) => i % 2 === 0).slice(0, 3)
  const bot = data.bones.filter((_, i) => i % 2 === 1).slice(0, 3)
  const xPos = [155, 435, 695]
  return (
    <Wrap>
      <RTitle num="" label="Ishikawa / Fishbone -- 5M1E" sub="All cause branches populated from data" />
      <Card style={{ overflow: 'hidden' }}>
        <svg viewBox="0 0 880 380" style={{ width: '100%', display: 'block' }}>
          <line x1="55" y1="190" x2="810" y2="190" stroke="#b0aca4" strokeWidth="2.5" />
          <polygon points="810,190 797,183 797,197" fill="#b0aca4" />
          <rect x="816" y="163" width="60" height="54" rx="7" fill="#fdf0ee" stroke="#f5c4be" strokeWidth="1.5" />
          <text x="846" y="187" textAnchor="middle" fontFamily="sans-serif" fontSize="9" fontWeight="600" fill="#c0392b">{data.problem.slice(0,14)}</text>
          <text x="846" y="200" textAnchor="middle" fontFamily="sans-serif" fontSize="8" fill="#c0392b">{data.problem.slice(14,28)}</text>
          <text x="846" y="212" textAnchor="middle" fontFamily="sans-serif" fontSize="8" fill="#c0392b">{data.problem.slice(28,42)}</text>
          {top.map((bone, bi) => {
            const x = xPos[bi], col = BONE_COL[bone.name] ?? DEFAULT_COL
            return (
              <g key={bone.name}>
                <line x1={x} y1="190" x2={x} y2="108" stroke={col.stroke} strokeWidth="2" />
                <rect x={x-42} y="30" width="84" height="24" rx="5" fill={col.light} stroke={col.stroke} strokeWidth="1.5" />
                <text x={x} y="46" textAnchor="middle" fontFamily="sans-serif" fontSize="11" fontWeight="600" fill={col.stroke}>{bone.name}</text>
                {bone.causes.map((c, ci) => {
                  const offsets = [-50, 0, 50], cx = x + offsets[ci], cy = 112 - ci * 24
                  return (
                    <g key={c}>
                      <line x1={x + offsets[ci] * 0.38} y1="190" x2={cx} y2={cy} stroke={col.stroke} strokeWidth="1.2" opacity="0.65" />
                      <text x={cx} y={cy - 4} textAnchor={cx < x - 8 ? 'end' : cx > x + 8 ? 'start' : 'middle'} fontFamily="sans-serif" fontSize="9.5" fill={col.stroke} opacity="0.9">{c}</text>
                    </g>
                  )
                })}
              </g>
            )
          })}
          {bot.map((bone, bi) => {
            const x = xPos[bi], col = BONE_COL[bone.name] ?? DEFAULT_COL
            return (
              <g key={bone.name}>
                <line x1={x} y1="190" x2={x} y2="278" stroke={col.stroke} strokeWidth="2" />
                <rect x={x-42} y="283" width="84" height="24" rx="5" fill={col.light} stroke={col.stroke} strokeWidth="1.5" />
                <text x={x} y="299" textAnchor="middle" fontFamily="sans-serif" fontSize="11" fontWeight="600" fill={col.stroke}>{bone.name}</text>
                {bone.causes.map((c, ci) => {
                  const offsets = [-50, 0, 50], cx = x + offsets[ci], cy = 196 + ci * 24
                  return (
                    <g key={c}>
                      <line x1={x + offsets[ci] * 0.38} y1="190" x2={cx} y2={cy} stroke={col.stroke} strokeWidth="1.2" opacity="0.65" />
                      <text x={cx} y={cy + 12} textAnchor={cx < x - 8 ? 'end' : cx > x + 8 ? 'start' : 'middle'} fontFamily="sans-serif" fontSize="9.5" fill={col.stroke} opacity="0.9">{c}</text>
                    </g>
                  )
                })}
              </g>
            )
          })}
        </svg>
      </Card>
      {insight && <Insight text={insight} />}
      <Actions items={['Run 5 Whys on top cause', 'View as Pareto', 'Export to Word']} />
    </Wrap>
  )
}

// -- R5: 5 WHYS ------------------------------------------------------------
function FiveWhysR({ data, insight }: { data: Extract<RendererPayload,{type:'five_whys'}>['data']; insight?: string }) {
  const boxStyle: Record<string, React.CSSProperties> = {
    problem: { background: V.redBg,   border: `1.5px solid rgba(220,38,38,.25)` },
    why:     { background: V.blueBg,  border: `1.5px solid rgba(37,99,235,.2)` },
    root:    { background: V.greenBg, border: `1.5px solid rgba(22,163,74,.25)` },
  }
  const headColor: Record<string, string> = { problem: V.red, why: V.blue, root: V.green }
  return (
    <Wrap>
      <RTitle num="" label="5 Whys" sub={`Drilling into "${data.drilling}"`} />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {data.chain.map((step, i) => (
          <React.Fragment key={i}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%', maxWidth: 600 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: V.text3, textTransform: 'uppercase', letterSpacing: '.06em', width: 46, flexShrink: 0, paddingTop: 13, textAlign: 'right' }}>{step.label}</div>
              <div style={{ flex: 1, borderRadius: V.radius, padding: '11px 14px', position: 'relative', ...boxStyle[step.type] }}>
                {step.type === 'root' && <span style={{ position: 'absolute', top: 9, right: 9, background: V.green, color: '#fff', fontSize: 8, fontWeight: 700, padding: '2px 5px', borderRadius: 3, letterSpacing: '.06em' }}>ROOT</span>}
                <div style={{ fontSize: 12, fontWeight: 600, color: headColor[step.type], marginBottom: 2 }}>{step.head}</div>
                <div style={{ fontSize: 11, color: V.text2 }}>{step.detail}</div>
              </div>
            </div>
            {i < data.chain.length - 1 && (
              <div style={{ display: 'flex', justifyContent: 'center', height: 16, marginLeft: 56 }}>
                <svg width="9" height="14" viewBox="0 0 9 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ opacity: 0.35 }}>
                  <line x1="4.5" y1="0" x2="4.5" y2="10" /><polyline points="1,7 4.5,13 8,7" />
                </svg>
              </div>
            )}
          </React.Fragment>
        ))}
      </div>
      {insight && <Insight text={insight} />}
      <Actions items={['Generate corrective action plan', 'Export to Word']} />
    </Wrap>
  )
}

// -- R6: CAP ---------------------------------------------------------------
const CAUSE_COL: Record<string, string> = {
  Measurement: 'var(--blue)', Machine: '#1a6b6b', Method: 'var(--purple)',
  Manpower: '#c45c1a', Material: '#8a6000', Environment: 'var(--green)',
}
function CapR({ data, insight }: { data: Extract<RendererPayload,{type:'cap'}>['data']; insight?: string }) {
  const priBg: Record<string, React.CSSProperties> = {
    critical: { background: V.redBg,   color: V.redT,   border: `1px solid rgba(220,38,38,.2)` },
    high:     { background: V.amberBg, color: V.amberT, border: `1px solid rgba(217,119,6,.2)` },
    medium:   { background: V.greenBg, color: V.greenT, border: `1px solid rgba(22,163,74,.2)` },
  }
  return (
    <Wrap>
      <RTitle num="" label="Corrective action plan" sub={data.root} />
      <Card>
        <Tbl>
          <thead><tr>{['#','Action','Cause','Owner','Due','Priority','Status'].map(h => <Th key={h} ch={h} />)}</tr></thead>
          <tbody>{data.actions.map(a => {
            const cc = CAUSE_COL[a.cause] ?? V.blue
            return (
              <tr key={a.n}>
                <Td><span style={{ fontFamily: V.mono, fontSize: 11, color: V.text3 }}>{a.n}</span></Td>
                <Td style={{ fontSize: 12, lineHeight: 1.5, maxWidth: 220 }}>{a.action}</Td>
                <Td><span style={{ display: 'inline-block', padding: '2px 7px', borderRadius: 4, fontSize: 10, fontWeight: 500, background: `${cc}15`, color: cc, border: `1px solid ${cc}30` }}>{a.cause}</span></Td>
                <Td style={{ fontSize: 11, color: V.text2 }}>{a.owner}</Td>
                <Td style={{ fontFamily: V.mono, fontSize: 11, color: V.text2, whiteSpace: 'nowrap' }}>{a.due}</Td>
                <Td><span style={{ display: 'inline-block', padding: '2px 7px', borderRadius: V.radiusPill, fontSize: 10, fontWeight: 600, ...priBg[a.priority] }}>{a.priority.charAt(0).toUpperCase() + a.priority.slice(1)}</span></Td>
                <Td>
                  {a.status === 'progress' && <span style={{ fontSize: 11, fontWeight: 500, color: V.blue }}>In progress</span>}
                  {a.status === 'overdue'  && <span style={{ fontSize: 11, fontWeight: 500, color: V.red }}>Overdue</span>}
                  {a.status === 'planned'  && <span style={{ fontSize: 11, color: V.text3 }}>Planned</span>}
                </Td>
              </tr>
            )
          })}</tbody>
        </Tbl>
      </Card>
      {insight && <Insight text={insight} />}
      <Actions items={['Export as Word doc', 'Mark action complete', 'Change the problem']} />
    </Wrap>
  )
}

// -- R7: SPC ---------------------------------------------------------------
function SpcR({ data, insight }: { data: Extract<RendererPayload,{type:'spc'}>['data']; insight?: string }) {
  const { subgroups, ucl, lcl, uwl, lwl, nominal, violations } = data
  const vals = subgroups.map(s => s.mean)
  const minV = Math.min(...vals, lcl) - 0.005, maxV = Math.max(...vals, ucl) + 0.005
  const n = subgroups.length
  const W = 700, H = 140, pL = 48, pR = 10, pT = 6, pB = 22
  const cW = W - pL - pR, cH = H - pT - pB
  const x = (i: number) => pL + (i / (n - 1)) * cW
  const y = (v: number) => pT + cH - ((v - minV) / (maxV - minV)) * cH
  const oors = subgroups.filter(s => s.oor).length
  return (
    <Wrap>
      <RTitle num="" label="SPC control chart (X)" sub={data.title} />
      <KpiGrid items={[{ label: 'UCL', value: ucl.toFixed(3) }, { label: 'LCL', value: lcl.toFixed(3) }, { label: 'Nominal', value: nominal.toFixed(3) }, { label: 'Violations', value: String(oors), sub: 'out of control' }]} />
      {oors > 0 && <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: V.radiusPill, background: V.redBg, border: `1px solid rgba(220,38,38,.2)`, color: V.redT, fontSize: 11, fontWeight: 600, marginBottom: 10 }}>Out of control -- {oors} point{oors !== 1 ? 's' : ''} beyond UCL</div>}
      <Card>
        <div style={{ padding: '12px 14px 8px' }}>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }}>
            {[{ v: ucl, c: V.red, d: '6,4', lbl: 'UCL', w: 1.5 }, { v: uwl, c: '#f0a090', d: '3,3', lbl: 'UWL', w: 1 }, { v: nominal, c: '#b0aca4', d: '3,3', lbl: 'CL', w: 1 }, { v: lwl, c: '#a0c8b0', d: '3,3', lbl: 'LWL', w: 1 }, { v: lcl, c: V.red, d: '6,4', lbl: 'LCL', w: 1.5 }].map(l => (
              <g key={l.lbl}>
                <line x1={pL} y1={y(l.v)} x2={pL + cW} y2={y(l.v)} stroke={l.c} strokeWidth={l.w} strokeDasharray={l.d} opacity="0.7" />
                <text x={pL - 3} y={y(l.v) + 4} textAnchor="end" fontFamily="monospace" fontSize="8" fill={l.c} opacity="0.8">{l.lbl}</text>
              </g>
            ))}
            <polyline points={subgroups.map((_,i) => `${x(i).toFixed(1)},${y(vals[i]).toFixed(1)}`).join(' ')} fill="none" stroke={V.blue} strokeWidth="1.5" strokeLinejoin="round" />
            {subgroups.map((sg, i) => <circle key={i} cx={x(i)} cy={y(sg.mean)} r="3.5" fill={sg.oor ? V.red : V.blue} stroke="#fff" strokeWidth="1.5" />)}
            {subgroups.map((sg, i) => i % 2 === 0 && <text key={i} x={x(i)} y={H - 4} textAnchor="middle" fontFamily="monospace" fontSize="7.5" fill={V.text3}>{sg.t}</text>)}
          </svg>
        </div>
      </Card>
      {violations.map((v, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 10px', background: V.redBg, border: `1px solid rgba(220,38,38,.2)`, borderRadius: V.radiusSm, fontSize: 11, color: V.redT, marginBottom: 6 }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="5.5" stroke="currentColor" strokeWidth="1.5" /><path d="M6 4v3M6 8.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          {v}
        </div>
      ))}
      {insight && <Insight text={insight} />}
      <Actions items={['Show Range chart', 'Overlay on timeline', 'Export to Word']} />
    </Wrap>
  )
}

// -- R8: FAULT TREE --------------------------------------------------------
function FaultTreeR({ data, insight }: { data: Extract<RendererPayload,{type:'fault_tree'}>['data']; insight?: string }) {
  return (
    <Wrap>
      <RTitle num="" label="Fault tree analysis" sub={`Top event: ${data.top}`} />
      <Card style={{ padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
          <div style={{ background: V.redBg, border: `1.5px solid rgba(220,38,38,.25)`, borderRadius: V.radius, padding: '9px 18px', textAlign: 'center' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: V.red }}>{data.top}</div>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
          <div style={{ background: V.bg3, border: `1px solid ${V.border2}`, borderRadius: 6, padding: '3px 12px', fontSize: 10, fontWeight: 600, color: V.text3 }}>OR gate -- any single event sufficient</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(data.events.length, 3)}, 1fr)`, gap: 8 }}>
          {data.events.map(ev => (
            <div key={ev.id} style={{ background: ev.root ? V.amberBg : V.bg, border: `1.5px solid ${ev.root ? 'rgba(217,119,6,.3)' : V.border}`, borderRadius: V.radius, padding: '10px 12px', textAlign: 'center' }}>
              <div style={{ fontSize: 11, fontWeight: ev.root ? 700 : 500, color: ev.root ? V.amber : V.text, marginBottom: 5, lineHeight: 1.4 }}>{ev.label}</div>
              <div style={{ fontFamily: V.mono, fontSize: 16, fontWeight: 700, color: ev.root ? V.amber : V.blue }}>{ev.prob}%</div>
              <div style={{ fontSize: 9, color: V.text3, marginTop: 2 }}>failure probability</div>
              {ev.root && <div style={{ marginTop: 5, fontSize: 9, fontWeight: 700, color: V.amberT, background: V.amberBg, padding: '1px 6px', borderRadius: 3, display: 'inline-block' }}>ROOT</div>}
            </div>
          ))}
        </div>
      </Card>
      {insight && <Insight text={insight} />}
      <Actions items={['Expand sub-events', 'Export to Word']} />
    </Wrap>
  )
}

// -- R9: 8D ----------------------------------------------------------------
function EightDR({ data, insight }: { data: Extract<RendererPayload,{type:'8d'}>['data']; insight?: string }) {
  const statusMap: Record<string, { label: string; color: string }> = {
    complete:    { label: 'ok Complete',   color: V.greenT },
    in_progress: { label: 'In progress',  color: V.blueT  },
    planned:     { label: 'Planned',      color: V.text3  },
  }
  return (
    <Wrap>
      <RTitle num="" label="8D report" sub={data.problem} />
      <KpiGrid items={[
        { label: 'Opened', value: data.opened },
        { label: 'D4 root cause', value: 'Confirmed' },
        { label: 'Open actions', value: `${data.items.filter(d => d.status !== 'complete').length} of 8` },
        { label: 'Status', value: data.items.every(d => d.status === 'complete') ? 'Closed' : 'Open' },
      ]} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {data.items.map(item => (
          <Card key={item.d} style={{ marginBottom: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 13px', borderBottom: `1px solid ${V.border}` }}>
              <div style={{ width: 26, height: 26, borderRadius: '50%', background: item.color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>{item.d}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: V.text, flex: 1 }}>{item.title}</div>
              <div style={{ fontSize: 11, fontWeight: 500, color: statusMap[item.status]?.color ?? V.text3 }}>{statusMap[item.status]?.label}</div>
            </div>
            <div style={{ padding: '9px 13px', fontSize: 12, color: V.text2, lineHeight: 1.6 }}>{item.body}</div>
          </Card>
        ))}
      </div>
      {insight && <Insight text={insight} />}
      <Actions items={['Export as 8D Word report', 'Update action status', 'Send to customer']} />
    </Wrap>
  )
}

// -- R10: TREND ------------------------------------------------------------
function TrendR({ data, insight }: { data: Extract<RendererPayload,{type:'trend'}>['data']; insight?: string }) {
  const { series, labels, event_idx } = data
  const n = labels.length
  const W = 680, H = 150, pL = 42, pR = 42, pT = 8, pB = 24
  const cW = W - pL - pR, cH = H - pT - pB
  const xi = (i: number) => pL + (i / (n - 1)) * cW
  const left = series.filter(s => s.axis !== 'right'), right = series.filter(s => s.axis === 'right')
  const maxL = Math.max(...left.flatMap(s => s.points)) * 1.15 || 1, minL = 0
  const maxR = Math.max(...right.flatMap(s => s.points)) + 2 || 100, minR = Math.min(...right.flatMap(s => s.points)) - 2 || 0
  const yL = (v: number) => pT + cH - ((v - minL) / (maxL - minL)) * cH
  const yR = (v: number) => pT + cH - ((v - minR) / (maxR - minR)) * cH
  return (
    <Wrap>
      <RTitle num="" label="Trend analysis" sub={data.title} />
      <Card>
        <div style={{ padding: '12px 14px 8px' }}>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }}>
            {event_idx !== undefined && <rect x={xi(event_idx) - 18} y={pT} width="36" height={cH} fill="#fdf0ee" opacity="0.8" />}
            {[0, 0.25, 0.5, 0.75, 1].map(f => <line key={f} x1={pL} y1={pT + cH * (1 - f)} x2={pL + cW} y2={pT + cH * (1 - f)} stroke={V.border} strokeWidth="1" />)}
            {series.map(sr => {
              const isRight = sr.axis === 'right', yFn = isRight ? yR : yL
              return (
                <g key={sr.label}>
                  <polyline points={sr.points.map((v, i) => `${xi(i).toFixed(1)},${yFn(v).toFixed(1)}`).join(' ')} fill="none" stroke={sr.color} strokeWidth="2" strokeLinejoin="round" strokeDasharray={isRight ? '5,3' : undefined} />
                  {sr.points.map((v, i) => <circle key={i} cx={xi(i)} cy={yFn(v)} r={i === event_idx ? 5 : 3} fill={sr.color} stroke="#fff" strokeWidth="1.5" />)}
                </g>
              )
            })}
            {labels.map((l, i) => <text key={i} x={xi(i)} y={H - 4} textAnchor="middle" fontFamily="monospace" fontSize="8" fill={V.text3}>{l}</text>)}
          </svg>
        </div>
        <div style={{ display: 'flex', gap: 12, padding: '6px 14px', borderTop: `1px solid ${V.border}`, flexWrap: 'wrap' }}>
          {series.map(sr => (
            <div key={sr.label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: V.text2 }}>
              <div style={{ width: 12, height: 2, background: sr.color, borderTop: sr.axis === 'right' ? `2px dashed ${sr.color}` : 'none' }} />
              {sr.label}
            </div>
          ))}
        </div>
      </Card>
      {insight && <Insight text={insight} />}
      <Actions items={['Extend timeframe', 'Add Cpk trend', 'Export to Word']} />
    </Wrap>
  )
}

// -- R11: SCATTER ----------------------------------------------------------
function ScatterR({ data, insight }: { data: Extract<RendererPayload,{type:'scatter'}>['data']; insight?: string }) {
  const { points, r, r2, xLabel, yLabel, tolerance_y } = data
  const xs = points.map(p => p.x), ys = points.map(p => p.y)
  const minX = Math.min(...xs) - 0.3, maxX = Math.max(...xs) + 0.3, minY = 0, maxY = Math.max(...ys) + 0.01
  const W = 640, H = 190, pL = 48, pR = 14, pT = 8, pB = 28
  const cW = W - pL - pR, cH = H - pT - pB
  const sx = (v: number) => pL + ((v - minX) / (maxX - minX)) * cW
  const sy = (v: number) => pT + cH - ((v - minY) / (maxY - minY)) * cH
  const xBar = xs.reduce((a,b)=>a+b,0)/xs.length, yBar = ys.reduce((a,b)=>a+b,0)/ys.length
  const num = points.reduce((acc,p)=>acc+(p.x-xBar)*(p.y-yBar),0), den = points.reduce((acc,p)=>acc+(p.x-xBar)**2,0)
  const slope = num/den, intercept = yBar - slope*xBar
  return (
    <Wrap>
      <RTitle num="" label="Scatter / correlation" sub={data.title} />
      <div style={{ display: 'flex', gap: 20, marginBottom: 12, flexWrap: 'wrap' }}>
        {[['Pearson r', r.toFixed(2)], ['R', r2.toFixed(2)], ['Correlation', Math.abs(r) > 0.7 ? 'Strong' : Math.abs(r) > 0.4 ? 'Moderate' : 'Weak']].map(([l, v]) => (
          <div key={l}><div style={{ fontSize: 10, color: V.text3, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 2 }}>{l}</div><div style={{ fontSize: 18, fontWeight: 600, color: V.text }}>{v}</div></div>
        ))}
      </div>
      <Card>
        <div style={{ padding: '12px 14px 8px' }}>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block' }}>
            {tolerance_y && <line x1={pL} y1={sy(tolerance_y)} x2={pL+cW} y2={sy(tolerance_y)} stroke={V.red} strokeWidth="1.5" strokeDasharray="5,4" opacity="0.6" />}
            <line x1={sx(minX+0.1)} y1={sy(slope*(minX+0.1)+intercept)} x2={sx(maxX-0.1)} y2={sy(slope*(maxX-0.1)+intercept)} stroke="#8a6000" strokeWidth="1.5" opacity="0.6" />
            {[0,0.25,0.5,0.75,1].map(f => <line key={f} x1={pL} y1={pT+cH*(1-f)} x2={pL+cW} y2={pT+cH*(1-f)} stroke={V.border} strokeWidth="1" />)}
            {points.map((p,i) => <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r="4" fill={tolerance_y && p.y > tolerance_y ? V.red : V.blue} opacity="0.75" stroke="#fff" strokeWidth="1" />)}
            <text x={pL+cW/2} y={H-2} textAnchor="middle" fontFamily="sans-serif" fontSize="10" fill={V.text2}>{xLabel}</text>
          </svg>
        </div>
      </Card>
      {insight && <Insight text={insight} />}
      <Actions items={['Add to Ishikawa', 'Show residuals', 'Export to Word']} />
    </Wrap>
  )
}

// -- R12: TIMELINE ---------------------------------------------------------
function TimelineR({ data, insight }: { data: Extract<RendererPayload,{type:'timeline'}>['data']; insight?: string }) {
  const dotColor: Record<string, string> = { alarm: V.red, action: V.blue, root: V.amber, normal: V.text4 }
  const badgeSt: Record<string, React.CSSProperties> = {
    alarm:  { background: V.redBg,   color: V.redT,   fontSize: 9, padding: '1px 5px', borderRadius: 3, fontWeight: 600, marginLeft: 6 },
    action: { background: V.blueBg,  color: V.blueT,  fontSize: 9, padding: '1px 5px', borderRadius: 3, fontWeight: 600, marginLeft: 6 },
    root:   { background: V.amberBg, color: V.amberT, fontSize: 9, padding: '1px 5px', borderRadius: 3, fontWeight: 600, marginLeft: 6 },
  }
  return (
    <Wrap>
      <RTitle num="" label="Event sequence timeline" sub={data.title} />
      <Card style={{ padding: '14px 16px' }}>
        <div style={{ position: 'relative', paddingLeft: 26 }}>
          <div style={{ position: 'absolute', left: 9, top: 8, bottom: 8, width: 2, background: V.border2, borderRadius: 99 }} />
          {data.events.map((ev, i) => (
            <div key={i} style={{ position: 'relative', marginBottom: 12 }}>
              <div style={{ position: 'absolute', left: -20, top: 3, width: 9, height: 9, borderRadius: '50%', background: dotColor[ev.type], border: `2px solid var(--surface)`, boxShadow: `0 0 0 2px ${dotColor[ev.type]}` }} />
              <div style={{ fontSize: 10, fontFamily: V.mono, color: V.text3, marginBottom: 1 }}>{ev.time}</div>
              <div style={{ fontSize: 12, fontWeight: 500, color: V.text }}>
                {ev.label}
                {ev.badge && <span style={badgeSt[ev.badge]}>{ev.badge}</span>}
              </div>
              <div style={{ fontSize: 11, color: V.text2, lineHeight: 1.5 }}>{ev.detail}</div>
            </div>
          ))}
        </div>
      </Card>
      {insight && <Insight text={insight} />}
      <Actions items={['Overlay on SPC chart', 'Add to 8D D3', 'Export to Word']} />
    </Wrap>
  )
}

// -- R13: FMEA -------------------------------------------------------------
function FmeaR({ data, insight }: { data: Extract<RendererPayload,{type:'fmea'}>['data']; insight?: string }) {
  const rpnColor = (rpn: number) => rpn > 200 ? V.red : rpn > 100 ? V.amber : V.green
  const numColor = (v: number) => v >= 7 ? V.red : v >= 4 ? V.amber : V.green
  return (
    <Wrap>
      <RTitle num="" label="FMEA -- failure mode & effects analysis" sub={data.title} />
      <div style={{ overflowX: 'auto' }}>
        <Card>
          <Tbl>
            <thead><tr>{['Failure mode','Effect','S','O','D','RPN','Recommended action','Owner','Due'].map(h => <Th key={h} ch={h} />)}</tr></thead>
            <tbody>{data.rows.map((r, i) => {
              const rpn = r.S * r.O * r.D
              return (
                <tr key={i}>
                  <Td style={{ fontWeight: 600, fontSize: 11, maxWidth: 130, lineHeight: 1.4 }}>{r.mode}</Td>
                  <Td style={{ fontSize: 11, color: V.text2, maxWidth: 120, lineHeight: 1.4 }}>{r.effect}</Td>
                  {[r.S, r.O, r.D].map((v, vi) => <Td key={vi}><span style={{ fontFamily: V.mono, fontSize: 12, fontWeight: 700, color: numColor(v) }}>{v}</span></Td>)}
                  <Td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ fontFamily: V.mono, fontSize: 12, fontWeight: 600, color: rpnColor(rpn), minWidth: 26 }}>{rpn}</span>
                      <div style={{ width: 44, height: 4, background: V.border2, borderRadius: 99, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${Math.min(100, rpn / 512 * 100)}%`, background: rpnColor(rpn), borderRadius: 99 }} />
                      </div>
                    </div>
                  </Td>
                  <Td style={{ fontSize: 11, maxWidth: 130, lineHeight: 1.4 }}>{r.action}</Td>
                  <Td style={{ fontSize: 11, color: V.text2 }}>{r.who}</Td>
                  <Td style={{ fontFamily: V.mono, fontSize: 10, color: V.text3 }}>{r.due}</Td>
                </tr>
              )
            })}</tbody>
          </Tbl>
        </Card>
      </div>
      {insight && <Insight text={insight} />}
      <Actions items={['Sort by RPN', 'Update after actions', 'Export to Word']} />
    </Wrap>
  )
}

// -- R14: COMPARISON -------------------------------------------------------
function ComparisonR({ data, insight }: { data: Extract<RendererPayload,{type:'comparison'}>['data']; insight?: string }) {
  return (
    <Wrap>
      <RTitle num="" label="Batch comparison" sub={data.title} />
      <div style={{ overflowX: 'auto' }}>
        <Card>
          <Tbl>
            <thead><tr>
              <Th ch="Metric" />
              {data.cols.map((c, i) => <Th key={c} ch={c} />)}
            </tr></thead>
            <tbody>{data.metrics.map(m => (
              <tr key={m.name}>
                <Td><span style={{ fontWeight: 600, fontSize: 12 }}>{m.name}</span></Td>
                {m.vals.map((v, i) => {
                  const delta = i > 0 ? m.delta[i - 1] : null
                  const bad  = delta !== null && ((m.good_direction === 'down' && delta > 0) || (m.good_direction === 'up' && delta < 0))
                  const good = delta !== null && ((m.good_direction === 'down' && delta < 0) || (m.good_direction === 'up' && delta > 0))
                  return (
                    <Td key={i}>
                      <span style={{ fontFamily: V.mono, fontSize: 12, fontWeight: 600 }}>{v}</span>
                      {delta !== null && (
                        <span style={{ marginLeft: 5, fontSize: 10, fontWeight: 600, padding: '1px 5px', borderRadius: 3, background: bad ? V.redBg : good ? V.greenBg : V.bg3, color: bad ? V.red : good ? V.green : V.text3 }}>
                          {delta > 0 ? '+' : ''}{delta}
                        </span>
                      )}
                    </Td>
                  )
                })}
              </tr>
            ))}</tbody>
          </Tbl>
        </Card>
      </div>
      {insight && <Insight text={insight} />}
      <Actions items={['Add more periods', 'Chart trend', 'Export to Word']} />
    </Wrap>
  )
}

// -- MASTER RENDERER MAP ---------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const RENDERER_MAP: Record<string, React.ComponentType<{ data: any; insight?: string }>> = {
  pareto:      ParetoR,
  breakdown:   BreakdownR,
  subcause:    SubcauseR,
  fishbone:    FishboneR,
  five_whys:   FiveWhysR,
  cap:         CapR,
  spc:         SpcR,
  fault_tree:  FaultTreeR,
  '8d':        EightDR,
  trend:       TrendR,
  scatter:     ScatterR,
  timeline:    TimelineR,
  fmea:        FmeaR,
  comparison:  ComparisonR,
}

// -- DEFAULT EXPORT --------------------------------------------------------

export default function RcaRenderer({ block }: { block: RcaBlock }) {
  if (!block?.renderers?.length) return null
  return (
    <div className="fade-in">
      {block.renderers.map((r: any, i) => {
        const Component = RENDERER_MAP[r.type]
        if (!Component) return null
        return <Component key={i} data={(r as RendererPayload & { insight?: string }).data} insight={r.insight} />
      })}
    </div>
  )
}
