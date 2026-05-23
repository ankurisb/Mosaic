'use client'
import { useState, useEffect } from 'react'
import type { SessionUser } from '@/lib/auth'
import { PageTitle, PageSub, Btn, Spinner } from './ui'

interface DatasetRow {
  dataset: string
  label: string
  description: string
  connectorTierRelevant: boolean
  isoMinDays?: number
  warning?: string
  // from DB
  enabled: number
  retention_days: number
  last_purge_at: string | null
  last_purge_count: number
  row_count: number
}

const TIER_LABELS: Record<string, string> = {
  conversations:    'AI Chat',
  messages:         'AI Chat',
  usage_events:     'All tiers',
  egress_events:    'All tiers',
  rca_sessions:     'AI Chat',
  query_history:    'AI Chat',
  integration_runs: 'All tiers',
}

const TIER_COLORS: Record<string, string> = {
  'All tiers': 'var(--blue-t)',
  'AI Chat':   'var(--purple-t)',
}

export default function TabDataRetention({ user }: { user: SessionUser }) {
  const [datasets,       setDatasets]       = useState<DatasetRow[]>([])
  const [loading,        setLoading]        = useState(true)
  const [saving,         setSaving]         = useState<string | null>(null)
  const [purging,        setPurging]        = useState<string | null>(null)
  const [toast,          setToast]          = useState('')
  const [connectorTier,  setConnectorTier]  = useState(false)

  async function load() {
    setLoading(true)
    try {
      const r = await fetch('/api/data-retention')
      if (r.ok) {
        const d = await r.json()
        setDatasets(d.datasets || [])
      }
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])
  useEffect(() => {
    if (toast) { const t = setTimeout(() => setToast(''), 3000); return () => clearTimeout(t) }
  }, [toast])

  async function save(dataset: string, patch: { enabled?: boolean; retention_days?: number }) {
    setSaving(dataset)
    try {
      const r = await fetch('/api/data-retention', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataset, ...patch }),
      })
      if (r.ok) {
        setDatasets(prev => prev.map(d =>
          d.dataset === dataset
            ? { ...d, ...patch, enabled: patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : d.enabled }
            : d
        ))
        setToast('Saved')
      }
    } finally { setSaving(null) }
  }

  async function purgeNow(dataset?: string) {
    const key = dataset || '__all__'
    setPurging(key)
    try {
      const r = await fetch('/api/data-retention', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataset }),
      })
      const d = await r.json()
      if (d.ok) {
        setToast(`Purged ${d.total_purged.toLocaleString()} rows`)
        await load()
      }
    } finally { setPurging(null) }
  }

  function fmtDate(iso: string | null) {
    if (!iso) return 'Never'
    try { return new Date(iso).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) }
    catch { return iso }
  }

  const visibleDatasets = connectorTier
    ? datasets.filter(d => d.connectorTierRelevant)
    : datasets

  if (user.role !== 'admin') return (
    <div className="fade-in"><PageTitle>Data retention</PageTitle>
      <div style={{ padding: 20, color: 'var(--text3)', fontSize: 13 }}>Admin only.</div>
    </div>
  )

  return (
    <div className="fade-in">
      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 2000, padding: '10px 18px', background: 'var(--green-bg)', border: '1px solid rgba(22,163,74,.2)', borderRadius: 'var(--radius)', fontSize: 13, color: 'var(--green-t)', fontWeight: 500, boxShadow: 'var(--shadow-lg)' }}>
          {toast}
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 }}>
        <div>
          <PageTitle>Data retention</PageTitle>
          <PageSub>Configure how long each type of data is kept before automatic nightly purge.</PageSub>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
          <Btn size="sm" onClick={() => purgeNow()} disabled={purging === '__all__'}>
            {purging === '__all__' ? <Spinner size={12} /> : 'Run all purges now'}
          </Btn>
        </div>
      </div>

      {/* Deployment tier toggle */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '14px 18px', marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 3 }}>
            Connector-only deployment
          </div>
          <div style={{ fontSize: 12, color: 'var(--text3)' }}>
            Enable if this Mosaic instance is used as a data connector tier only — hides datasets not generated in connector-only mode (conversations, messages, RCA, query history).
          </div>
        </div>
        <div
          onClick={() => setConnectorTier(v => !v)}
          style={{ width: 40, height: 22, borderRadius: 11, background: connectorTier ? 'var(--blue)' : 'var(--bg3)', border: '1px solid var(--border2)', cursor: 'pointer', position: 'relative', flexShrink: 0, marginLeft: 16, transition: 'background .2s' }}
        >
          <div style={{ width: 16, height: 16, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2, left: connectorTier ? 20 : 2, transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)' }} />
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 60, display: 'flex', justifyContent: 'center' }}><Spinner size={20} /></div>
      ) : (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
          {/* Table header */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 110px 100px 80px 120px', gap: 0, padding: '9px 18px', borderBottom: '1px solid var(--border)', background: 'var(--bg2)' }}>
            {['Dataset', 'Tier', 'Retention', 'Row count', 'Enabled', 'Last purge'].map(h => (
              <div key={h} style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{h}</div>
            ))}
          </div>

          {visibleDatasets.map((d, i) => {
            const isLast = i === visibleDatasets.length - 1
            const tierLabel = TIER_LABELS[d.dataset] || 'All tiers'
            const isoWarn = d.isoMinDays && d.enabled && d.retention_days > 0 && d.retention_days < d.isoMinDays
            return (
              <div key={d.dataset} style={{ borderBottom: isLast ? 'none' : '1px solid var(--border)' }}>
                {/* Main row */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 110px 100px 80px 120px', gap: 0, padding: '13px 18px', alignItems: 'center' }}>
                  {/* Dataset info */}
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 2 }}>{d.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)' }}>{d.description}</div>
                  </div>

                  {/* Tier badge */}
                  <div>
                    <span style={{ fontSize: 10, fontWeight: 600, color: TIER_COLORS[tierLabel] || 'var(--text3)', background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 3, padding: '2px 6px' }}>
                      {tierLabel}
                    </span>
                  </div>

                  {/* Retention days input */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input
                      type="number"
                      min={0}
                      max={3650}
                      value={d.retention_days}
                      onChange={e => {
                        const v = Number(e.target.value)
                        setDatasets(prev => prev.map(row => row.dataset === d.dataset ? { ...row, retention_days: v } : row))
                      }}
                      onBlur={e => save(d.dataset, { retention_days: Number(e.target.value) })}
                      disabled={!d.enabled || saving === d.dataset}
                      style={{ width: 56, padding: '4px 6px', fontSize: 12, background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontFamily: 'inherit', opacity: d.enabled ? 1 : .4 }}
                    />
                    <span style={{ fontSize: 11, color: 'var(--text4)' }}>days</span>
                    {saving === d.dataset && <Spinner size={10} />}
                  </div>

                  {/* Row count */}
                  <div style={{ fontSize: 12, color: 'var(--text2)' }}>
                    {d.row_count.toLocaleString()} rows
                  </div>

                  {/* Enabled toggle */}
                  <div>
                    <div
                      onClick={() => save(d.dataset, { enabled: !d.enabled })}
                      style={{ width: 36, height: 20, borderRadius: 10, background: d.enabled ? 'var(--blue)' : 'var(--bg3)', border: '1px solid var(--border2)', cursor: 'pointer', position: 'relative', transition: 'background .2s' }}
                    >
                      <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2, left: d.enabled ? 18 : 2, transition: 'left .2s', boxShadow: '0 1px 2px rgba(0,0,0,.2)' }} />
                    </div>
                  </div>

                  {/* Last purge + run now */}
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 3 }}>
                      {fmtDate(d.last_purge_at)}
                    </div>
                    {d.last_purge_count > 0 && (
                      <div style={{ fontSize: 10, color: 'var(--text4)' }}>{d.last_purge_count.toLocaleString()} removed</div>
                    )}
                    <button
                      onClick={() => purgeNow(d.dataset)}
                      disabled={!d.enabled || purging === d.dataset}
                      style={{ fontSize: 10, color: 'var(--text3)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', marginTop: 2, opacity: d.enabled ? 1 : .4 }}
                    >
                      {purging === d.dataset ? '…' : 'Run now'}
                    </button>
                  </div>
                </div>

                {/* ISO warning */}
                {isoWarn && (
                  <div style={{ padding: '6px 18px 10px', marginTop: -8 }}>
                    <div style={{ fontSize: 11, color: 'var(--amber-t)', background: 'rgba(245,158,11,.07)', border: '1px solid rgba(245,158,11,.2)', borderRadius: 'var(--radius-sm)', padding: '5px 10px', display: 'inline-block' }}>
                      ⚠ {d.warning}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Help section */}
      <div style={{ marginTop: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '14px 16px' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>How retention works</div>
          <div style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.6 }}>
            The nightly scheduler automatically purges rows older than the configured retention period.
            Set <strong>0 days</strong> to keep data forever. Purges are immediate and irreversible — export data before reducing retention periods.
          </div>
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '14px 16px' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>ISO 27001 & compliance</div>
          <div style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.6 }}>
            Usage events and egress logs have a minimum recommended retention of <strong>365 days</strong> per ISO 27001 A.8.15. 
            The audit log (Settings → Audit trail) has a separate retention policy governed by ISO 27001 requirements.
          </div>
        </div>
      </div>
    </div>
  )
}
