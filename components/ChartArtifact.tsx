'use client'
import dynamic from 'next/dynamic'
import type { ChartSpec } from '@/lib/tools'

// Recharts (~120 kB) is only needed for bar/line/pie charts.
// Lazy-load it so it never lands in the initial chat-page bundle.
const ChartArtifactRecharts = dynamic(() => import('./ChartArtifactRecharts'), {
  ssr: false,
  loading: () => (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius)', padding: 16, marginTop: 8, marginBottom: 8,
      height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{ width: 20, height: 20, border: '2px solid var(--border2)', borderTop: '2px solid var(--blue)', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  ),
})

function formatNumber(v: unknown, format?: string): string {
  const n = typeof v === 'number' ? v : Number(v)
  if (Number.isNaN(n)) return String(v)
  if (format === 'currency') return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)
  if (format === 'percent') return (n * 100).toFixed(1) + '%'
  if (format === 'number') return new Intl.NumberFormat('en-US').format(n)
  return String(v)
}

const CardWrap: React.FC<{ title: string; subtitle?: string; children: React.ReactNode }> = ({ title, subtitle, children }) => (
  <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 16, marginTop: 8, marginBottom: 8 }}>
    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>{title}</div>
    {subtitle && <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12 }}>{subtitle}</div>}
    {children}
  </div>
)

export default function ChartArtifact({ spec }: { spec: ChartSpec }) {
  // kpi and table never need Recharts — render synchronously, zero extra weight
  if (spec.type === 'kpi') {
    const dirColor = spec.delta?.direction === 'up' ? 'var(--green-t)' : 'var(--red-t)'
    return (
      <CardWrap title={spec.title} subtitle={spec.subtitle}>
        <div style={{ fontSize: 32, fontWeight: 600, color: 'var(--text)', lineHeight: 1.1 }}>{spec.value}</div>
        {spec.label && <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>{spec.label}</div>}
        {spec.delta && (
          <div style={{ fontSize: 11, color: dirColor, marginTop: 4 }}>
            {spec.delta.direction === 'up' ? '↑' : '↓'} {Math.abs(spec.delta.value)}{typeof spec.delta.value === 'number' && spec.delta.value <= 1 ? '' : '%'} {spec.delta.label || ''}
          </div>
        )}
      </CardWrap>
    )
  }

  if (spec.type === 'table') {
    const cols = spec.columns || []
    const rows = spec.rows || []
    return (
      <CardWrap title={spec.title} subtitle={spec.subtitle}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                {cols.map(c => (
                  <th key={c.key} style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text3)', fontWeight: 500, borderBottom: '1px solid var(--border)' }}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  {cols.map(c => (
                    <td key={c.key} style={{ padding: '8px 12px', color: 'var(--text)', borderBottom: i < rows.length - 1 ? '1px solid var(--border)' : 'none' }}>
                      {formatNumber(r[c.key], c.format) || String(r[c.key] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardWrap>
    )
  }

  // bar/line/pie — lazy Recharts chunk (~120 kB), fetched only when a chart is rendered
  if (spec.type === 'bar' || spec.type === 'line' || spec.type === 'pie') {
    return <ChartArtifactRecharts spec={spec} />
  }

  return (
    <CardWrap title={spec.title} subtitle={`Unsupported chart type: ${spec.type}`}>
      <div style={{ fontSize: 12, color: 'var(--text3)' }}>This chart type is not implemented yet.</div>
    </CardWrap>
  )
}
