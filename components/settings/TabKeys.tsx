'use client'
import { useState } from 'react'
import type { SessionUser } from '@/lib/auth'
import { SH, SS, SLBL, CARD, ROW, ROW_LAST, INP, Btn, Badge, Alert } from './ui'

export default function TabKeys({ user }: { user: SessionUser }) {
  const [editing, setEditing] = useState<string|null>(null)
  const [vals, setVals] = useState<Record<string,string>>({})
  const [saved, setSaved] = useState<string|null>(null)
  void user

  function save(key: string) { setSaved(key); setEditing(null); setTimeout(()=>setSaved(null),2000) }

  return (
    <div>
      <div style={SH}>API keys</div>
      <div style={SS}>Configure external service keys.</div>
      <div style={SLBL}>Service keys</div>
      <div style={CARD}>
        <div style={ROW}>
          <div>
            <div style={{ fontSize:12, fontWeight:500, color:'var(--text)' }}>Anthropic API key {saved==='anthropic'?<Badge label="saved ✓" color="green"/>:<Badge label="configured" color="green"/>}</div>
            <div style={{ fontSize:11, color:'var(--text3)', marginTop:2 }}>Powers all Claude completions</div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ fontSize:11, color:'var(--text3)' }}>••••••api-key</span>
            <Btn size="sm" onClick={() => setEditing(editing==='anthropic'?null:'anthropic')}>update</Btn>
          </div>
        </div>
        {editing==='anthropic' && (
          <div style={{ padding:'10px 16px', borderBottom:'1px solid var(--border)', background:'var(--bg3)', display:'flex', gap:6 }}>
            <input style={{...INP,flex:1}} type="password" placeholder="sk-ant-..." value={vals.anthropic||''} onChange={e=>setVals(p=>({...p,anthropic:e.target.value}))}/>
            <Btn variant="primary" size="sm" onClick={()=>save('anthropic')}>save</Btn>
            <Btn size="sm" onClick={()=>setEditing(null)}>cancel</Btn>
          </div>
        )}
        <div style={ROW}>
          <div>
            <div style={{ fontSize:12, fontWeight:500, color:'var(--text)' }}>Tavily Search {saved==='tavily'?<Badge label="saved ✓" color="green"/>:<Badge label="optional" color="gray"/>}</div>
            <div style={{ fontSize:11, color:'var(--text3)', marginTop:2 }}>Web search tool · free at app.tavily.com</div>
          </div>
          <Btn size="sm" onClick={() => setEditing(editing==='tavily'?null:'tavily')}>configure</Btn>
        </div>
        {editing==='tavily' && (
          <div style={{ padding:'10px 16px', borderBottom:'1px solid var(--border)', background:'var(--bg3)', display:'flex', gap:6 }}>
            <input style={{...INP,flex:1}} type="password" placeholder="tvly-..." value={vals.tavily||''} onChange={e=>setVals(p=>({...p,tavily:e.target.value}))}/>
            <Btn variant="primary" size="sm" onClick={()=>save('tavily')}>save</Btn>
            <Btn size="sm" onClick={()=>setEditing(null)}>cancel</Btn>
          </div>
        )}
        <div style={ROW_LAST}>
          <div>
            <div style={{ fontSize:12, fontWeight:500, color:'var(--text)' }}>Auth secret <Badge label="configured" color="green"/></div>
            <div style={{ fontSize:11, color:'var(--text3)', marginTop:2 }}>Signs session tokens · set via env var</div>
          </div>
          <span style={{ fontSize:11, color:'var(--text3)' }}>••••••••</span>
        </div>
      </div>
      <Alert variant="info">API keys are set as environment variables in Vercel → Settings → Environment Variables. Changes require a redeploy.</Alert>
    </div>
  )
}
