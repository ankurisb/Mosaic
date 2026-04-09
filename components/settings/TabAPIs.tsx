'use client'
import { useState, useEffect } from 'react'
import type { SessionUser } from '@/lib/auth'
import { SH, SS, INP, SEL, Btn, Badge, Field, Grid, Alert, Spinner } from './ui'

interface Svc { id:string; label:string; base_url:string; environment:string; auth_type:string; rate_limit_rpm:number; request_timeout_ms:number; retry_count:number }
interface Conn { id:string; service_id:string; label:string; description:string; base_path:string; pagination_style:string }
const SE = { label:'', base_url:'', environment:'production', auth_type:'bearer', token:'', header_name:'', header_value:'', username:'', password:'', client_id:'', client_secret:'', token_url:'', custom_headers:'', api_version:'', rate_limit_rpm:'', request_timeout_ms:'30000', retry_count:'3' }
const CE = { label:'', description:'', base_path:'', pagination_style:'none', pagination_limit_param:'limit', pagination_cursor_param:'cursor', pagination_data_path:'' }
const PRESETS = [
  {label:'HubSpot',bg:'#ff7a59',auth:'oauth2_client',url:'https://api.hubapi.com'},
  {label:'Stripe',bg:'#635bff',auth:'bearer',url:'https://api.stripe.com'},
  {label:'Salesforce',bg:'#0176d3',auth:'oauth2_client',url:'https://login.salesforce.com'},
  {label:'Slack',bg:'#4a154b',auth:'bearer',url:'https://slack.com/api'},
  {label:'GitHub',bg:'#24292e',auth:'bearer',url:'https://api.github.com'},
  {label:'Custom',bg:'#888',auth:'bearer',url:''},
]

export default function TabAPIs({ user }: { user: SessionUser }) {
  const [svcs, setSvcs] = useState<Svc[]>([])
  const [conns, setConns] = useState<Conn[]>([])
  const [loading, setLoading] = useState(true)
  const [showSF, setShowSF] = useState(false)
  const [sf, setSf] = useState<Record<string,string>>(SE)
  const [editSvc, setEditSvc] = useState<string|null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [showCF, setShowCF] = useState<string|null>(null)
  const [cf, setCf] = useState<Record<string,string>>(CE)
  const [editConn, setEditConn] = useState<string|null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function load() { setLoading(true); const r=await fetch('/api/services'); if(r.ok){const d=await r.json();setSvcs(d.services);setConns(d.connections)}; setLoading(false) }
  useEffect(()=>{ load() },[])

  const ss=(k:string,v:string)=>setSf(p=>({...p,[k]:v}))
  const sc=(k:string,v:string)=>setCf(p=>({...p,[k]:v}))

  function buildAuth() {
    const t=sf.auth_type
    if(t==='bearer')return{token:sf.token}
    if(t==='api_key_header')return{header:sf.header_name,key:sf.header_value}
    if(t==='basic')return{username:sf.username,password:sf.password}
    if(t==='oauth2_client')return{client_id:sf.client_id,client_secret:sf.client_secret,token_url:sf.token_url}
    try{return JSON.parse(sf.custom_headers||'{}')}catch{return{}}
  }

  async function saveSvc() {
    if(!sf.label||!sf.base_url){setError('Label and URL required');return}
    setSaving(true)
    const r=await fetch('/api/services',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:editSvc?'updateService':'createService',id:editSvc,...sf,auth_config:buildAuth()})})
    const d=await r.json(); if(!r.ok){setError(d.error);setSaving(false);return}
    setSaving(false);setShowSF(false);setEditSvc(null);setSf(SE);setError('');load()
  }

  async function saveConn(serviceId:string) {
    if(!cf.label){setError('Label required');return}
    setSaving(true)
    const r=await fetch('/api/services',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:editConn?'updateConnection':'createConnection',id:editConn,service_id:serviceId,...cf})})
    const d=await r.json(); if(!r.ok){setError(d.error);setSaving(false);return}
    setSaving(false);setShowCF(null);setEditConn(null);setCf(CE);setError('');load()
  }

  async function delSvc(id:string,label:string) {
    if(!confirm(`Delete service "${label}"?`))return
    await fetch('/api/services',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'deleteService',id})}); load()
  }
  async function delConn(id:string,label:string) {
    if(!confirm(`Delete "${label}"?`))return
    await fetch('/api/services',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'deleteConnection',id})}); load()
  }

  const tog=(id:string)=>setExpanded(p=>{const n=new Set(p);n.has(id)?n.delete(id):n.add(id);return n})
  const envColor=(e:string):'red'|'amber'|'green'=>e==='production'?'red':e==='sandbox'?'amber':'green'

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:4 }}>
        <div style={SH}>API connections</div>
        {user.role==='admin'&&<Btn variant="primary" onClick={()=>{setShowSF(!showSF);setEditSvc(null);setSf(SE);setError('')}}>+ add service</Btn>}
      </div>
      <div style={SS}>Group endpoints under a service. Auth is shared across all connections.</div>
      <Alert variant="info">Once connected, ask Claude: <em>"Fetch my latest HubSpot contacts"</em> or <em>"Get last month's Stripe revenue"</em></Alert>
      {error&&<Alert variant="error">{error}</Alert>}

      {showSF&&(
        <div style={{ background:'var(--bg2)', border:'1px solid var(--border2)', borderRadius:10, padding:20, marginBottom:16 }}>
          <div style={{ fontSize:12, fontWeight:500, marginBottom:16 }}>{editSvc?'Edit service':'New API service'}</div>
          {!editSvc&&(
            <div style={{ marginBottom:16 }}>
              <div style={{ fontSize:10, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'.08em', marginBottom:8 }}>Quick start</div>
              <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                {PRESETS.map(p=>(
                  <button key={p.label} onClick={()=>setSf(f=>({...f,label:p.label,base_url:p.url,auth_type:p.auth}))}
                    style={{ display:'flex', alignItems:'center', gap:7, padding:'6px 12px', background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:6, cursor:'pointer', fontSize:11, color:'var(--text2)', fontFamily:'inherit' }}>
                    <span style={{ width:16, height:16, borderRadius:3, background:p.bg, color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontSize:8, fontWeight:700 }}>{p.label.slice(0,1)}</span>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <Grid cols={2}>
            <Field label="Service name" required><input style={INP} placeholder="HubSpot" value={sf.label} onChange={e=>ss('label',e.target.value)}/></Field>
            <Field label="Environment"><select style={SEL} value={sf.environment} onChange={e=>ss('environment',e.target.value)}><option value="production">🔴 Production</option><option value="sandbox">🟡 Sandbox</option><option value="staging">🟢 Staging</option></select></Field>
          </Grid>
          <Field label="Base URL" required hint="All connection paths are appended to this"><input style={INP} placeholder="https://api.hubapi.com" value={sf.base_url} onChange={e=>ss('base_url',e.target.value)}/></Field>
          <Field label="Auth type">
            <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:10 }}>
              {[['bearer','Bearer token'],['api_key_header','API key'],['oauth2_client','OAuth 2.0'],['basic','Basic'],['custom_headers','Custom']].map(([v,l])=>(
                <button key={v} onClick={()=>ss('auth_type',v)} style={{ padding:'4px 10px', borderRadius:14, border:`1px solid ${sf.auth_type===v?'var(--blue)':'var(--border2)'}`, background:sf.auth_type===v?'var(--bbg)':'none', color:sf.auth_type===v?'var(--bt)':'var(--text2)', fontSize:11, cursor:'pointer', fontFamily:'inherit' }}>{l}</button>
              ))}
            </div>
            {sf.auth_type==='bearer'&&<Field label="Token"><input style={INP} type="password" placeholder="Bearer token or API key" value={sf.token} onChange={e=>ss('token',e.target.value)}/></Field>}
            {sf.auth_type==='api_key_header'&&<Grid cols={2}><Field label="Header name"><input style={INP} placeholder="X-API-Key" value={sf.header_name} onChange={e=>ss('header_name',e.target.value)}/></Field><Field label="API key"><input style={INP} type="password" value={sf.header_value} onChange={e=>ss('header_value',e.target.value)}/></Field></Grid>}
            {sf.auth_type==='basic'&&<Grid cols={2}><Field label="Username"><input style={INP} value={sf.username} onChange={e=>ss('username',e.target.value)}/></Field><Field label="Password"><input style={INP} type="password" value={sf.password} onChange={e=>ss('password',e.target.value)}/></Field></Grid>}
            {sf.auth_type==='oauth2_client'&&<Grid cols={2}><Field label="Client ID"><input style={INP} value={sf.client_id} onChange={e=>ss('client_id',e.target.value)}/></Field><Field label="Client secret"><input style={INP} type="password" value={sf.client_secret} onChange={e=>ss('client_secret',e.target.value)}/></Field><Field label="Token URL"><input style={INP} placeholder="https://..." value={sf.token_url} onChange={e=>ss('token_url',e.target.value)}/></Field></Grid>}
          </Field>
          <Grid cols={3}>
            <Field label="Rate limit (req/min)"><input style={INP} type="number" placeholder="100" value={sf.rate_limit_rpm} onChange={e=>ss('rate_limit_rpm',e.target.value)}/></Field>
            <Field label="Timeout (ms)"><input style={INP} type="number" value={sf.request_timeout_ms} onChange={e=>ss('request_timeout_ms',e.target.value)}/></Field>
            <Field label="Retries"><input style={INP} type="number" value={sf.retry_count} onChange={e=>ss('retry_count',e.target.value)}/></Field>
          </Grid>
          <div style={{ display:'flex', gap:6, paddingTop:12, borderTop:'1px solid var(--border)' }}>
            <Btn variant="primary" onClick={saveSvc} disabled={saving}>{saving?'Saving…':'Save service'}</Btn>
            <Btn onClick={()=>{setShowSF(false);setEditSvc(null);setError('')}}>Cancel</Btn>
          </div>
        </div>
      )}

      {loading?<div style={{ textAlign:'center', padding:40 }}><Spinner/></div>:svcs.length===0?(
        <div style={{ border:'1px solid var(--border2)', borderRadius:10, padding:32, textAlign:'center', fontSize:12, color:'var(--text3)', background:'var(--bg2)' }}>No services yet. Add one above.</div>
      ):svcs.map(svc=>{
        const svcConns=conns.filter(c=>c.service_id===svc.id)
        const isExp=expanded.has(svc.id)
        const p=PRESETS.find(p=>p.label===svc.label)
        return (
          <div key={svc.id} style={{ border:'1px solid var(--border2)', borderRadius:10, marginBottom:10, overflow:'hidden', background:'var(--bg2)' }}>
            <div style={{ display:'flex', alignItems:'center', gap:10, padding:'12px 16px', cursor:'pointer' }} onClick={()=>tog(svc.id)}>
              <div style={{ width:28, height:28, borderRadius:6, background:p?.bg||'var(--bg4)', color:'#fff', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700, flexShrink:0 }}>{svc.label.slice(0,2).toUpperCase()}</div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:12, fontWeight:500, color:'var(--text)', marginBottom:1 }}>{svc.label} <Badge label={svc.environment} color={envColor(svc.environment)}/></div>
                <div style={{ fontSize:10, color:'var(--text3)' }}>{svc.base_url} · {svc.auth_type} · {svcConns.length} connection{svcConns.length!==1?'s':''}</div>
              </div>
              {user.role==='admin'&&<div style={{ display:'flex', gap:5 }} onClick={e=>e.stopPropagation()}>
                <Btn size="sm" onClick={()=>{const s=svc as unknown as Record<string,unknown>;setSf({...SE,label:String(s.label||''),base_url:String(s.base_url||''),environment:String(s.environment||'production'),auth_type:String(s.auth_type||'bearer'),rate_limit_rpm:String(s.rate_limit_rpm||''),request_timeout_ms:String(s.request_timeout_ms||30000),retry_count:String(s.retry_count||3)});setEditSvc(svc.id);setShowSF(true)}}>edit</Btn>
                <Btn size="sm" variant="danger" onClick={()=>delSvc(svc.id,svc.label)}>remove</Btn>
              </div>}
              <span style={{ fontSize:10, color:'var(--text3)', transform:isExp?'rotate(90deg)':'none', display:'inline-block', transition:'transform .2s' }}>▶</span>
            </div>
            {isExp&&(
              <div style={{ borderTop:'1px solid var(--border)' }}>
                <div style={{ display:'flex', alignItems:'center', gap:7, padding:'7px 16px', background:'var(--bg3)', borderBottom:'1px solid var(--border)', fontSize:10, flexWrap:'wrap' }}>
                  <span style={{ fontWeight:500, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'.06em' }}>shared auth:</span>
                  <span style={{ padding:'2px 7px', borderRadius:8, background:'var(--gbg)', border:'1px solid rgba(15,122,86,.2)', color:'var(--gt)', fontWeight:500 }}>✓ {svc.auth_type}</span>
                  {svc.rate_limit_rpm&&<span style={{ padding:'2px 7px', borderRadius:8, background:'var(--bg2)', border:'1px solid var(--border)', color:'var(--text3)' }}>{svc.rate_limit_rpm} req/min</span>}
                  <span style={{ padding:'2px 7px', borderRadius:8, background:'var(--bg2)', border:'1px solid var(--border)', color:'var(--text3)' }}>retry {svc.retry_count}×</span>
                  <span style={{ marginLeft:'auto', color:'var(--text3)' }}>all connections inherit ↑</span>
                </div>
                {svcConns.map(c=>(
                  <div key={c.id} style={{ display:'flex', alignItems:'center', gap:7, padding:'9px 16px 9px 38px', borderBottom:'1px solid var(--border)' }}>
                    <div style={{ width:6, height:1, background:'var(--border2)', flexShrink:0 }}/>
                    <div style={{ width:20, height:20, borderRadius:4, background:'var(--bg3)', border:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:8, color:'var(--text3)', fontWeight:600 }}>API</div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:11, fontWeight:500, color:'var(--text)' }}>{c.label}</div>
                      {c.description&&<div style={{ fontSize:10, color:'var(--text3)' }}>{c.description}</div>}
                    </div>
                    {c.base_path&&<code style={{ fontSize:10, color:'var(--text3)', background:'var(--bg3)', padding:'1px 5px', borderRadius:3, border:'1px solid var(--border)' }}>{c.base_path}</code>}
                    <span style={{ fontSize:9, padding:'1px 6px', borderRadius:8, background:'var(--bg3)', border:'1px solid var(--border)', color:'var(--text3)' }}>↑ inherits</span>
                    {user.role==='admin'&&<div style={{ display:'flex', gap:4 }}>
                      <Btn size="sm" onClick={()=>{setCf({...CE,...(c as unknown as Record<string,string>)});setEditConn(c.id);setShowCF(svc.id)}}>edit</Btn>
                      <Btn size="sm" variant="danger" onClick={()=>delConn(c.id,c.label)}>remove</Btn>
                    </div>}
                  </div>
                ))}
                {user.role==='admin'&&showCF!==svc.id&&(
                  <div style={{ padding:'8px 16px 8px 38px', cursor:'pointer', fontSize:11, color:'var(--text3)', display:'flex', alignItems:'center', gap:5 }} onClick={()=>{setCf(CE);setEditConn(null);setShowCF(svc.id)}}>
                    <span>+</span> add connection to {svc.label}
                  </div>
                )}
                {showCF===svc.id&&(
                  <div style={{ padding:'16px', borderTop:'1px solid var(--border)', background:'var(--bg3)' }}>
                    <div style={{ fontSize:12, fontWeight:500, marginBottom:12 }}>{editConn?'Edit connection':`Add connection to ${svc.label}`}</div>
                    <Grid cols={2}>
                      <Field label="Label" required><input style={INP} placeholder="Contacts API" value={cf.label} onChange={e=>sc('label',e.target.value)}/></Field>
                      <Field label="Base path" hint="Appended to service URL"><input style={INP} placeholder="/crm/v3/contacts" value={cf.base_path} onChange={e=>sc('base_path',e.target.value)}/></Field>
                    </Grid>
                    <Field label="Description"><input style={INP} placeholder="Get and create contacts" value={cf.description} onChange={e=>sc('description',e.target.value)}/></Field>
                    <div style={{ display:'flex', gap:6 }}>
                      <Btn variant="primary" onClick={()=>saveConn(svc.id)} disabled={saving}>{saving?'Saving…':'Save'}</Btn>
                      <Btn onClick={()=>{setShowCF(null);setEditConn(null)}}>Cancel</Btn>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
