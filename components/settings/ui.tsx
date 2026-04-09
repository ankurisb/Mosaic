import React from 'react'

export const SH: React.CSSProperties = { fontSize:14, fontWeight:500, color:'var(--text)', marginBottom:4 }
export const SS: React.CSSProperties = { fontSize:11, color:'var(--text3)', marginBottom:18 }
export const SLBL: React.CSSProperties = { fontSize:10, color:'var(--text3)', textTransform:'uppercase' as const, letterSpacing:'.1em', marginBottom:10 }
export const CARD: React.CSSProperties = { border:'1px solid var(--border2)', borderRadius:10, overflow:'hidden', marginBottom:20, background:'var(--bg2)' }
export const ROW: React.CSSProperties = { display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', borderBottom:'1px solid var(--border)' }
export const ROW_LAST: React.CSSProperties = { ...ROW, borderBottom:'none' }
export const INP: React.CSSProperties = { width:'100%', background:'var(--bg3)', border:'1px solid var(--border2)', borderRadius:6, padding:'7px 10px', fontSize:12, color:'var(--text)', outline:'none' }
export const SEL: React.CSSProperties = { ...INP, cursor:'pointer' }
export const HINT: React.CSSProperties = { fontSize:10, color:'var(--text3)', marginTop:4 }

export function Btn({ children, onClick, variant='secondary', disabled, style, size='md' }: {
  children:React.ReactNode; onClick?:()=>void
  variant?:'primary'|'secondary'|'danger'; disabled?:boolean
  style?:React.CSSProperties; size?:'sm'|'md'
}) {
  const base: React.CSSProperties = {
    border:'none', borderRadius:5, cursor:disabled?'not-allowed':'pointer',
    opacity:disabled?.45:1, fontFamily:'inherit', fontWeight:500,
    fontSize:size==='sm'?11:12, padding:size==='sm'?'3px 10px':'5px 13px', ...style,
  }
  const variants = {
    primary:   { background:'var(--text)', color:'var(--bg2)' },
    secondary: { background:'none', border:'1px solid var(--border2)', color:'var(--text2)' },
    danger:    { background:'none', border:'1px solid rgba(204,34,34,.3)', color:'var(--rt)' },
  }
  return <button onClick={onClick} disabled={disabled} style={{ ...base, ...variants[variant] }}>{children}</button>
}

export function Badge({ label, color='gray' }: { label:string; color?:'green'|'red'|'amber'|'blue'|'purple'|'gray' }) {
  const colors = {
    green:  { background:'var(--gbg)', color:'var(--gt)' },
    red:    { background:'var(--rbg)', color:'var(--rt)' },
    amber:  { background:'var(--abg)', color:'var(--at)' },
    blue:   { background:'var(--bbg)', color:'var(--bt)' },
    purple: { background:'var(--pbg)', color:'var(--pt)' },
    gray:   { background:'var(--bg3)', color:'var(--text3)', border:'1px solid var(--border2)' },
  }
  return <span style={{ fontSize:9, padding:'1px 7px', borderRadius:10, fontWeight:500, ...colors[color] }}>{label}</span>
}

export function StatusDot({ status }: { status:string }) {
  const color = status==='healthy'?'var(--green)':status==='degraded'?'var(--amber)':status==='down'?'var(--red)':'var(--border2)'
  return <span style={{ display:'inline-block', width:7, height:7, borderRadius:'50%', background:color, flexShrink:0 }}/>
}

export function Field({ label, hint, children, required }: { label:string; hint?:string; children:React.ReactNode; required?:boolean }) {
  return (
    <div style={{ marginBottom:12 }}>
      <div style={{ fontSize:10, color:'var(--text3)', textTransform:'uppercase' as const, letterSpacing:'.06em', marginBottom:5 }}>
        {label}{required&&<span style={{ color:'var(--rt)', marginLeft:2 }}>*</span>}
      </div>
      {children}
      {hint&&<div style={HINT}>{hint}</div>}
    </div>
  )
}

export function Grid({ cols, children, gap=12 }: { cols:number; children:React.ReactNode; gap?:number }) {
  return <div style={{ display:'grid', gridTemplateColumns:`repeat(${cols},minmax(0,1fr))`, gap }}>{children}</div>
}

export function Spinner() {
  return <span style={{ display:'inline-block', width:12, height:12, border:'1.5px solid var(--border2)', borderTopColor:'var(--text3)', borderRadius:'50%', animation:'spin .8s linear infinite', verticalAlign:'middle' }}/>
}

export function Alert({ children, variant='info' }: { children:React.ReactNode; variant?:'info'|'warning'|'error'|'success' }) {
  const v = { info:{bg:'var(--bbg)',border:'rgba(29,111,184,.2)',color:'var(--bt)'}, warning:{bg:'var(--abg)',border:'rgba(184,130,10,.2)',color:'var(--at)'}, error:{bg:'var(--rbg)',border:'rgba(204,34,34,.2)',color:'var(--rt)'}, success:{bg:'var(--gbg)',border:'rgba(15,122,86,.2)',color:'var(--gt)'} }[variant]
  return <div style={{ background:v.bg, border:`1px solid ${v.border}`, borderRadius:6, padding:'9px 13px', fontSize:11, color:v.color, lineHeight:1.5, marginBottom:14 }}>{children}</div>
}
