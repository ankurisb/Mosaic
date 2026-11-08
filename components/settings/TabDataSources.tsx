'use client'
import { useState } from 'react'
import type { SessionUser } from '@/lib/auth'
import TabDatabases from './TabDatabases'
import TabAPIs from './TabAPIs'
import TabFileServers from './TabFileServers'
import TabPrism from './TabPrism'
import TabMcp from './TabMcp'
import TabAirbyte from './TabAirbyte'
import TabDataSourceCatalog from './TabDataSourceCatalog'
import { CATEGORY_TAB, type DsEntry } from '@/lib/datasource-catalog'

type SubTab = 'browse' | 'databases' | 'apis' | 'files' | 'mcp' | 'prism' | 'airbyte'

export default function TabDataSources({ user }: { user: SessionUser }) {
  const [activeTab, setActiveTab] = useState<SubTab>('browse')
  // A pre-selected database dialect handed to TabDatabases when the user picks a database from the
  // catalog. `nonce` re-triggers the open even if the same dialect is picked twice.
  const [dbPreset, setDbPreset] = useState<{ dialect: string; nonce: number } | null>(null)

  const onPick = (entry: DsEntry) => {
    const tab = (CATEGORY_TAB[entry.category] || 'databases') as SubTab
    if (entry.category === 'database' && entry.dialect) {
      setDbPreset({ dialect: entry.dialect, nonce: Date.now() })
    }
    setActiveTab(tab)
  }

  const tabs: { id: SubTab; label: string }[] = [
    { id: 'browse',    label: 'Browse' },
    { id: 'databases', label: 'Databases' },
    { id: 'apis',      label: 'API' },
    { id: 'airbyte',   label: '3rd party connectors' },
    { id: 'files',     label: 'File servers' },
    { id: 'mcp',       label: 'MCP servers' },
    { id: 'prism',     label: 'Prism' },
  ]

  return (
    <div>
      {/* Tab strip */}
      <div style={{ display: 'flex', flexWrap: 'wrap', borderBottom: '1px solid var(--border)', marginBottom: 24 }}>
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            style={{ padding: '10px 16px', fontSize: 13, fontWeight: activeTab === tab.id ? 600 : 400, color: activeTab === tab.id ? 'var(--text)' : 'var(--text3)', background: 'none', border: 'none', borderBottom: activeTab === tab.id ? '2px solid var(--accent-fg)' : '2px solid transparent', cursor: 'pointer', fontFamily: 'inherit', marginBottom: -1 }}>
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'browse'    && <TabDataSourceCatalog onPick={onPick} />}
      {activeTab === 'databases' && <TabDatabases user={user} preset={dbPreset} />}
      {activeTab === 'apis'      && <TabAPIs user={user} />}
      {activeTab === 'airbyte'   && <TabAirbyte user={user} />}
      {activeTab === 'files'     && <TabFileServers user={user} />}
      {activeTab === 'mcp'       && <TabMcp user={user} />}
      {activeTab === 'prism'     && <TabPrism user={user} />}
    </div>
  )
}
