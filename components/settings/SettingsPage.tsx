'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { SessionUser } from '@/lib/auth'
import ThemeToggle from '../ThemeToggle'
import TabKeys from './TabKeys'
import TabAuth from './TabAuth'
import TabUsers from './TabUsers'
import TabUsage from './TabUsage'
import TabMonitor from './TabMonitor'
import TabDatabases from './TabDatabases'
import TabAPIs from './TabAPIs'
import TabAbout from './TabAbout'

const TABS = [
  { id: 'keys',      label: 'API keys',         icon: '🔑' },
  { id: 'auth',      label: 'Authentication',    icon: '🔒' },
  { id: 'users',     label: 'Users',             icon: '👥' },
  { id: 'usage',     label: 'Usage analytics',   icon: '📊' },
  { id: 'monitor',   label: 'Monitoring',        icon: '💚' },
  { id: 'databases', label: 'Databases',         icon: '🗄️' },
  { id: 'apis',      label: 'API connections',   icon: '🌐' },
  { id: 'about',     label: 'About',             icon: 'ℹ️' },
]

export default function SettingsPage({ user }: { user: SessionUser }) {
  const router = useRouter()
  const [tab, setTab] = useState('keys')

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--bg)' }}>

      {/* Sidebar */}
      <div style={{ width: 240, flexShrink: 0, display: 'flex', flexDirection: 'column', background: 'var(--surface)', borderRight: '1px solid var(--border)' }}>

        {/* Logo */}
        <div style={{ padding: '18px 16px 14px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 }}>
            <span style={{ fontFamily: 'var(--font-serif)', fontSize: 15, color: 'var(--text)' }}>claude app</span>
            <span style={{ fontSize: 10, color: 'var(--text4)', background: 'var(--bg3)', padding: '1px 6px', borderRadius: 'var(--radius-pill)', border: '1px solid var(--border)' }}>v1.0.0</span>
          </div>
          <button onClick={() => router.push('/')} style={{ background: 'none', border: 'none', fontSize: 12, color: 'var(--text3)', cursor: 'pointer', padding: 0, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4 }}>← Back to chat</button>
        </div>

        {/* Nav */}
        <div style={{ flex: 1, padding: '8px 8px', overflowY: 'auto' }}>
          <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text4)', textTransform: 'uppercase', letterSpacing: '.08em', padding: '6px 10px 4px' }}>Settings</div>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ width: '100%', padding: '9px 12px', background: tab === t.id ? 'var(--bg3)' : 'transparent', border: `1px solid ${tab === t.id ? 'var(--border2)' : 'transparent'}`, borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: 13, color: tab === t.id ? 'var(--text)' : 'var(--text2)', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 9, fontFamily: 'inherit', marginBottom: 1, transition: 'background .12s' }}
              onMouseEnter={e => { if (tab !== t.id) e.currentTarget.style.background = 'var(--bg3)' }}
              onMouseLeave={e => { if (tab !== t.id) e.currentTarget.style.background = 'transparent' }}>
              <span style={{ fontSize: 14, width: 18, textAlign: 'center', flexShrink: 0 }}>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>

        {/* User + theme */}
        <div style={{ borderTop: '1px solid var(--border)', padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.name}</div>
            <div style={{ fontSize: 10, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</div>
          </div>
          <ThemeToggle />
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', background: 'var(--bg)' }}>
        <div style={{ maxWidth: 820, margin: '0 auto', padding: '40px 40px' }}>
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
