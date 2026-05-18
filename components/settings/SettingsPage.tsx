'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import type { SessionUser } from '@/lib/auth'
import ThemeToggle from '../ThemeToggle'
import TabKeys from './TabKeys'
import TabAuth from './TabAuth'
import TabUsers from './TabUsers'
import TabUsage from './TabUsage'
import TabMonitor from './TabMonitor'
import TabDataSources from './TabDataSources'
import TabAbout from './TabAbout'
import TabRcaWorkflows from './TabRcaWorkflows'
import TabAnalytics from './TabAnalytics'
import TabIntegrations from './TabIntegrations'
import TabGuardrails from './TabGuardrails'
import TabSetup from './TabSetup'
import TabDeveloperAPI from './TabDeveloperAPI'
import TabAudit from './TabAudit'
import { APP_VERSION } from '@/lib/version'

const ALL_TABS = [
  { id: 'setup',         label: 'Setup',                adminOnly: true  },
  { id: 'keys',          label: 'API keys',             adminOnly: false },
  { id: 'auth',          label: 'Authentication',       adminOnly: false },
  { id: 'users',         label: 'Users',                adminOnly: false },
  { id: 'developer-api', label: 'Developer API',        adminOnly: true  },
  { id: 'audit',         label: 'Audit trail',          adminOnly: true  },
  { id: 'usage',         label: 'Usage analytics',      adminOnly: false },
  { id: 'system-health', label: 'System health',        adminOnly: false },
  { id: 'data-sources',  label: 'Data sources',         adminOnly: false },
  { id: 'rca-workflows', label: 'RCA workflows',        adminOnly: false },
  { id: 'analytics',     label: 'Analysis capabilities',adminOnly: false },
  { id: 'guardrails',    label: 'Guardrails',           adminOnly: false },
  { id: 'notifications', label: 'Notifications',        adminOnly: false },
  { id: 'about',         label: 'About',                adminOnly: false },
]

function TabIcon({ id }: { id: string }) {
  const p = { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' as const }
  switch (id) {
    case 'setup':        return <svg {...p}><path d="M2 4h10M2 7h6M2 10h8"/><circle cx="11" cy="10" r="2" fill="none"/><path d="M12.5 11.5l1.5 1.5"/></svg>
    case 'developer-api':return <svg {...p}><path d="M4 5l-3 2 3 2M10 5l3 2-3 2M7 3l-1 8"/></svg>
    case 'audit':        return <svg {...p}><path d="M2 4h10M2 7h7M2 10h5"/><path d="M11 8l1.5 1.5L15 7"/></svg>
    case 'keys':         return <svg {...p}><circle cx="5.5" cy="5.5" r="2.5"/><path d="M7.5 7.5l4 4M9.5 9.5l1.5-1.5"/></svg>
    case 'auth':         return <svg {...p}><rect x="2" y="6" width="10" height="7" rx="1.5"/><path d="M4 6V4a3 3 0 016 0v2"/></svg>
    case 'users':        return <svg {...p}><circle cx="5" cy="4" r="2"/><path d="M1 12c0-2.2 1.8-4 4-4s4 1.8 4 4"/><circle cx="11" cy="5" r="1.5"/><path d="M11 8.5c1.4 0 2.5.9 2.5 2"/></svg>
    case 'usage':        return <svg {...p}><rect x="1" y="7" width="3" height="6" rx="0.5"/><rect x="5.5" y="4" width="3" height="9" rx="0.5"/><rect x="10" y="1" width="3" height="12" rx="0.5"/></svg>
    case 'system-health':      return <svg {...p}><rect x="1" y="2" width="12" height="8" rx="1.5"/><path d="M4 13h6M7 10v3"/><path d="M3 6l2 2 2-3 2 2 1.5-1.5"/></svg>
    case 'data-sources': return <svg {...p}><ellipse cx="7" cy="4" rx="5" ry="2"/><path d="M2 4v6c0 1.1 2.2 2 5 2s5-.9 5-2V4"/><path d="M2 7c0 1.1 2.2 2 5 2s5-.9 5-2"/></svg>
    case 'apis':         return <svg {...p}><rect x="1" y="4" width="12" height="6" rx="1.5"/><path d="M3.5 7h2M8.5 7h2"/></svg>
    case 'files':        return <svg {...p}><path d="M2 3h4l1.5 2H12a1 1 0 011 1v5a1 1 0 01-1 1H2a1 1 0 01-1-1V4a1 1 0 011-1z"/></svg>
    case 'analytics':    return <svg {...p}><polyline points="2,12 7,6 11,10 14,4 18,8"/><line x1="2" y1="12" x2="18" y2="12" opacity={0.3}/><circle cx="14" cy="4" r="1.5" fill="currentColor" stroke="none"/></svg>
    case 'rca-workflows':return <svg {...p}><rect x="1" y="1" width="4" height="3" rx="1"/><rect x="1" y="10" width="4" height="3" rx="1"/><rect x="9" y="5.5" width="4" height="3" rx="1"/><line x1="3" y1="4" x2="3" y2="10"/><line x1="3" y1="7" x2="9" y2="7"/></svg>
    case 'notifications': return <svg {...p}><circle cx="3" cy="7" r="1.5"/><circle cx="11" cy="3" r="1.5"/><circle cx="11" cy="11" r="1.5"/><path d="M4.5 7h2l2-4M4.5 7h2l2 4"/></svg>
    case 'guardrails':   return <svg {...p}><path d="M7 1l5 2v4c0 2.5-2 4.5-5 6C4 11.5 2 9.5 2 7V3l5-2z"/><path d="M5 7l1.5 1.5L9 5"/></svg>
    case 'about':        return <svg {...p}><circle cx="7" cy="7" r="5.5"/><path d="M7 6.5v4M7 4.5v.5"/></svg>
    default:             return null
  }
}

export default function SettingsPage({ user }: { user: SessionUser }) {
  const router = useRouter()
  const TABS = ALL_TABS.filter(t => !t.adminOnly || user.role === 'admin')
  const validTabIds = TABS.map(t => t.id)

  const [tab, setTab] = useState(() => {
    if (typeof window !== 'undefined') {
      const hash = window.location.hash.replace('#', '')
      if (validTabIds.includes(hash)) return hash
    }
    return user.role === 'admin' ? 'setup' : 'keys'
  })

  // Listen for hash changes so TabSetup action buttons can navigate here
  useEffect(() => {
    function onHashChange() {
      const hash = window.location.hash.replace('#', '')
      const ids = ALL_TABS.filter(t => !t.adminOnly || user.role === 'admin').map(t => t.id)
      if (ids.includes(hash)) setTab(hash)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  function navigateTab(id: string) {
    setTab(id)
    window.location.hash = id
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--bg)' }}>

      {/* Sidebar */}
      <div style={{ width: 240, flexShrink: 0, display: 'flex', flexDirection: 'column', background: 'var(--surface)', borderRight: '1px solid var(--border)' }}>

        {/* Logo */}
        <div style={{ padding: '18px 16px 14px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ marginBottom: 2 }}>
            <span style={{ fontFamily: 'var(--font-serif)', fontSize: 20, color: 'var(--text)' }}>Mosaic</span>
          </div>
          <button onClick={() => router.push('/')} style={{ background: 'none', border: 'none', fontSize: 12, color: 'var(--text3)', cursor: 'pointer', padding: 0, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 2L4 7l5 5"/></svg>
            Back to chat
          </button>
        </div>

        {/* Nav */}
        <div style={{ flex: 1, padding: '8px 8px', overflowY: 'auto' }}>
          <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text4)', textTransform: 'uppercase', letterSpacing: '.08em', padding: '6px 10px 4px' }}>Settings</div>
          {TABS.map(t => (
            <button key={t.id} onClick={() => navigateTab(t.id)}
              style={{ width: '100%', padding: '9px 12px', background: tab === t.id ? 'var(--bg3)' : 'transparent', border: `1px solid ${tab === t.id ? 'var(--border2)' : 'transparent'}`, borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: 13, color: tab === t.id ? 'var(--text)' : 'var(--text2)', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 9, fontFamily: 'inherit', marginBottom: 1, transition: 'background .12s' }}
              onMouseEnter={e => { if (tab !== t.id) e.currentTarget.style.background = 'var(--bg3)' }}
              onMouseLeave={e => { if (tab !== t.id) e.currentTarget.style.background = 'transparent' }}>
              <span style={{ width: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: tab === t.id ? 'var(--text)' : 'var(--text3)' }}><TabIcon id={t.id} /></span>
              {t.label}
            </button>
          ))}
        </div>

        {/* User + theme */}
        <div style={{ borderTop: '1px solid var(--border)', padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.name}</div>
            <div style={{ fontSize: 10, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</div>
            <div style={{ fontSize: 10, color: 'var(--text4)', marginTop: 2 }}>v{APP_VERSION}</div>
          </div>
          <ThemeToggle />
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', background: 'var(--bg)' }}>
        <div style={{ maxWidth: tab === 'analytics' ? 1100 : 820, margin: '0 auto', padding: '40px 40px' }}>
          {tab === 'setup'        && <TabSetup user={user} onNavigate={navigateTab} />}
          {tab === 'developer-api'&& <TabDeveloperAPI user={user} />}
          {tab === 'audit'        && <TabAudit user={user} />}
          {tab === 'keys'         && <TabKeys user={user} />}
          {tab === 'auth'      && <TabAuth user={user} />}
          {tab === 'users'     && <TabUsers user={user} />}
          {tab === 'usage'     && <TabUsage user={user} />}
          {tab === 'system-health' && <TabMonitor />}
          {tab === 'data-sources'  && <TabDataSources user={user} />}
          {tab === 'about'         && <TabAbout />}
          {tab === 'rca-workflows' && <TabRcaWorkflows user={user} />}
        {tab === 'analytics' && <TabAnalytics />}
          {tab === 'notifications' && <TabIntegrations user={user} />}
          {tab === 'guardrails' && <TabGuardrails user={user} />}
        </div>
      </div>
    </div>
  )
}
