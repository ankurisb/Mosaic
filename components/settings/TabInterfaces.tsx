'use client'
import { useState, useEffect } from 'react'
import { PageTitle, PageSub, Btn, Alert, Spinner } from './ui'
import { SURFACES, type Surface } from '@/lib/surfaces'

// Launch metadata per surface. Access is decided server-side; this only
// describes how to present and open each interface the user is allowed.
const META: Record<Surface, { label: string; desc: string; href: string; external?: boolean }> = {
  n8n:      { label: 'Workflow Automation', desc: 'Build and run automation workflows (n8n).', href: '/api/authz/n8n-login' },
  superset: { label: 'Analytics',           desc: 'Explore and build dashboards (Superset).', href: '/api/authz/superset-login' },
  airbyte:  { label: 'Data Pipelines',      desc: 'Manage data source syncs (Airbyte).', href: '/settings#data-sources' },
  ciso:     { label: 'Compliance',          desc: 'Governance, risk & compliance (CISO Assistant).', href: process.env.NEXT_PUBLIC_CISO_URL || 'http://localhost:8443', external: true },
}

export default function TabInterfaces() {
  const [surfaces, setSurfaces] = useState<string[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/authz/surfaces')
      .then(r => r.ok ? r.json() : Promise.reject(new Error('Failed to load access')))
      .then(d => setSurfaces(Array.isArray(d.surfaces) ? d.surfaces : []))
      .catch(e => { setError(e.message); setSurfaces([]) })
  }, [])

  function open(href: string, external?: boolean) {
    if (external) window.open(href, '_blank', 'noopener')
    else window.location.href = href
  }

  const accessible = (surfaces || []).filter((s): s is Surface => (SURFACES as readonly string[]).includes(s))

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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14, marginTop: 8 }}>
          {SURFACES.filter(s => accessible.includes(s)).map(s => {
            const m = META[s]
            return (
              <div key={s} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)' }}>{m.label}</div>
                  <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4, lineHeight: 1.5 }}>{m.desc}</div>
                </div>
                <div style={{ marginTop: 'auto' }}>
                  <Btn variant="primary" onClick={() => open(m.href, m.external)}>Open{m.external ? ' ↗' : ''}</Btn>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
