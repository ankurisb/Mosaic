'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { SessionUser } from '@/lib/auth'
import TabKeys from './TabKeys'
import TabAuth from './TabAuth'
import TabUsers from './TabUsers'
import TabUsage from './TabUsage'
import TabMonitor from './TabMonitor'
import TabDatabases from './TabDatabases'
import TabAPIs from './TabAPIs'
import TabAbout from './TabAbout'

const TABS = [
  {id:'keys',label:'API keys'},{id:'auth',label:'Authentication'},
  {id:'users',label:'Users'},{id:'usage',label:'Usage analytics'},
  {id:'monitor',label:'Monitoring'},{id:'databases',label:'Databases'},
  {id:'apis',label:'API connections'},{id:'about',label:'About'},
]

export default function SettingsPage({ user }: { user: SessionUser }) {
  const router = useRouter()
  const [tab, setTab] = useState('keys')

  return (
    <div style={{ display:'flex', height:'100vh', overflow:'hidden' }}>
      <div style={{ width:220, flexShrink:0, display:'flex', flexDirection:'column', background:'var(--bg2)', borderRight:'1px solid var(--border)' }}>
        <div style={{ padding:'14px 12px 10px', borderBottom:'1px solid var(--border)' }}>
          <div style={{ display:'flex', alignItems:'baseline', gap:6, marginBottom:6 }}>
            <span style={{ fontSize:12, fontWeight:500 }}>claude app</span>
            <span style={{ fontSize:9, color:'var(--text3)', padding:'1px 5px', borderRadius:3, background:'var(--bg3)', border:'1px solid var(--border)' }}>v1.0.0</span>
          </div>
          <button onClick={() => router.push('/')} style={{ background:'none', border:'none', fontSize:11, color:'var(--text3)', cursor:'pointer', padding:0 }}>← Back to chat</button>
        </div>
        <div style={{ flex:1, padding:6 }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ width:'100%', padding:'7px 8px', background:tab===t.id?'var(--bg3)':'none', border:`1px solid ${tab===t.id?'var(--border2)':'transparent'}`, borderRadius:5, cursor:'pointer', fontSize:11, color:tab===t.id?'var(--text)':'var(--text2)', textAlign:'left', marginBottom:1 }}>
              {t.label}
            </button>
          ))}
        </div>
        <div style={{ borderTop:'1px solid var(--border)', padding:'10px 12px' }}>
          <div style={{ fontSize:11, color:'var(--text)', fontWeight:500, marginBottom:1 }}>{user.name}</div>
          <div style={{ fontSize:10, color:'var(--text3)' }}>{user.email}</div>
        </div>
      </div>
      <div style={{ flex:1, overflowY:'auto', background:'var(--bg)' }}>
        <div style={{ maxWidth:820, margin:'0 auto', padding:'28px 32px' }}>
          {tab==='keys'      && <TabKeys user={user}/>}
          {tab==='auth'      && <TabAuth user={user}/>}
          {tab==='users'     && <TabUsers user={user}/>}
          {tab==='usage'     && <TabUsage user={user}/>}
          {tab==='monitor'   && <TabMonitor/>}
          {tab==='databases' && <TabDatabases user={user}/>}
          {tab==='apis'      && <TabAPIs user={user}/>}
          {tab==='about'     && <TabAbout/>}
        </div>
      </div>
    </div>
  )
}
