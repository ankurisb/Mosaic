'use client'
import { useState, useEffect, useCallback } from 'react'
import { SH, SS, Btn, StatusDot, Spinner } from './ui'

interface ServiceResult { id: string; label: string; category: string; status: string; latencyMs: number | null; message?: string }
interface MonitorData { services: ServiceResult[]; summary: { healthy: number; degraded: number; down: number; total: number } }

const CAT_LABELS: Record<string, string> = { infrastructure: 'Infrastructure', database: 'Databases', api: 'External APIs', api_service: 'API Services' }

export default function TabMonitor() {
  const [data, setData] = useState<MonitorData | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastChecked, setLastChecked] = useState<string>('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/monitor')
      if (res.ok) { setData(await res.json()); setLastChecked(new Date().toLocaleTimeString()) }
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const byCategory = data ? data.services.reduce((acc, s) => {
    if (!acc[s.category]) acc[s.category] = []
    acc[s.category].push(s)
    return acc
  }, {} as Record<string, ServiceResult[]>) : {}

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={SH}>Monitoring</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {loading && <Spinner />}
          {lastChecked && <span style={{ fontSize: 10, color: 'var(--text3)' }}>checked {lastChecked}</span>}
          <Btn onClick={load}>↺ refresh all</Btn>
        </div>
      </div>
      <div style={SS}>Live health status of all connected services.</div>

      {data && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 24 }}>
          {[
            { label: 'Healthy', value: data.summary.healthy, color: 'var(--gt)' },
            { label: 'Degraded', value: data.summary.degraded, color: 'var(--at)' },
            { label: 'Down', value: data.summary.down, color: 'var(--rt)' },
            { label: 'Total', value: data.summary.total, color: 'var(--text)' },
          ].map(c => (
            <div key={c.label} style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ fontSize: 22, fontWeight: 500, color: c.color }}>{c.value}</div>
              <div style={{ fontSize: 10, color: 'var(--text3)' }}>{c.label}</div>
            </div>
          ))}
        </div>
      )}

      {loading && !data ? (
        <div style={{ textAlign: 'center', padding: 40 }}><Spinner /></div>
      ) : (
        Object.entries(CAT_LABELS).map(([cat, catLabel]) => {
          const services = byCategory[cat] || []
          if (!services.length) return null
          return (
            <div key={cat} style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 8 }}>{catLabel}</div>
              <div style={{ border: '1px solid var(--border2)', borderRadius: 10, overflow: 'hidden' }}>
                {services.map((svc, i) => (
                  <div key={svc.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderBottom: i < services.length - 1 ? '1px solid var(--border)' : 'none', background: 'var(--bg2)' }}>
                    <StatusDot status={svc.status} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>{svc.label}</div>
                      {svc.message && <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 1 }}>{svc.message}</div>}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 11, color: svc.status === 'healthy' ? 'var(--gt)' : svc.status === 'degraded' ? 'var(--at)' : 'var(--rt)', fontWeight: 500 }}>{svc.status}</div>
                      <div style={{ fontSize: 10, color: 'var(--text3)' }}>{svc.latencyMs != null ? `${svc.latencyMs}ms` : '—'}</div>
                    </div>
                    {/* Latency bar */}
                    <div style={{ width: 60, height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden', flexShrink: 0 }}>
                      {svc.latencyMs != null && (
                        <div style={{ height: '100%', borderRadius: 2, width: `${Math.min(100, svc.latencyMs / 10)}%`, background: svc.latencyMs > 500 ? 'var(--red)' : svc.latencyMs > 200 ? 'var(--amber)' : 'var(--green)' }} />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}
