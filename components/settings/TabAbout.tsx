'use client'
import { useState, useEffect } from 'react'
import { PageTitle, PageSub, SectionLabel, Card, Badge } from './ui'

const DEPS = [
  { name: 'next',                    version: '15.3.9', ok: true },
  { name: '@anthropic-ai/sdk',       version: '0.39.0', ok: true },
  { name: '@neondatabase/serverless', version: '0.10.4', ok: true },
  { name: 'bcryptjs',                version: '2.4.3',  ok: true },
  { name: 'jose',                    version: '5.9.6',  ok: true },
  { name: 'react',                   version: '19.1.0', ok: true },
  { name: 'react-markdown',          version: '10.1.0', ok: true },
  { name: 'typescript',              version: '5.7.3',  ok: true },
]

interface ChangelogRelease {
  version: string
  date: string
  sections: Record<string, string[]>
}

interface DeploymentInfo {
  mode: string
  scheduler: string
  database: string
  appUrl: string
  nodeEnv: string
  changelog: ChangelogRelease[]
  currentVersion: string
  latestVersion: string | null
  latestReleaseUrl: string | null
  updateAvailable: boolean
  buildDate: string
}

export default function TabAbout() {
  const [deploy, setDeploy] = useState<DeploymentInfo | null>(null)
  const [expandedVersions, setExpandedVersions] = useState<Set<string>>(new Set())
  const toggleVersion = (v: string) => setExpandedVersions(prev => { const n = new Set(prev); n.has(v) ? n.delete(v) : n.add(v); return n })

  useEffect(() => {
    fetch('/api/deployment').then(r => r.json()).then(setDeploy).catch(() => {})
  }, [])

  const isVercel = deploy?.mode === 'vercel'

  return (
    <div className="fade-in">
      <PageTitle>About</PageTitle>
      <PageSub>Version information, system details, and changelog.</PageSub>

      {/* Version card */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', padding: 28, marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 6 }}>
          <span style={{ fontFamily: 'var(--font-serif)', fontSize: 28, color: 'var(--text)' }}>Mosaic</span>
          <span style={{ fontSize: 14, color: 'var(--text2)', background: 'var(--bg3)', padding: '3px 10px', borderRadius: 'var(--radius-pill)', border: '1px solid var(--border)', fontWeight: 500 }}>v{deploy?.currentVersion || '...'}</span>
          <Badge label="stable" color="green" />
        </div>
        <p style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 24 }}>Build {deploy?.buildDate || '...'} · v{deploy?.currentVersion || '...'} · ugx.ai</p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {[
            { label: 'Platform',       value: deploy ? (isVercel ? 'Vercel (serverless)' : 'Self-hosted (Node.js)') : '—', sub: deploy ? (isVercel ? 'Serverless functions' : deploy.appUrl) : 'Loading...' },
            { label: 'AI model',       value: 'claude-sonnet-4-6', sub: 'Anthropic · streaming' },
            { label: 'Database',       value: deploy?.database || '—', sub: deploy ? (deploy.database.includes('SQLite') ? 'Local file · zero-config' : 'Cloud · auto-scaling') : 'Loading...' },
            { label: 'Authentication', value: 'JWT + bcrypt', sub: '7-day sessions' },
            { label: 'Scheduler',      value: deploy ? (deploy.scheduler + ' · every 60s') : '—', sub: deploy ? (isVercel ? 'vercel.json crons' : 'Built-in Node timer') : 'Loading...' },
            { label: 'Environment',    value: deploy?.nodeEnv || '—', sub: deploy ? (deploy.nodeEnv === 'production' ? 'Production build' : 'Development mode') : 'Loading...' },
          ].map(item => (
            <div key={item.label} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '12px 16px' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase' as const, letterSpacing: '.06em', marginBottom: 5 }}>{item.label}</div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 2 }}>{item.value}</div>
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>{item.sub}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Update available banner */}
      {deploy?.updateAvailable && (
        <div style={{ background: 'var(--amber-bg, #fffbeb)', border: '1px solid rgba(245,158,11,.3)', borderRadius: 'var(--radius)', padding: '12px 16px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" style={{ color: 'var(--amber-t, #d97706)', flexShrink: 0 }}><circle cx="8" cy="8" r="7"/><path d="M8 5v3M8 11h.01"/></svg>
          <span style={{ color: 'var(--amber-t, #d97706)', fontWeight: 500, flex: 1 }}>
            Version {deploy.latestVersion} available — you are on {deploy.currentVersion}
          </span>
          {deploy.latestReleaseUrl && (
            <a href={deploy.latestReleaseUrl} target="_blank" rel="noreferrer"
              style={{ fontSize: 12, color: 'var(--amber-t, #d97706)', textDecoration: 'none', border: '1px solid rgba(245,158,11,.4)', borderRadius: 'var(--radius-pill)', padding: '3px 10px', whiteSpace: 'nowrap' }}>
              See what's new →
            </a>
          )}
          <a href="https://github.com/ankurisb/Mosaic/blob/main/docs/UPDATING.md" target="_blank" rel="noreferrer"
            style={{ fontSize: 12, color: 'var(--amber-t, #d97706)', textDecoration: 'none', border: '1px solid rgba(245,158,11,.4)', borderRadius: 'var(--radius-pill)', padding: '3px 10px', whiteSpace: 'nowrap' }}>
            How to update →
          </a>
        </div>
      )}

      {/* Deployment mode banner */}
      {deploy && (
        <div style={{ background: isVercel ? 'var(--blue-bg)' : 'var(--green-bg)', border: `1px solid ${isVercel ? 'rgba(0,112,243,.2)' : 'rgba(22,163,74,.2)'}`, borderRadius: 'var(--radius)', padding: '12px 16px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" style={{ color: isVercel ? 'var(--blue-t)' : 'var(--green-t)', flexShrink: 0 }}>
            {isVercel
              ? <><path d="M8 1l7 14H1L8 1z"/></>
              : <><rect x="2" y="3" width="12" height="10" rx="2"/><path d="M5 7h6M5 10h4"/></>
            }
          </svg>
          <span style={{ color: isVercel ? 'var(--blue-t)' : 'var(--green-t)', fontWeight: 500 }}>
            {isVercel ? 'Vercel Cloud deployment' : 'Self-hosted deployment'} · Scheduler running every minute
          </span>
        </div>
      )}

      <SectionLabel>Dependencies</SectionLabel>
      <Card>
        <div style={{ padding: '0 18px' }}>
          {DEPS.map((d, i) => (
            <div key={d.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: i < DEPS.length - 1 ? '1px solid var(--border)' : 'none' }}>
              <span style={{ fontSize: 13, color: 'var(--text2)', fontFamily: 'var(--font-mono)' }}>{d.name}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 12, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>{d.version}</span>
                {d.ok ? <span style={{ fontSize: 12, color: 'var(--green-t)', fontWeight: 500 }}>✓ up to date</span> : <span style={{ fontSize: 12, color: 'var(--amber-t)', fontWeight: 500 }}>↑ update available</span>}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <SectionLabel>Changelog</SectionLabel>
      {(deploy?.changelog || []).map((release, ri) => {
        const isExpanded = expandedVersions.has(release.version)
        const totalItems = Object.values(release.sections).reduce((acc, items) => acc + items.length, 0)
        return (
          <Card key={release.version} style={{ marginBottom: 8 }}>
            <button onClick={() => toggleVersion(release.version)}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
                style={{ flexShrink: 0, color: 'var(--text3)', transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>
                <path d="M4 2l4 4-4 4"/>
              </svg>
              <span style={{ fontFamily: 'var(--font-serif)', fontSize: 15, color: 'var(--text)' }}>v{release.version}</span>
              <span style={{ fontSize: 12, color: 'var(--text3)' }}>{release.date}</span>
              {ri === 0 && <Badge label="latest" color="blue" />}
              {release.version === '1.0.0' && <Badge label="initial release" color="green" />}
              {!isExpanded && (
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text4)' }}>
                  {totalItems} {totalItems === 1 ? 'change' : 'changes'}
                </span>
              )}
            </button>
            {isExpanded && (
              <div style={{ padding: '0 18px 16px' }}>
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
                  {Object.entries(release.sections).map(([section, items]) => (
                    <div key={section} style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase' as const, letterSpacing: '.06em', marginBottom: 6 }}>{section}</div>
                      {(items as string[]).map((item, i) => (
                        <div key={i} style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.9, display: 'flex', gap: 8 }}>
                          <span style={{ color: 'var(--text4)', flexShrink: 0 }}>·</span>{item}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>
        )
      })}

      <div style={{ fontSize: 12, color: 'var(--text4)', textAlign: 'center' as const, paddingTop: 8 }}>
        Mosaic v{deploy?.currentVersion || '1.0.0'} · build {deploy?.buildDate || '...'} · ugx.ai · powered by UGX Systems
      </div>

      {/* Documentation links */}
      <div style={{ marginTop: 20, padding: '14px 16px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontSize: 12 }}>
        <div style={{ fontWeight: 600, color: 'var(--text2)', marginBottom: 8 }}>Documentation</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {[
            { label: 'Install guide',    href: 'https://github.com/ankurisb/Mosaic/blob/main/docs/INSTALL.md' },
            { label: 'First steps',      href: 'https://github.com/ankurisb/Mosaic/blob/main/docs/FIRST_STEPS.md' },
            { label: 'Updating',         href: 'https://github.com/ankurisb/Mosaic/blob/main/docs/UPDATING.md' },
            { label: 'Secrets & credentials', href: 'https://github.com/ankurisb/Mosaic/blob/main/docs/SECRETS.md' },
            { label: 'Network requirements',  href: 'https://github.com/ankurisb/Mosaic/blob/main/docs/NETWORK.md' },
            { label: 'SSO / Keycloak',   href: 'https://github.com/ankurisb/Mosaic/blob/main/docs/KEYCLOAK.md' },
          ].map(link => (
            <a key={link.label} href={link.href} target="_blank" rel="noreferrer"
              style={{ color: 'var(--text3)', textDecoration: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-pill)', padding: '2px 8px' }}>
              {link.label} ↗
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}
