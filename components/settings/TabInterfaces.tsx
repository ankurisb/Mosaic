import { useState, useEffect } from 'react'
import { PageTitle, PageSub, Alert, Spinner } from './ui'
import { SURFACES, type Surface } from '@/lib/surfaces'

// Launch metadata per surface. Access is decided server-side; this only
// describes how to present and open each interface the user is allowed.
// `external` opens in a new tab; otherwise we navigate in-place (the no-login
// handshake endpoints redirect the current window).
const META: Record<Surface, { label: string; desc: string; href: string; external?: boolean }> = {
  n8n:      { label: 'Workflow Automation', desc: 'Build and run automation workflows (n8n).',        href: '/api/authz/n8n-login' },
  superset: { label: 'Analytics',           desc: 'Explore and build dashboards (Superset).',         href: '/api/authz/superset-login' },
  airbyte:  { label: 'Data Pipelines',      desc: 'Manage data source syncs (Airbyte).',              href: '/settings#data-sources' },
  ciso:     { label: 'Compliance',          desc: 'Governance, risk & compliance (CISO Assistant).',  href: process.env.NEXT_PUBLIC_CISO_URL || '', external: true },
}

// Map a health status to a dot colour + human label.
type Health = 'ok' | 'degraded' | 'error' | 'unconfigured' | 'unknown'
const DOT: Record<Health, { color: string; title: string }> = {
  ok:           { color: '#16a34a', title: 'Reachable' },
  degraded:     { color: '#d97706', title: 'Degraded' },
  error:        { color: '#dc2626', title: 'Unreachable' },
  unconfigured: { color: 'var(--border2)', title: 'Not configured' },
  unknown:      { color: 'var(--border2)', title: 'Status unknown' },
}

export default function TabInterfaces() {
  const [surfaces, setSurfaces] = useState<string[] | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [health, setHealth] = useState<Record<string, Health>>({})
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/authz/surfaces')
      .then(r => r.ok ? r.json() : Promise.reject(new Error('Failed to load access')))
      .then(d => { setSurfaces(Array.isArray(d.surfaces) ? d.surfaces : []); setIsAdmin(!!d.isAdmin) })
      .catch(e => { setError(e.message); setSurfaces([]) })
  }, [])

  // Health is best-effort — the dot silently stays "unknown" if this fails, so
  // a health hiccup never blocks launching a tool.
  useEffect(() => {
    fetch('/api/health')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => {
        const svc = d.services || {}
        const next: Record<string, Health> = {}
        for (const s of SURFACES) next[s] = (svc[s]?.status as Health) || 'unknown'
        setHealth(next)
      })
      .catch(() => {/* leave as unknown */})
  }, [])

  // Break-glass link to the raw Airbyte portal. Admin-only. Fallback for when
  // the in-Mosaic wrapper can't do something; deliberately NOT customer-facing
  // (exposing Airbyte's own UI carries ELv2 considerations).
  const airbytePortalUrl = process.env.NEXT_PUBLIC_AIRBYTE_PORTAL_URL || 'http://localhost:8000'

  function open(href: string, external?: boolean) {
    if (external) window.open(href, '_blank', 'noopener')
    else window.location.href = href
  }

  // Surfaces the user is allowed to see. CISO is an optional bring-your-own
  // integration (not bundled) — only show its row when a browser-facing CISO URL
  // is actually configured (NEXT_PUBLIC_CISO_URL). Without one there's no valid
  // portal to open, so we hide the row rather than present a dead link. (Backend
  // reachability alone isn't enough: a leftover bundled container may be up with
  // no public URL to send the browser to.)
  const cisoConfigured = !!(META.ciso.href && /^https?:\/\//.test(META.ciso.href))
  const accessible = SURFACES.filter(s => (surfaces || []).includes(s))
    .filter(s => !(s === 'ciso' && !cisoConfigured))

  return (
    <div className="fade-in">
      <PageTitle>Connected tools</PageTitle>
      <PageSub>Interfaces you can access. Each opens without a separate login.</PageSub>

      {error && <Alert variant="error">{error}</Alert>}

      {surfaces === null ? (
        <div style={{ padding: 28, textAlign: 'center' }}><Spinner size={18} /></div>
      ) : accessible.length === 0 ? (
        <Alert variant="info">You don&apos;t currently have access to any connected tools. An admin can grant access under Users.</Alert>
      ) : (
        <div style={{
          marginTop: 12,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          boxShadow: 'var(--shadow)',
          overflow: 'hidden',
        }}>
          {accessible.map((s, i) => {
            const m = META[s]
            const st = health[s] || 'unknown'
            const dot = DOT[st]
            const showPortal = s === 'airbyte' && isAdmin
            return (
              <div
                key={s}
                onClick={() => open(m.href, m.external)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  padding: '14px 18px',
                  borderTop: i > 0 ? '1px solid var(--border)' : 'none',
                  cursor: 'pointer',
                  transition: 'background .12s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                {/* status dot */}
                <span
                  title={dot.title}
                  style={{ width: 9, height: 9, borderRadius: '50%', background: dot.color, flexShrink: 0, boxShadow: st === 'ok' ? `0 0 0 3px color-mix(in srgb, ${dot.color} 18%, transparent)` : 'none' }}
                />

                {/* label + description */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>{m.label}</div>
                  <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.desc}</div>
                </div>

                {/* admin-only Airbyte portal link — stops row navigation */}
                {showPortal && (
                  <a
                    href={airbytePortalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    title="Open the raw Airbyte portal (admin fallback)"
                    style={{ fontSize: 12, color: 'var(--text3)', textDecoration: 'none', whiteSpace: 'nowrap', padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)' }}
                  >
                    Portal ↗
                  </a>
                )}

                {/* open affordance */}
                <span style={{ fontSize: 13, color: 'var(--text3)', whiteSpace: 'nowrap' }}>
                  Open{m.external ? ' ↗' : ' →'}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
