'use client'
import { useState, useEffect, useCallback } from 'react'
import { SH, SS, Btn, StatusDot, Spinner } from './ui'

interface Svc { id:string; label:string; category:string; status:string; latencyMs:number|null; message?:string }
interface Data { services:Svc[]; summary:{ healthy:number; degraded:number; down:number; total:number } }

const CAT: Record<string,string> = { infrastructure:'Infrastructure', database:'Databases', api:'External APIs', api_service:'API Services' }

export default function TabMonitor() {
  const [data, setData] = useState<Data|null>(null)
  const [loading, setLoading] = useState(true)
  const [last, setLast] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try { const r=await fetch('/api/monitor'); if(r.ok){setData(await r.json());setLast(new Date().toLocaleTimeString())} }
    finally { setLoading(false) }
  },[])

  useEffect(()=>{ load() },[load])

  const byCat = data ? data.services.reduce((a,s)=>{ if(!a[s.category])a[s.category]=[]; a[s.category].push(s); return a },{}as Record<string,Svc[]>) : {}

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:4 }}>
        <div style={SH}>Monitoring</div>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          {loading&&<Spinner/>}
          {last&&<span style={{ fontSize:10, color:'var(--text3)' }}>checked {last}</span>}
          <Btn size="sm" onClick={load}>↺ refresh all</Btn>
        </div>
      </div>
      <div style={SS}>Live health status of all connected services.</div>

      {data&&(
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:8, marginBottom:20 }}>
          {[[data.summary.healthy,'Healthy','var(--gt)'],[data.summary.degraded,'Degraded','var(--at)'],[data.summary.down,'Down','var(--rt)'],[data.summary.total,'Total','var(--text)']].map(([v,l,c])=>(
            <div key={String(l)} style={{ background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:8, padding:'12px 14px' }}>
              <div style={{ fontSize:22, fontWeight:500, color:String(c), marginBottom:2 }}>{v}</div>
              <div style={{ fontSize:10, color:'var(--text3)' }}>{l}</div>
            </div>
          ))}
        </div>
      )}

      {loading&&!data?<div style={{ textAlign:'center', padding:40 }}><Spinner/></div>:(
        Object.entries(CAT).map(([cat,lbl])=>{
          const svcs=byCat[cat]||[]; if(!svcs.length)return null
          return (
            <div key={cat} style={{ marginBottom:18 }}>
              <div style={{ fontSize:9, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'.1em', marginBottom:8 }}>{lbl}</div>
              <div style={{ border:'1px solid var(--border2)', borderRadius:10, overflow:'hidden', background:'var(--bg2)' }}>
                {svcs.map((s,i)=>(
                  <div key={s.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'11px 14px', borderBottom:i<svcs.length-1?'1px solid var(--border)':'none' }}>
                    <StatusDot status={s.status}/>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:12, fontWeight:500, color:'var(--text)' }}>{s.label}</div>
                      {s.message&&<div style={{ fontSize:10, color:'var(--text3)', marginTop:1 }}>{s.message}</div>}
                    </div>
                    <span style={{ fontSize:11, fontWeight:500, color:s.status==='healthy'?'var(--gt)':s.status==='degraded'?'var(--at)':'var(--rt)' }}>{s.status}</span>
                    <span style={{ fontSize:11, color:'var(--text2)', minWidth:48, textAlign:'right' }}>{s.latencyMs!=null?`${s.latencyMs}ms`:'—'}</span>
                    <div style={{ width:60, height:4, background:'var(--border)', borderRadius:2, overflow:'hidden', flexShrink:0 }}>
                      {s.latencyMs!=null&&<div style={{ height:'100%', borderRadius:2, width:`${Math.min(100,s.latencyMs/10)}%`, background:s.latencyMs>500?'var(--red)':s.latencyMs>200?'var(--amber)':'var(--green)' }}/>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}
