import React from 'react'

export const SH: React.CSSProperties = { fontSize: 16, fontWeight: 500, color: 'var(--text)', marginBottom: 4 }
export const SS: React.CSSProperties = { fontSize: 11, color: 'var(--text3)', marginBottom: 24 }
export const SLBL: React.CSSProperties = { fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase' as const, letterSpacing: '.1em', marginBottom: 10 }
export const CARD: React.CSSProperties = { border: '1px solid var(--border2)', borderRadius: 10, overflow: 'hidden', marginBottom: 20 }
export const ROW: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)' }
export const ROW_LAST: React.CSSProperties = { ...ROW, borderBottom: 'none' }
export const INP: React.CSSProperties = { width: '100%', background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 6, padding: '8px 10px', fontSize: 12, color: 'var(--text)', outline: 'none' }
export const SEL: React.CSSProperties = { ...INP, cursor: 'pointer' }
export const HINT: React.CSSProperties = { fontSize: 10, color: 'var(--text3)', marginTop: 4 }

export function Btn({ children, onClick, variant = 'secondary', disabled, style }: { children: React.ReactNode; onClick?: () => void; variant?: 'primary' | 'secondary' | 'danger'; disabled?: boolean; style?: React.CSSProperties }) {
  const base: React.CSSProperties = { border: 'none', borderRadius: 5, padding: '5px 13px', fontSize: 11, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? .5 : 1, fontFamily: 'inherit', ...style }
  const variants = {
    primary: { background: 'var(--text)', color: 'var(--bg)', fontWeight: 500 },
    secondary: { background: 'none', border: '1px solid var(--border2)', color: 'var(--text2)' },
    danger: { background: 'none', border: '1px solid #4a1515', color: 'var(--red)' },
  }
  return <button onClick={onClick} disabled={disabled} style={{ ...base, ...variants[variant] }}>{children}</button>
}

export function Badge({ label, color = 'gray' }: { label: string; color?: 'green' | 'red' | 'amber' | 'blue' | 'purple' | 'gray' }) {
  const colors = {
    green: { background: 'var(--gbg)', color: 'var(--gt)' },
    red:   { background: 'var(--rbg)', color: 'var(--rt)' },
    amber: { background: 'var(--abg)', color: 'var(--at)' },
    blue:  { background: 'var(--bbg)', color: 'var(--bt)' },
    purple:{ background: 'var(--pbg)', color: 'var(--pt)' },
    gray:  { background: 'var(--bg3)', color: 'var(--text3)', border: '1px solid var(--border2)' },
  }
  return <span style={{ fontSize: 9, padding: '1px 7px', borderRadius: 10, ...colors[color] }}>{label}</span>
}

export function StatusDot({ status }: { status: string }) {
  const color = status === 'healthy' ? 'var(--green)' : status === 'degraded' ? 'var(--amber)' : status === 'down' ? 'var(--red)' : 'var(--border2)'
  const shadow = status === 'healthy' ? '0 0 0 2px var(--gbg)' : 'none'
  return <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: color, boxShadow: shadow, flexShrink: 0 }} />
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 5 }}>{label}</div>
      {children}
      {hint && <div style={HINT}>{hint}</div>}
    </div>
  )
}

export function Grid({ cols, children }: { cols: number; children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 12 }}>{children}</div>
}

export function Spinner() {
  return <span style={{ display: 'inline-block', width: 12, height: 12, border: '1.5px solid var(--border2)', borderTopColor: 'var(--text3)', borderRadius: '50%', animation: 'spin .8s linear infinite', verticalAlign: 'middle' }} />
}
