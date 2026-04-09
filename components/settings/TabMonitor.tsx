'use client'
import { useState, useEffect, useCallback } from 'react'
import { PageTitle, PageSub, Btn, StatusDot, Spinner } from './ui'

interface Svc { id: string; label: string; category: string; status: string; latencyMs: number | null; message?: string }
interface Data { services: Svc[]; summary: { healthy: number; degraded: number; down: number; total: number } }

const CAT: Record<string, string> = { infrastructure: 'Infrastructure', database: 'Databases', api: 'External APIs', api_service: 'API Services' }

export default function TabMonitor() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [last, setLast] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try { const r = await fetch('/api/monitor'); if (r.ok) { setData(await r.json()); setLast(new Date().toLocaleTimeString()) } }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const byCat = data ? data.services.reduce((a, s) => { if (!a[s.category]) a[s.category] = []; a[s.category].push(s); return a }, {} as Record<string, Svc[]>) : {}

  return (
    <div className="fade-in">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <PageTitle>Monitoring</PageTitle>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {loading && <Spinner />}
          {last && <span style={{ fontSize: 12, color: 'var(--text3)' }}>checked {last}</span>}
          <Btn size="sm" onClick={load}>↺ Refresh</Btn>
        </div>
      </div>
      <PageSub>Live health status of all connected services.</PageSub>

      {data && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 24 }}>
          {[
            { label: 'Healthy', value: data.summary.healthy, color: 'var(--green-t)' },
            { label: 'Degraded', value: data.summary.degraded, color: 'var(--amber-t)' },
            { label: 'Down', value: data.summary.down, color: 'var(--red-t)' },
            { label: 'Total', value: data.summary.total, color: 'var(--text)' },
          ].map(c => (
            <div key={c.label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', padding: '16px 18px' }}>
              <div style={{ fontSize: 28, fontWeight: 600, color: c.color, lineHeight: 1 }}>{c.value}</div>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>{c.label}</div>
            </div>
          ))}
        </div>
      )}

      {loading && !data ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spinner size={24} /></div>
      ) : (
        Object.entries(CAT).map(([cat, label]) => {
          const svcs = byCat[cat] || []; if (!svcs.length) return null
          return (
            <div key={cat} style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 8 }}>{label}</div>
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
                {svcs.map((s, i) => (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 18px', borderBottom: i < svcs.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <StatusDot status={s.status} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{s.label}</div>
                      {s.message && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>{s.message}</div>}
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 500, color: s.status === 'healthy' ? 'var(--green-t)' : s.status === 'degraded' ? 'var(--amber-t)' : 'var(--red-t)' }}>{s.status}</span>
                    <div style={{ textAlign: 'right', minWidth: 54 }}>
                      <div style={{ fontSize: 12, color: 'var(--text2)' }}>{s.latencyMs != null ? `${s.latencyMs}ms` : '—'}</div>
                    </div>
                    {/* Latency bar */}
                    <div style={{ width: 64, height: 4, background: 'var(--bg3)', borderRadius: 99, overflow: 'hidden', flexShrink: 0 }}>
                      {s.latencyMs != null && <div style={{ height: '100%', borderRadius: 99, width: `${Math.min(100, s.latencyMs / 10)}%`, background: s.latencyMs > 500 ? 'var(--red)' : s.latencyMs > 200 ? 'var(--amber)' : 'var(--green)', transition: 'width .3s' }} />}
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
