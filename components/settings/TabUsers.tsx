'use client'
import { useState, useEffect } from 'react'
import type { SessionUser } from '@/lib/auth'
import { SH, SS, INP, Btn, Badge, Alert, Field, Grid, Spinner } from './ui'

interface User { id:string; email:string; name:string; role:string; banned:boolean; created_at:string }

export default function TabUsers({ user }: { user: SessionUser }) {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [showInvite, setShowInvite] = useState(false)
  const [form, setForm] = useState({ email:'', name:'', role:'user', password:'' })
  const [invResult, setInvResult] = useState<{ tempPassword?:string; email?:string }|null>(null)
  const [error, setError] = useState('')

  async function load() { setLoading(true); const r=await fetch('/api/users'); if(r.ok)setUsers((await r.json()).users); setLoading(false) }
  useEffect(()=>{ load() },[])

  async function act(action:string, userId:string, extra?:object) {
    const r=await fetch('/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,userId,...extra})})
    const d=await r.json(); if(!r.ok){setError(d.error);return}; setError(''); load()
  }

  async function invite() {
    if(!form.email)return
    const r=await fetch('/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'invite',...form})})
    const d=await r.json(); if(!r.ok){setError(d.error);return}
    setInvResult({...d,email:form.email}); load()
  }

  if(user.role!=='admin') return <div><div style={SH}>Users</div><Alert variant="warning">Only admins can manage users.</Alert></div>

  const th: React.CSSProperties = { padding:'8px 14px', textAlign:'left', fontSize:9, color:'var(--text3)', textTransform:'uppercase', letterSpacing:'.1em', fontWeight:400, borderBottom:'1px solid var(--border)' }
  const td: React.CSSProperties = { padding:'10px 14px', borderBottom:'1px solid var(--border)', fontSize:12, color:'var(--text2)', verticalAlign:'middle' }

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:4 }}>
        <div style={SH}>Users</div>
        <Btn variant="primary" onClick={()=>{setShowInvite(!showInvite);setInvResult(null);setError('')}}>+ invite user</Btn>
      </div>
      <div style={SS}>{users.length} users</div>
      {error&&<Alert variant="error">{error}</Alert>}

      {showInvite&&!invResult&&(
        <div style={{ background:'var(--bg2)', border:'1px solid var(--border2)', borderRadius:10, padding:18, marginBottom:16 }}>
          <div style={{ fontSize:12, fontWeight:500, marginBottom:14 }}>Invite new user</div>
          <Grid cols={2}>
            <Field label="Email" required><input style={INP} type="email" placeholder="colleague@company.com" value={form.email} onChange={e=>setForm(p=>({...p,email:e.target.value}))}/></Field>
            <Field label="Role"><select style={{...INP,cursor:'pointer'}} value={form.role} onChange={e=>setForm(p=>({...p,role:e.target.value}))}><option value="user">user</option><option value="admin">admin</option></select></Field>
          </Grid>
          <div style={{ display:'flex', gap:6, marginTop:4 }}>
            <Btn variant="primary" onClick={invite}>send invite</Btn>
            <Btn onClick={()=>setShowInvite(false)}>cancel</Btn>
          </div>
        </div>
      )}
      {invResult&&(
        <div style={{ background:'var(--gbg)', border:'1px solid rgba(15,122,86,.2)', borderRadius:10, padding:16, marginBottom:16 }}>
          <div style={{ fontSize:12, fontWeight:500, color:'var(--gt)', marginBottom:8 }}>✓ User invited</div>
          {invResult.tempPassword&&<div style={{ background:'var(--bg2)', borderRadius:6, padding:'8px 12px', fontSize:11, fontFamily:'monospace', color:'var(--text)' }}>Email: {invResult.email}<br/>Password: {invResult.tempPassword}</div>}
          <Btn style={{ marginTop:10 }} onClick={()=>{setShowInvite(false);setInvResult(null);setForm({email:'',name:'',role:'user',password:''})}}>Done</Btn>
        </div>
      )}

      <div style={{ border:'1px solid var(--border2)', borderRadius:10, overflow:'hidden', background:'var(--bg2)' }}>
        <table style={{ width:'100%', borderCollapse:'collapse' }}>
          <thead><tr><th style={th}>User</th><th style={th}>Email</th><th style={th}>Role</th><th style={th}>Auth</th><th style={th}>Status</th><th style={th}></th></tr></thead>
          <tbody>
            {loading?<tr><td colSpan={6} style={{ padding:20, textAlign:'center' }}><Spinner/></td></tr>:
            users.map(u=>(
              <tr key={u.id}>
                <td style={td}><div style={{ display:'flex', alignItems:'center', gap:7 }}><div style={{ width:26, height:26, borderRadius:'50%', background:'var(--bg3)', border:'1px solid var(--border2)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:500, flexShrink:0 }}>{u.name.slice(0,2).toUpperCase()}</div><span style={{ color:'var(--text)' }}>{u.name}</span></div></td>
                <td style={td}>{u.email}</td>
                <td style={td}><Badge label={u.role} color={u.role==='admin'?'purple':'gray'}/></td>
                <td style={td}><span style={{ fontSize:11, color:'var(--text3)' }}>email</span></td>
                <td style={td}><Badge label={u.banned?'banned':'active'} color={u.banned?'red':'green'}/></td>
                <td style={{ ...td, borderBottom: u === users[users.length-1] ? 'none' : '1px solid var(--border)' }}>
                  {u.id!==user.id&&<div style={{ display:'flex', gap:4 }}>
                    <Btn size="sm" onClick={()=>act('setRole',u.id,{role:u.role==='admin'?'user':'admin'})}>{u.role==='admin'?'→ user':'→ admin'}</Btn>
                    <Btn size="sm" onClick={()=>act(u.banned?'unban':'ban',u.id)}>{u.banned?'unban':'ban'}</Btn>
                    <Btn size="sm" variant="danger" onClick={()=>confirm(`Delete ${u.email}?`)&&act('delete',u.id)}>remove</Btn>
                  </div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
