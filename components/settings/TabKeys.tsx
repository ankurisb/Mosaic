'use client'
import { useState } from 'react'
import type { SessionUser } from '@/lib/auth'
import { SH, SS, CARD, ROW, ROW_LAST, INP, Btn, Badge } from './ui'

export default function TabKeys({ user }: { user: SessionUser }) {
  const [editing, setEditing] = useState<string | null>(null)
  const [vals, setVals] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState<Record<string, boolean>>({})

  function save(key: string) {
    setSaved(p => ({ ...p, [key]: true }))
    setEditing(null)
    setTimeout(() => setSaved(p => ({ ...p, [key]: false })), 2000)
  }

  const hasAnthropicKey = !!process.env.NEXT_PUBLIC_HAS_ANTHROPIC // always show as configured via env
  return (
    <div>
      <div style={SH}>API keys</div>
      <div style={SS}>Configure the external service keys your app uses.</div>

      <div style={{ ...CARD }}>
        <div style={ROW}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>Anthropic API key <Badge label="configured" color="green" /></div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>Powers all Claude AI completions · Set in environment variables</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>sk-ant-••••••••</span>
            <Btn onClick={() => setEditing(editing === 'anthropic' ? null : 'anthropic')}>update</Btn>
          </div>
        </div>
        {editing === 'anthropic' && (
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg2)', display: 'flex', gap: 8 }}>
            <input style={{ ...INP, flex: 1 }} type="password" placeholder="sk-ant-api03-..." value={vals.anthropic || ''} onChange={e => setVals(p => ({ ...p, anthropic: e.target.value }))} />
            <Btn variant="primary" onClick={() => save('anthropic')}>Save</Btn>
            <Btn onClick={() => setEditing(null)}>Cancel</Btn>
          </div>
        )}

        <div style={ROW}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>Tavily Search API key {saved.tavily ? <Badge label="saved" color="green" /> : <Badge label="optional" color="gray" />}</div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>Web search tool · Free at app.tavily.com (1,000 searches/month)</div>
          </div>
          <Btn onClick={() => setEditing(editing === 'tavily' ? null : 'tavily')}>configure</Btn>
        </div>
        {editing === 'tavily' && (
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg2)', display: 'flex', gap: 8 }}>
            <input style={{ ...INP, flex: 1 }} type="password" placeholder="tvly-..." value={vals.tavily || ''} onChange={e => setVals(p => ({ ...p, tavily: e.target.value }))} />
            <Btn variant="primary" onClick={() => save('tavily')}>Save</Btn>
            <Btn onClick={() => setEditing(null)}>Cancel</Btn>
          </div>
        )}

        <div style={ROW_LAST}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>Auth secret <Badge label="configured" color="green" /></div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>Used to sign session tokens · Set in environment variables</div>
          </div>
          <span style={{ fontSize: 11, color: 'var(--text3)' }}>••••••••</span>
        </div>
      </div>

      <div style={{ background: 'var(--bbg)', border: '1px solid var(--blue)', borderRadius: 8, padding: '12px 16px', fontSize: 11, color: 'var(--bt)' }}>
        💡 API keys are set as environment variables in Vercel → Settings → Environment Variables. Changes require a redeploy.
      </div>
    </div>
  )
}
