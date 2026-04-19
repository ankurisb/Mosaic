import React from 'react'

// -- Typography ----------------------------------------------
export const PageTitle = ({ children }: { children: React.ReactNode }) => (
  <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 22, fontWeight: 400, color: 'var(--text)', marginBottom: 4 }}>{children}</h1>
)
export const PageSub = ({ children }: { children: React.ReactNode }) => (
  <p style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 28, lineHeight: 1.5 }}>{children}</p>
)
export const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text3)', textTransform: 'uppercase' as const, letterSpacing: '.08em', marginBottom: 10 }}>{children}</div>
)

// -- Card -----------------------------------------------------
export function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', overflow: 'hidden', marginBottom: 16, ...style }}>
      {children}
    </div>
  )
}

export function CardRow({ children, last }: { children: React.ReactNode; last?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 18px', borderBottom: last ? 'none' : '1px solid var(--border)' }}>
      {children}
    </div>
  )
}

// -- Input ----------------------------------------------------
export const INP: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg)',
  border: '1px solid var(--border2)',
  borderRadius: 'var(--radius-sm)',
  padding: '9px 12px',
  fontSize: 13,
  color: 'var(--text)',
  outline: 'none',
  transition: 'border-color .15s',
}
export const SEL: React.CSSProperties = { ...INP, cursor: 'pointer', appearance: 'none' as const }

// -- Buttons ---------------------------------------------------
type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

export function Btn({ children, onClick, variant = 'secondary', disabled, style, size = 'md' }: {
  children: React.ReactNode
  onClick?: () => void
  variant?: BtnVariant
  disabled?: boolean
  style?: React.CSSProperties
  size?: 'sm' | 'md'
}) {
  const base: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    border: 'none', borderRadius: 'var(--radius-pill)',
    fontSize: size === 'sm' ? 12 : 13,
    padding: size === 'sm' ? '5px 12px' : '8px 16px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? .45 : 1,
    fontFamily: 'inherit',
    fontWeight: 500,
    transition: 'background .15s, box-shadow .15s, opacity .15s',
    whiteSpace: 'nowrap' as const,
    ...style,
  }
  const variants: Record<BtnVariant, React.CSSProperties> = {
    primary:   { background: 'var(--accent-bg)', color: 'var(--accent-fg)', boxShadow: 'var(--shadow)' },
    secondary: { background: 'var(--surface)', color: 'var(--text2)', border: '1px solid var(--border2)', boxShadow: 'var(--shadow)' },
    ghost:     { background: 'transparent', color: 'var(--text2)' },
    danger:    { background: 'var(--red-bg)', color: 'var(--red-t)', border: '1px solid rgba(220,38,38,.2)' },
  }
  return <button onClick={onClick} disabled={disabled} style={{ ...base, ...variants[variant] }}>{children}</button>
}

// -- Badge / pill ----------------------------------------------
type BadgeColor = 'green' | 'red' | 'amber' | 'blue' | 'purple' | 'gray'
export function Badge({ label, color = 'gray' }: { label: string; color?: BadgeColor }) {
  const colors: Record<BadgeColor, React.CSSProperties> = {
    green:  { background: 'var(--green-bg)',  color: 'var(--green-t)' },
    red:    { background: 'var(--red-bg)',    color: 'var(--red-t)' },
    amber:  { background: 'var(--amber-bg)',  color: 'var(--amber-t)' },
    blue:   { background: 'var(--blue-bg)',   color: 'var(--blue-t)' },
    purple: { background: 'var(--purple-bg)', color: 'var(--purple-t)' },
    gray:   { background: 'var(--bg3)',       color: 'var(--text3)', border: '1px solid var(--border)' },
  }
  return <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 'var(--radius-pill)', ...colors[color] }}>{label}</span>
}

// -- Status dot ------------------------------------------------
export function StatusDot({ status }: { status: string }) {
  const color = status === 'healthy' ? 'var(--green)' : status === 'degraded' ? 'var(--amber)' : status === 'down' ? 'var(--red)' : 'var(--text4)'
  return <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
}

// -- Form field ------------------------------------------------
export function Field({ label, hint, children, required }: { label: string; hint?: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text2)', marginBottom: 6 }}>
        {label}{required && <span style={{ color: 'var(--red-t)', marginLeft: 3 }}>*</span>}
      </label>
      {children}
      {hint && <p style={{ fontSize: 11, color: 'var(--text3)', marginTop: 5, lineHeight: 1.5 }}>{hint}</p>}
    </div>
  )
}

// -- Grid ------------------------------------------------------
export function Grid({ cols, children, gap = 14 }: { cols: number; children: React.ReactNode; gap?: number }) {
  return <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))`, gap }}>{children}</div>
}

// -- Spinner ---------------------------------------------------
export function Spinner({ size = 14 }: { size?: number }) {
  return <span style={{ display: 'inline-block', width: size, height: size, border: `${size > 16 ? 2 : 1.5}px solid var(--border2)`, borderTopColor: 'var(--text3)', borderRadius: '50%', animation: 'spin .7s linear infinite', flexShrink: 0 }} />
}

// -- Alert -----------------------------------------------------
export function Alert({ children, variant = 'info' }: { children: React.ReactNode; variant?: 'info' | 'warning' | 'error' | 'success' }) {
  const v = {
    info:    { bg: 'var(--blue-bg)',   border: 'rgba(37,99,235,.2)',    color: 'var(--blue-t)' },
    warning: { bg: 'var(--amber-bg)',  border: 'rgba(217,119,6,.2)',    color: 'var(--amber-t)' },
    error:   { bg: 'var(--red-bg)',    border: 'rgba(220,38,38,.2)',    color: 'var(--red-t)' },
    success: { bg: 'var(--green-bg)',  border: 'rgba(22,163,74,.2)',    color: 'var(--green-t)' },
  }[variant]
  return <div style={{ background: v.bg, border: `1px solid ${v.border}`, borderRadius: 'var(--radius-sm)', padding: '10px 14px', fontSize: 13, color: v.color, lineHeight: 1.5, marginBottom: 16 }}>{children}</div>
}

// -- Divider ---------------------------------------------------
export const Divider = () => <div style={{ height: 1, background: 'var(--border)', margin: '20px 0' }} />

// -- Toggle switch ---------------------------------------------
export function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div onClick={() => onChange(!on)} style={{ width: 40, height: 22, borderRadius: 11, background: on ? 'var(--accent-bg)' : 'var(--bg4)', cursor: 'pointer', position: 'relative', transition: 'background .2s', flexShrink: 0 }}>
      <div style={{ position: 'absolute', top: 3, left: on ? 21 : 3, width: 16, height: 16, borderRadius: '50%', background: on ? 'var(--accent-fg)' : 'var(--text3)', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)' }} />
    </div>
  )
}
