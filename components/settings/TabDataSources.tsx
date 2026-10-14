'use client'
import { useState } from 'react'
import type { SessionUser } from '@/lib/auth'
import TabDatabases from './TabDatabases'
import TabAPIs from './TabAPIs'
import TabFileServers from './TabFileServers'
import TabPrism from './TabPrism'
import TabMcp from './TabMcp'
import SourceHealthCard, { type HealthData } from '@/components/SourceHealthCard'

type SubTab = 'databases' | 'apis' | 'files' | 'mcp' | 'prism'

export default function TabDataSources({ user }: { user: SessionUser }) {
  const [activeTab, setActiveTab] = useState<SubTab>('databases')
  const [health, setHealth] = useState<HealthData | null>(null)
  const [checking, setChecking] = useState(false)
  const [healthErr, setHealthErr] = useState('')

  async function checkAll() {
    setChecking(true); setHealthErr('')
    try {
      const r = await fetch('/api/datasources/health')
      const d = await r.json()
      if (!r.ok) { setHealthErr(d.error || 'Health check failed'); return }
      setHealth(d as HealthData)
    } catch { setHealthErr('Health check failed') }
    finally { setChecking(false) }
  }

  const tabs: { id: SubTab; label: string }[] = [
    { id: 'databases', label: 'Databases' },
    { id: 'apis',      label: 'API connections' },
    { id: 'files',     label: 'File servers' },
    { id: 'mcp',       label: 'MCP servers' },
    { id: 'prism',     label: 'Prism' },
  ]

  return (
    <div>
      {/* Health check — one bounded probe per source */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 14 }}>
        <div style={{ fontSize: 12.5, color: 'var(--text3)' }}>Check that every configured source is reachable in one go.</div>
        <button onClick={checkAll} disabled={checking}
          style={{ fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit', padding: '7px 14px', borderRadius: 'var(--radius-pill)', border: '1px solid var(--border)', background: checking ? 'var(--bg3)' : 'var(--text)', color: checking ? 'var(--text3)' : 'var(--surface)', cursor: checking ? 'default' : 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
          {checking ? 'Checking…' : 'Check all sources'}
        </button>
      </div>
      {healthErr && <div style={{ fontSize: 12.5, color: 'var(--red-t,#dc2626)', marginBottom: 12 }}>{healthErr}</div>}
      {health && <SourceHealthCard data={health} />}

      {/* Tab strip */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 24 }}>
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            style={{ padding: '10px 16px', fontSize: 13, fontWeight: activeTab === tab.id ? 600 : 400, color: activeTab === tab.id ? 'var(--text)' : 'var(--text3)', background: 'none', border: 'none', borderBottom: activeTab === tab.id ? '2px solid var(--accent-fg)' : '2px solid transparent', cursor: 'pointer', fontFamily: 'inherit', marginBottom: -1 }}>
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'databases' && <TabDatabases user={user} />}
      {activeTab === 'apis'      && <TabAPIs user={user} />}
      {activeTab === 'files'     && <TabFileServers user={user} />}
      {activeTab === 'mcp'       && <TabMcp user={user} />}
      {activeTab === 'prism'     && <TabPrism user={user} />}
    </div>
  )
}
