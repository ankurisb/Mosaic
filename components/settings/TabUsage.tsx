'use client'
import { useState, useEffect } from 'react'
import type { SessionUser } from '@/lib/auth'
import { SH, SS, Spinner } from './ui'

interface UsageData {
  totals:{ input_tokens:string; output_tokens:string; cost_usd:string; calls:string }
  byUser:{ user_email:string; input_tokens:string; output_tokens:string; cost_usd:string; calls:string }[]
  daily:{ date:string; input_tokens:string; output_tokens:string }[]
}

export default function TabUsage({ user }: { user: SessionUser }) {
  const [data, setData] = useState<UsageData|null>(null)
  const [period, setPeriod] = useState('7d')
  const [loading, setLoading] = useState(true)

  async function load(p:string) { setLoading(true); const r=await fetch(`/api/usage?period=${p}`); if(r.ok)setData(await r.json()); setLoading(false) }
  useEffect(()=>{ load(period) },[period])

  const fmt = (n:string|number) => Number(n).toLocaleString()
  const fmtCost = (n:string|number) => `$${Number(n).toFixed(4)}`
  const maxVal = data ? Math.max(...data.daily.map(d=>Number(d.input_tokens)+Number(d.output_tokens)),1) : 1

  const perb = (p:string): React.CSSProperties => ({ padding:'3px 9px', borderRadius:5, border:'1px solid var(--border2)', fontSize:10, cursor:'pointer', background:period===p?'var(--bg4)':'none', color:period===p?'var(--text)':'var(--text3)', fontFamily:'inherit' })

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:4 }}>
        <div style={SH}>Usage analytics</div>
        <div style={{ display:'flex', gap:4 }}>
          {['24h','7d','30d'].map(p=><button key={p} style={perb(p)} onClick={()=>setPeriod(p)}>{p}</button>)}
        </div>
      </div>
      <div style={SS}>Token usage and estimated costs.</div>

      {loading?<div style={{ textAlign:'center', padding:40 }}><Spinner/></div>:data&&(
        <>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:24 }}>
            {[
              {label:'Total tokens',  value:fmt(Number(data.totals.input_tokens)+Number(data.totals.output_tokens)), color:'var(--bt)'},
              {label:'Estimated cost',value:fmtCost(data.totals.cost_usd), color:'var(--gt)'},
              {label:'API calls',     value:fmt(data.totals.calls), color:'var(--pt)'},
              {label:'Output tokens', value:fmt(data.totals.output_tokens), color:'var(--at)'},
            ].map(c=>(
              <div key={c.label} style={{ background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:10, padding:'14px 16px' }}>
                <div style={{ fontSize:22, fontWeight:500, color:c.color, marginBottom:3 }}>{c.value}</div>
                <div style={{ fontSize:10, color:'var(--text3)' }}>{c.label}</div>
              </div>
            ))}
          </div>

          {data.daily.length>0&&(
            <div style={{ background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:10, padding:16, marginBottom:20 }}>
              <div style={{ fontSize:11, fontWeight:500, marginBottom:14, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <span>Daily token usage</span>
                <div style={{ display:'flex', gap:12, fontSize:10, color:'var(--text3)' }}>
                  <span><span style={{ display:'inline-block', width:7, height:7, borderRadius:1, background:'var(--blue)', marginRight:4 }}/>Input</span>
                  <span><span style={{ display:'inline-block', width:7, height:7, borderRadius:1, background:'var(--purple)', marginRight:4 }}/>Output</span>
                </div>
              </div>
              <div style={{ display:'flex', alignItems:'flex-end', gap:4, height:80 }}>
                {data.daily.map((d,i)=>{
                  const ih=Math.max(2,(Number(d.input_tokens)/maxVal)*72)
                  const oh=Math.max(1,(Number(d.output_tokens)/maxVal)*72*.4)
                  return <div key={i} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:2 }}>
                    <div style={{ width:'100%', height:ih, background:'var(--blue)', opacity:.7, borderRadius:'2px 2px 0 0' }}/>
                    <div style={{ width:'100%', height:oh, background:'var(--purple)', opacity:.8, borderRadius:'2px 2px 0 0' }}/>
                    <div style={{ fontSize:8, color:'var(--text3)' }}>{new Date(d.date).toLocaleDateString('en',{weekday:'narrow'})}</div>
                  </div>
                })}
              </div>
            </div>
          )}

          {user.role==='admin'&&data.byUser.length>0&&(
            <div style={{ border:'1px solid var(--border2)', borderRadius:10, overflow:'hidden', background:'var(--bg2)' }}>
              <div style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', fontSize:11, fontWeight:500 }}>Usage by user</div>
              <table style={{ width:'100%', borderCollapse:'collapse' }}>
                <thead><tr>{['User','Calls','Input','Output','Cost'].map(h=><th key={h} style={{ padding:'8px 14px', textAlign:'left', fontSize:9, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'.1em', fontWeight:400 }}>{h}</th>)}</tr></thead>
                <tbody>{data.byUser.map((u,i)=><tr key={i}><td style={{ padding:'9px 14px', fontSize:11 }}>{u.user_email}</td><td style={{ padding:'9px 14px', fontSize:11, color:'var(--text2)' }}>{fmt(u.calls)}</td><td style={{ padding:'9px 14px', fontSize:11, color:'var(--text2)' }}>{fmt(u.input_tokens)}</td><td style={{ padding:'9px 14px', fontSize:11, color:'var(--text2)' }}>{fmt(u.output_tokens)}</td><td style={{ padding:'9px 14px', fontSize:11, color:'var(--gt)', fontWeight:500 }}>{fmtCost(u.cost_usd)}</td></tr>)}</tbody>
              </table>
            </div>
          )}
          {!data.daily.length&&!data.byUser.length&&<div style={{ textAlign:'center', padding:'40px 20px', color:'var(--text3)', fontSize:12 }}>No usage data yet. Start chatting to see analytics here.</div>}
        </>
      )}
    </div>
  )
}
