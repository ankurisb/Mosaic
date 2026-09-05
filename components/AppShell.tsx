'use client'
import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import type { SessionUser } from '@/lib/auth'
import ThemeToggle from './ThemeToggle'
import { UpdateModal } from '@/components/UpdateModal'

interface Conv { id: string; title: string }

export default function AppShell({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  const router   = useRouter()
  const pathname = usePathname()
  const [convs, setConvs] = useState<Conv[]>([])
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  // Version + update status, shown consistently in the nav (not just Settings).
  const [deploy, setDeploy] = useState<{ edition?: string; currentVersion?: string; updateAvailable?: boolean; latestVersion?: string | null; latestReleaseUrl?: string | null; changelog?: { version: string; date: string; sections: Record<string, string[]> }[] }>({})
  const [showUpdate, setShowUpdate] = useState(false)

  useEffect(() => {
    fetch('/api/conversations')
      .then(r => r.json())
      .then(d => { if (d.conversations?.length) setConvs(d.conversations.slice(0, 30)) })
      .catch(() => {})
    fetch('/api/deployment').then(r => r.json()).then(setDeploy).catch(() => {})
  }, [])

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
  }

  function navBtn(path: string, icon: React.ReactNode, label: string) {
    const active = path === '/' ? pathname === '/' : pathname.startsWith(path)
    return (
      <button onClick={() => router.push(path)} title={collapsed ? label : undefined}
        style={{ width: '100%', padding: collapsed ? '8px 0' : '8px 10px', background: active ? 'var(--bg3)' : 'none', border: `1px solid ${active ? 'var(--border2)' : 'transparent'}`, borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: 12, color: active ? 'var(--text)' : 'var(--text2)', textAlign: 'left' as const, display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'flex-start', gap: 7, fontFamily: 'inherit', transition: 'background .12s', marginBottom: 2 }}
        onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg3)' }}
        onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'none' }}>
        {icon}{!collapsed && label}
      </button>
    )
  }

  const isChat = pathname === '/'

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--bg)' }}>
      {showUpdate && <UpdateModal deploy={deploy} onClose={() => setShowUpdate(false)} />}
      {/* Sidebar */}
      <div style={{ width: collapsed ? 56 : 240, flexShrink: 0, display: 'flex', flexDirection: 'column', background: 'var(--surface)', borderRight: '1px solid var(--border)', transition: 'width .2s ease', overflow: 'hidden' }}>
        {/* Logo */}
        <div style={{ padding: '18px 16px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', minWidth: 0 }}>
          {!collapsed && <span style={{ fontFamily: 'var(--font-serif)', fontSize: 20, color: 'var(--text)', whiteSpace: 'nowrap' }}>Mosaic</span>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: collapsed ? 'auto' : 0, marginRight: collapsed ? 'auto' : 0 }}>
            {!collapsed && (
              <button onClick={() => router.push('/')} title="New conversation"
                style={{ width: 28, height: 28, borderRadius: 'var(--radius-pill)', border: '1px solid var(--border2)', background: 'var(--bg)', cursor: 'pointer', fontSize: 16, color: 'var(--text2)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--shadow)', lineHeight: 1 }}>+</button>
            )}
            <button onClick={() => setCollapsed(s => !s)} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              style={{ width: 28, height: 28, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border2)', background: 'var(--bg)', cursor: 'pointer', color: 'var(--text3)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'var(--shadow)' }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" style={{ transform: collapsed ? 'scaleX(-1)' : 'none', transition: 'transform .2s' }}>
                <rect x="1" y="1" width="12" height="12" rx="2"/>
                <line x1="5" y1="1" x2="5" y2="13"/>
                <path d="M3 5l-1.5 2 1.5 2" strokeWidth="1.2"/>
              </svg>
            </button>
          </div>
        </div>
        {/* Nav */}
        <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>
          {navBtn('/',
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M12 1H2a1 1 0 00-1 1v7a1 1 0 001 1h1v3l3-3h6a1 1 0 001-1V2a1 1 0 00-1-1z"/></svg>,
            'Chats'
          )}
          {navBtn('/dashboards',
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><rect x="1" y="7" width="4" height="6" rx="1"/><rect x="5.5" y="4" width="4" height="9" rx="1"/><rect x="10" y="1" width="3" height="12" rx="1"/></svg>,
            'Dashboards'
          )}
          {navBtn('/reports',
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M2 1h7l3 3v9a1 1 0 01-1 1H2a1 1 0 01-1-1V2a1 1 0 011-1z"/><path d="M9 1v3h3M4 6h6M4 8.5h6M4 11h4"/></svg>,
            'Reports'
          )}
          {navBtn('/query-builder',
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="2" width="12" height="10" rx="1.5"/><path d="M4 5.5l2 2-2 2M8 9.5h2.5"/></svg>,
            'Query Builder'
          )}
          {navBtn('/rules',
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M2 4h10M2 7h7M2 10h8"/><circle cx="12" cy="10" r="1.5" fill="currentColor" stroke="none"/></svg>,
            'Rules'
          )}
        </div>
        {/* Conversations */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px', opacity: isChat ? 1 : 0.5 }}>
          {!collapsed && convs.map(c => (
            <div key={c.id} onClick={() => router.push(`/?conv=${c.id}`)}
              style={{ display: 'flex', alignItems: 'center', padding: '8px 10px', borderRadius: 'var(--radius-sm)', cursor: 'pointer', marginBottom: 2, transition: 'background .12s' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
              <span style={{ fontSize: 12, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{c.title}</span>
            </div>
          ))}
        </div>
        {/* User + theme */}
        <div style={{ borderTop: '1px solid var(--border)', padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <button onClick={() => setShowUserMenu(v => !v)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', width: '100%' }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--bg4)', border: '1px solid var(--border2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, color: 'var(--text2)', flexShrink: 0 }}>
                {user.name.slice(0,2).toUpperCase()}
              </div>
              <div style={{ textAlign: 'left', overflow: 'hidden', flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.name}</div>
                <div style={{ fontSize: 10, color: 'var(--text3)' }}>{user.role}</div>
                {deploy.updateAvailable ? (
                  <button onClick={e => { e.stopPropagation(); setShowUpdate(true) }}
                    title={`Version ${deploy.latestVersion} is available`}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 3, padding: '1px 8px', borderRadius: 'var(--radius-pill)', background: 'var(--blue-bg, #eff6ff)', border: '1px solid var(--blue-t)', color: 'var(--blue-t)', fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', lineHeight: 1.6 }}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--blue-t)', display: 'inline-block' }} />
                    Update to v{deploy.latestVersion}
                  </button>
                ) : (
                  <div style={{ fontSize: 10, color: 'var(--text4)' }}>v{deploy.currentVersion || '—'}</div>
                )}
              </div>
            </button>
            {showUserMenu && (
              <>
                <div onClick={() => setShowUserMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
                <div style={{ position: 'absolute', bottom: 'calc(100% + 8px)', left: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-lg)', padding: 6, width: 200, zIndex: 50 }}>
                  <div style={{ padding: '8px 10px', fontSize: 12, borderBottom: '1px solid var(--border)', marginBottom: 4 }}>
                    <div style={{ fontWeight: 500, color: 'var(--text)', marginBottom: 1 }}>{user.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)' }}>{user.email}</div>
                  </div>
                  {[
                    { label: 'Settings', action: () => { setShowUserMenu(false); router.push('/settings') } },
                    { label: 'Sign out',  action: () => { setShowUserMenu(false); signOut() } },
                  ].map(item => (
                    <button key={item.label} onClick={item.action}
                      style={{ width: '100%', padding: '8px 10px', background: 'none', border: 'none', fontSize: 12, color: 'var(--text2)', cursor: 'pointer', textAlign: 'left' as const, borderRadius: 'var(--radius-sm)', fontFamily: 'inherit' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg3)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                      {item.label}
                    </button>
                  ))}
                  <div style={{ padding: '7px 10px', borderTop: '1px solid var(--border)', marginTop: 4, fontSize: 10, color: 'var(--text4)' }}>
                    Mosaic v1.0.0 · ugx.ai
                  </div>
                </div>
              </>
            )}
          </div>
          <ThemeToggle />
        </div>
      </div>
      {/* Main content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {children}
      </div>
    </div>
  )
}
