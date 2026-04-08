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
  { id: 'keys', label: 'API keys' },
  { id: 'auth', label: 'Authentication' },
  { id: 'users', label: 'Users' },
  { id: 'usage', label: 'Usage analytics' },
  { id: 'monitor', label: 'Monitoring' },
  { id: 'databases', label: 'Databases' },
  { id: 'apis', label: 'API connections' },
  { id: 'about', label: 'About' },
]

export default function SettingsPage({ user }: { user: SessionUser }) {
  const router = useRouter()
  const [tab, setTab] = useState('keys')

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* Sidebar */}
      <div style={{ width: 220, flexShrink: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg2)', borderRight: '1px solid var(--border)' }}>
        <div style={{ padding: '14px 12px 10px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 500 }}>claude app</span>
            <span style={{ fontSize: 9, color: 'var(--text3)', padding: '1px 4px', borderRadius: 3, background: 'var(--bg3)', border: '1px solid var(--border)' }}>v1.0.0</span>
          </div>
        </div>
        <div style={{ flex: 1, padding: 6 }}>
          <button onClick={() => router.push('/')} style={{ width: '100%', padding: '7px 8px', background: 'none', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: 11, color: 'var(--text3)', textAlign: 'left', marginBottom: 8 }}>← Back to chat</button>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ width: '100%', padding: '7px 8px', background: tab === t.id ? 'var(--bg3)' : 'none', border: `1px solid ${tab === t.id ? 'var(--border2)' : 'transparent'}`, borderRadius: 5, cursor: 'pointer', fontSize: 11, color: tab === t.id ? 'var(--text)' : 'var(--text2)', textAlign: 'left', marginBottom: 2 }}>
              {t.label}
            </button>
          ))}
        </div>
        <div style={{ borderTop: '1px solid var(--border)', padding: '10px 12px' }}>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>{user.name}</div>
          <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 1 }}>{user.email}</div>
          <span style={{ fontSize: 9, background: 'var(--pbg)', color: 'var(--pt)', padding: '1px 6px', borderRadius: 8, marginTop: 4, display: 'inline-block' }}>{user.role}</span>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', background: 'var(--bg)' }}>
        <div style={{ maxWidth: 860, margin: '0 auto', padding: '32px 32px' }}>
          {tab === 'keys'      && <TabKeys user={user} />}
          {tab === 'auth'      && <TabAuth user={user} />}
          {tab === 'users'     && <TabUsers user={user} />}
          {tab === 'usage'     && <TabUsage user={user} />}
          {tab === 'monitor'   && <TabMonitor />}
          {tab === 'databases' && <TabDatabases user={user} />}
          {tab === 'apis'      && <TabAPIs user={user} />}
          {tab === 'about'     && <TabAbout />}
        </div>
      </div>
    </div>
  )
}
