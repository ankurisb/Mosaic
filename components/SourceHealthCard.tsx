'use client'
import React from 'react'

// Shared structured view for a data-source health check (the check_data_sources
// tool result). Rendered inline in chat and in Settings → Data sources, so the
// status is scannable — color-coded, grouped into Working / Needs attention —
// instead of a wall of prose.

export type SourceStatus = 'ok' | 'auth_failed' | 'degraded' | 'down' | 'unknown'
export interface SourceHealth { id: string; label: string; type: 'database' | 'api' | 'prism' | 'mcp' | 'file_server'; status: SourceStatus; latencyMs?: number; detail?: string }
export interface HealthData { sources: SourceHealth[]; summary: { total: number; ok: number; issues: number } }

const TYPE_LABEL: Record<SourceHealth['type'], string> = { database: 'Database', api: 'API', prism: 'Prism', mcp: 'MCP', file_server: 'Files' }
const STATUS_LABEL: Record<SourceStatus, string> = { ok: 'OK', auth_failed: 'Auth failed', degraded: 'Degraded', down: 'Down', unknown: 'Unknown' }
// dot color / badge bg+fg per status
function statusColors(s: SourceStatus): { dot: string; bg: string; fg: string } {
  switch (s) {
    case 'ok': return { dot: 'var(--green-t,var(--green-t))', bg: 'var(--green-bg,var(--green-bg))', fg: 'var(--green-t,var(--green-t))' }
    case 'auth_failed':
    case 'degraded': return { dot: 'var(--amber-t,var(--amber-t))', bg: 'var(--amber-bg,var(--amber-bg))', fg: 'var(--amber-t,var(--amber-t))' }
    case 'down': return { dot: 'var(--red-t,var(--red-t))', bg: 'var(--red-bg,var(--red-bg))', fg: 'var(--red-t,var(--red-t))' }
    default: return { dot: 'var(--text3)', bg: 'var(--bg3)', fg: 'var(--text3)' }
  }
}
const fmtMs = (ms?: number) => typeof ms === 'number' ? (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`) : ''

function Row({ s }: { s: SourceHealth }) {
  const c = statusColors(s.status)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 0' }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: c.dot, flexShrink: 0, marginTop: 5 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{s.label}</span>
          <span style={{ fontSize: 10, color: 'var(--text3)', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 999, padding: '1px 7px' }}>{TYPE_LABEL[s.type]}</span>
        </div>
        {s.detail && <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2, lineHeight: 1.45, overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.detail}</div>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        {s.latencyMs != null && s.status !== 'down' && <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>{fmtMs(s.latencyMs)}</span>}
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.03em', textTransform: 'uppercase', padding: '2px 8px', borderRadius: 999, background: c.bg, color: c.fg, whiteSpace: 'nowrap' }}>{STATUS_LABEL[s.status]}</span>
      </div>
    </div>
  )
}

export default function SourceHealthCard({ data }: { data: HealthData }) {
  const sources = Array.isArray(data?.sources) ? data.sources : []
  const working = sources.filter(s => s.status === 'ok')
  const attention = sources.filter(s => s.status !== 'ok')
  const total = data?.summary?.total ?? sources.length
  const ok = data?.summary?.ok ?? working.length
  const allOk = attention.length === 0

  const Group = ({ title, items }: { title: string; items: SourceHealth[] }) => items.length === 0 ? null : (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text3)', margin: '0 0 2px' }}>{title}</div>
      <div>{items.map(s => <Row key={s.id + s.label} s={s} />)}</div>
    </div>
  )

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)', padding: '14px 16px', margin: '6px 0 12px', maxWidth: 640 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Data source health</div>
        <span style={{ fontSize: 11, fontWeight: 600, color: allOk ? 'var(--green-t,var(--green-t))' : 'var(--text2)', background: allOk ? 'var(--green-bg,var(--green-bg))' : 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 999, padding: '1px 9px' }}>
          {ok}/{total} reachable
        </span>
      </div>
      {/* Needs attention first — it's the actionable part */}
      <Group title="Needs attention" items={attention} />
      <Group title="Working" items={working} />
      {sources.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--text3)', marginTop: 8 }}>No data sources configured.</div>}
    </div>
  )
}
