'use client'
// Phase 7c: a dismissible, app-wide banner that appears when one or more database
// sources have no verified semantic model yet. Admin-only (only admins configure
// sources). Coverage comes from GET /api/semantic?view=coverage. Dismissal is remembered
// per unconfigured-set in localStorage, so it reappears when a NEW source needs config
// but stays quiet after the user has dismissed the current set.
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface SourceCoverage { source_id: string; label: string; needs_config: boolean }
const DISMISS_KEY = 'mosaic.semanticBanner.dismissed'

export default function SemanticCoverageBanner({ role }: { role?: string }) {
  const router = useRouter()
  const [sources, setSources] = useState<SourceCoverage[]>([])
  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    if (role !== 'admin') return
    let alive = true
    fetch('/api/semantic?view=coverage')
      .then(r => r.ok ? r.json() : { sources: [] })
      .then((d: { sources?: SourceCoverage[] }) => {
        if (!alive) return
        const need = (d.sources || []).filter(s => s.needs_config)
        setSources(need)
        try {
          const prev = localStorage.getItem(DISMISS_KEY)
          const sig = need.map(s => s.source_id).sort().join(',')
          setDismissed(prev === sig && sig !== '')   // show unless this exact set was dismissed
        } catch { setDismissed(false) }
      })
      .catch(() => {})
    return () => { alive = false }
  }, [role])

  if (role !== 'admin' || dismissed || sources.length === 0) return null

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, sources.map(s => s.source_id).sort().join(',')) } catch { /* ignore */ }
    setDismissed(true)
  }
  const n = sources.length
  const names = sources.slice(0, 3).map(s => s.label).join(', ') + (n > 3 ? `, +${n - 3} more` : '')

  return (
    <div style={bar}>
      <span style={{ fontSize: 14 }}>⚠</span>
      <span style={{ flex: 1, fontSize: 13 }}>
        <b>{n} data source{n === 1 ? '' : 's'}</b> need{n === 1 ? 's' : ''} a data dictionary ({names}).
        Dashboards on {n === 1 ? 'it' : 'them'} won’t get units, roll-ups or acceleration until configured.
      </span>
      <button onClick={() => router.push('/settings#data-sources')} style={cta}>Configure</button>
      <button onClick={dismiss} style={later} aria-label="Dismiss">Later</button>
    </div>
  )
}

const bar: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px', background: 'color-mix(in srgb, var(--warning,var(--amber-t)) 12%, var(--surface))', borderBottom: '1px solid color-mix(in srgb, var(--warning,var(--amber-t)) 35%, transparent)', color: 'var(--text)' }
const cta: React.CSSProperties = { padding: '5px 12px', borderRadius: 'var(--radius-sm)', border: 'none', background: 'var(--warning,var(--amber-t))', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }
const later: React.CSSProperties = { padding: '5px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border2)', background: 'transparent', color: 'var(--text3)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }
