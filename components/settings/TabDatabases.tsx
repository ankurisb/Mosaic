'use client'
import { useState, useEffect } from 'react'
import type { SessionUser } from '@/lib/auth'
import { SH, SS, INP, SEL, Btn, Badge, StatusDot, Field, Grid, Alert, Spinner } from './ui'

interface DbConn { id:string; label:string; dialect:string; environment:string; host:string; port:number; database_name:string; username:string; schema_name:string; ssl_mode:string; pool_min:number; pool_max:number; read_only:boolean }
const EMPTY = { label:'', dialect:'postgres', environment:'development', host:'', port:'5432', database_name:'', username:'', password:'', connection_string:'', schema_name:'public', ssl_mode:'prefer', ssl_ca:'', pool_min:'1', pool_max:'5', connect_timeout_ms:'5000', query_timeout_ms:'30000', read_only:false }

export default function TabDatabases({ user }: { user: SessionUser }) {
  const [conns, setConns] = useState<DbConn[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<Record<string,string|boolean>>(EMPTY)
  const [editing, setEditing] = useState<string|null>(null)
  const [testing, setTesting] = useState<string|null>(null)
  const [results, setResults] = useState<Record<string,{ok:boolean;message?:string;latencyMs?:number}>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function load() { setLoading(true); const r=await fetch('/api/connections'); if(r.ok)setConns((await r.json()).connections); setLoading(false) }
  useEffect(()=>{ load() },[])
  const set=(k:string,v:string|boolean)=>setForm(p=>({...p,[k]:v}))

  async function save() {
    if(!form.label){setError('Label is required');return}
    setSaving(true)
    const r=await fetch('/api/connections',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:editing?'update':'create',id:editing,...form})})
    const d=await r.json(); if(!r.ok){setError(d.error);setSaving(false);return}
    setSaving(false);setShowForm(false);setEditing(null);setForm(EMPTY);setError('');load()
  }

  async function test(id:string) {
    setTesting(id)
    const r=await fetch('/api/connections',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'test',id})})
    const d=await r.json(); setResults(p=>({...p,[id]:d})); setTesting(null)
  }

  function del(id:string,label:string) {
    if(!confirm(`Delete "${label}"?`))return
    fetch('/api/connections',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'delete',id})}).then(()=>load())
  }

  const envColor=(e:string):'red'|'amber'|'green'=>e==='production'?'red':e==='staging'?'amber':'green'

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:4 }}>
        <div style={SH}>Databases</div>
        {user.role==='admin'&&<Btn variant="primary" onClick={()=>{setShowForm(!showForm);setEditing(null);setForm(EMPTY);setError('')}}>+ add database</Btn>}
      </div>
      <div style={SS}>Connect databases so Claude can query them in chat.</div>
      <Alert variant="info">Once connected, ask Claude: <em>"Query the [label] database for..."</em></Alert>
      {error&&<Alert variant="error">{error}</Alert>}

      {showForm&&(
        <div style={{ background:'var(--bg2)', border:'1px solid var(--border2)', borderRadius:10, padding:20, marginBottom:16 }}>
          <div style={{ fontSize:12, fontWeight:500, marginBottom:16 }}>{editing?'Edit connection':'New database connection'}</div>
          <Grid cols={2}>
            <Field label="Display label" required><input style={INP} placeholder="Production DB" value={String(form.label)} onChange={e=>set('label',e.target.value)}/></Field>
            <Field label="Environment"><select style={SEL} value={String(form.environment)} onChange={e=>set('environment',e.target.value)}><option value="production">🔴 Production</option><option value="staging">🟡 Staging</option><option value="development">🟢 Development</option></select></Field>
          </Grid>
          <Field label="Type">
            <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
              {[['postgres','PostgreSQL'],['mysql','MySQL'],['mssql','SQL Server'],['sqlite','SQLite']].map(([v,l])=>(
                <button key={v} onClick={()=>set('dialect',v)} style={{ padding:'5px 12px', borderRadius:20, border:`1px solid ${form.dialect===v?'var(--blue)':'var(--border2)'}`, background:form.dialect===v?'var(--bbg)':'none', color:form.dialect===v?'var(--bt)':'var(--text2)', fontSize:11, cursor:'pointer', fontFamily:'inherit' }}>{l}</button>
              ))}
            </div>
          </Field>
          <Grid cols={3}>
            <Field label="Host"><input style={INP} placeholder="db.company.com" value={String(form.host)} onChange={e=>set('host',e.target.value)}/></Field>
            <Field label="Port"><input style={INP} placeholder="5432" value={String(form.port)} onChange={e=>set('port',e.target.value)}/></Field>
            <Field label="Database"><input style={INP} placeholder="mydb" value={String(form.database_name)} onChange={e=>set('database_name',e.target.value)}/></Field>
          </Grid>
          <Grid cols={3}>
            <Field label="Username"><input style={INP} placeholder="app_user" value={String(form.username)} onChange={e=>set('username',e.target.value)}/></Field>
            <Field label="Password" hint="Stored encrypted"><input style={INP} type="password" placeholder="••••••••" value={String(form.password)} onChange={e=>set('password',e.target.value)}/></Field>
            <Field label="SSL mode"><select style={SEL} value={String(form.ssl_mode)} onChange={e=>set('ssl_mode',e.target.value)}>{['disable','allow','prefer','require','verify-ca','verify-full'].map(m=><option key={m}>{m}</option>)}</select></Field>
          </Grid>
          <Field label="Or use full connection string" hint="Overrides fields above"><input style={INP} type="password" placeholder="postgresql://user:pass@host/db" value={String(form.connection_string)} onChange={e=>set('connection_string',e.target.value)}/></Field>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', paddingTop:12, borderTop:'1px solid var(--border)' }}>
            <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:12, cursor:'pointer', color:'var(--text2)' }}>
              <input type="checkbox" checked={Boolean(form.read_only)} onChange={e=>set('read_only',e.target.checked)}/> Read-only mode
            </label>
            <div style={{ display:'flex', gap:6 }}>
              <Btn variant="primary" onClick={save} disabled={saving}>{saving?'Saving…':'Save connection'}</Btn>
              <Btn onClick={()=>{setShowForm(false);setEditing(null);setError('')}}>Cancel</Btn>
            </div>
          </div>
        </div>
      )}

      {loading?<div style={{ textAlign:'center', padding:40 }}><Spinner/></div>:conns.length===0?(
        <div style={{ border:'1px solid var(--border2)', borderRadius:10, padding:32, textAlign:'center', fontSize:12, color:'var(--text3)', background:'var(--bg2)' }}>No connections yet. Add one above.</div>
      ):(
        <div style={{ border:'1px solid var(--border2)', borderRadius:10, overflow:'hidden', background:'var(--bg2)' }}>
          {conns.map((c,i)=>{
            const tr=results[c.id]
            return (
              <div key={c.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'12px 16px', borderBottom:i<conns.length-1?'1px solid var(--border)':'none' }}>
                <StatusDot status={tr?(tr.ok?'healthy':'down'):'unknown'}/>
                <span style={{ fontSize:10, fontWeight:500, padding:'1px 6px', borderRadius:3, background:'var(--bg3)', border:'1px solid var(--border)', color:'var(--text2)' }}>{c.dialect.toUpperCase()}</span>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:12, fontWeight:500, color:'var(--text)', marginBottom:2 }}>{c.label} <Badge label={c.environment} color={envColor(c.environment)}/></div>
                  <div style={{ fontSize:10, color:'var(--text3)' }}>{c.host}:{c.port}/{c.database_name} · SSL: {c.ssl_mode}{c.read_only?' · read-only':''}</div>
                  {tr&&<div style={{ fontSize:10, color:tr.ok?'var(--gt)':'var(--rt)', marginTop:2 }}>{tr.ok?`✓ Connected · ${tr.latencyMs}ms`:`✗ ${tr.message}`}</div>}
                </div>
                <div style={{ display:'flex', gap:5 }}>
                  <Btn size="sm" onClick={()=>test(c.id)} disabled={testing===c.id}>{testing===c.id?<Spinner/>:'test'}</Btn>
                  {user.role==='admin'&&<Btn size="sm" onClick={()=>{setForm({...EMPTY,...c,port:String(c.port),pool_min:String(c.pool_min),pool_max:String(c.pool_max)});setEditing(c.id);setShowForm(true)}}>edit</Btn>}
                  {user.role==='admin'&&<Btn size="sm" variant="danger" onClick={()=>del(c.id,c.label)}>remove</Btn>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
