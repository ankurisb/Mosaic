'use client'
import { useState } from 'react'
import type { SessionUser } from '@/lib/auth'
import TabDatabases from './TabDatabases'
import TabAPIs from './TabAPIs'
import TabFileServers from './TabFileServers'
import TabPrism from './TabPrism'
import TabMcp from './TabMcp'

type SubTab = 'databases' | 'apis' | 'files' | 'mcp' | 'prism'

export default function TabDataSources({ user }: { user: SessionUser }) {
  const [activeTab, setActiveTab] = useState<SubTab>('databases')

  const tabs: { id: SubTab; label: string }[] = [
    { id: 'databases', label: 'Databases' },
    { id: 'apis',      label: 'API connections' },
    { id: 'files',     label: 'File servers' },
    { id: 'mcp',       label: 'MCP servers' },
    { id: 'prism',     label: 'Prism' },
  ]

  return (
    <div>
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
