'use client'
import { useState, useEffect, useRef } from 'react'
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
  // Presets handed to the owning tab when the user picks from the catalog. `nonce` re-triggers the
  // open even if the same source is picked twice.
  const [dbPreset, setDbPreset] = useState<{ dialect: string; nonce: number } | null>(null)
  const [apiPreset, setApiPreset] = useState<{ label: string; nonce: number } | null>(null)
  const [filePreset, setFilePreset] = useState<{ transport: string; nonce: number } | null>(null)

  // Picking a source from Browse opens the owning tab's form via React state, which pushes no
  // browser-history entry — so the Back button would skip the Browse grid and leave the Data
  // Sources tab entirely. We push a synthetic history entry on pick and intercept the matching
  // Back (popstate) to return to the grid, so the first Back lands on Browse as expected.
  const pushedRef = useRef(false)
  useEffect(() => {
    function onPop() {
      if (pushedRef.current) {
        pushedRef.current = false
        setActiveTab('browse')
      }
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  // Any time we're on Browse, there's no pending return-hop to consume.
  useEffect(() => { if (activeTab === 'browse') pushedRef.current = false }, [activeTab])

  const onPick = (entry: DsEntry) => {
    const tab = (CATEGORY_TAB[entry.category] || 'databases') as SubTab
    if (entry.category === 'database' && entry.dialect) {
      setDbPreset({ dialect: entry.dialect, nonce: Date.now() })
    } else if (entry.category === 'api') {
      setApiPreset({ label: entry.apiPreset || 'Custom', nonce: Date.now() })
    } else if (entry.category === 'file' && entry.fileTransport) {
      setFilePreset({ transport: entry.fileTransport, nonce: Date.now() })
    }
    // Leave a return-to-Browse marker in history (same URL — doesn't disturb the #data-sources
    // hash routing), once per Browse→form hop.
    if (activeTab === 'browse' && tab !== 'browse' && !pushedRef.current) {
      try { window.history.pushState({ mosaicDsBrowseReturn: true }, '') ; pushedRef.current = true } catch { /* history unavailable */ }
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
      {activeTab === 'apis'      && <TabAPIs user={user} openPreset={apiPreset} />}
      {activeTab === 'airbyte'   && <TabAirbyte user={user} />}
      {activeTab === 'files'     && <TabFileServers user={user} openTransport={filePreset} />}
      {activeTab === 'mcp'       && <TabMcp user={user} />}
      {activeTab === 'prism'     && <TabPrism user={user} />}
    </div>
  )
}
