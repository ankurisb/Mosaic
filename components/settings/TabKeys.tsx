'use client'
import { useState } from 'react'
import type { SessionUser } from '@/lib/auth'
import { PageTitle, PageSub, Card, CardRow, INP, Btn, Badge, Alert } from './ui'

export default function TabKeys({ user }: { user: SessionUser }) {
  const [editing, setEditing] = useState<string | null>(null)
  const [vals, setVals] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState<string | null>(null)

  function save(key: string) {
    setSaved(key); setEditing(null)
    setTimeout(() => setSaved(null), 2500)
  }

  return (
    <div className="fade-in">
      <PageTitle>API keys</PageTitle>
      <PageSub>Configure the external service keys that power your Claude App.</PageSub>

      <Card>
        <CardRow>
          <div>
            <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', marginBottom: 2 }}>
              Anthropic API key {saved === 'anthropic' ? <Badge label="saved ✓" color="green" /> : <Badge label="configured" color="green" />}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>Powers all Claude AI completions · Set via environment variable</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>sk-ant-••••••</span>
            <Btn size="sm" onClick={() => setEditing(editing === 'anthropic' ? null : 'anthropic')}>update</Btn>
          </div>
        </CardRow>
        {editing === 'anthropic' && (
          <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', background: 'var(--bg)', display: 'flex', gap: 8 }}>
            <input style={{ ...INP, flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12 }} type="password" placeholder="sk-ant-api03-…" value={vals.anthropic || ''} onChange={e => setVals(p => ({ ...p, anthropic: e.target.value }))} />
            <Btn variant="primary" size="sm" onClick={() => save('anthropic')}>Save</Btn>
            <Btn size="sm" onClick={() => setEditing(null)}>Cancel</Btn>
          </div>
        )}

        <CardRow>
          <div>
            <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', marginBottom: 2 }}>
              Tavily Search {saved === 'tavily' ? <Badge label="saved ✓" color="green" /> : <Badge label="optional" color="gray" />}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>Web search tool · Free at app.tavily.com — 1,000 searches/month</div>
          </div>
          <Btn size="sm" onClick={() => setEditing(editing === 'tavily' ? null : 'tavily')}>configure</Btn>
        </CardRow>
        {editing === 'tavily' && (
          <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', background: 'var(--bg)', display: 'flex', gap: 8 }}>
            <input style={{ ...INP, flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12 }} type="password" placeholder="tvly-…" value={vals.tavily || ''} onChange={e => setVals(p => ({ ...p, tavily: e.target.value }))} />
            <Btn variant="primary" size="sm" onClick={() => save('tavily')}>Save</Btn>
            <Btn size="sm" onClick={() => setEditing(null)}>Cancel</Btn>
          </div>
        )}

        <CardRow last>
          <div>
            <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', marginBottom: 2 }}>Auth secret <Badge label="configured" color="green" /></div>
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>Signs session tokens · Set via environment variable</div>
          </div>
          <span style={{ fontSize: 12, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>••••••••</span>
        </CardRow>
      </Card>

      <Alert variant="info">
        💡 API keys are configured as environment variables in Vercel → Settings → Environment Variables. Changes require a redeploy to take effect.
      </Alert>
    </div>
  )
}
