'use client'
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import type { ChartSpec } from '@/lib/tools'

const COLORS = ['#378ADD', '#1D9E75', '#E24B4A', '#888780', '#7F77DD', '#EF9F27', '#D4537E', '#5DCAA5']
const AXIS_COLOR = 'var(--text3)'
const GRID_COLOR = 'var(--border)'

const CardWrap: React.FC<{ title: string; subtitle?: string; children: React.ReactNode }> = ({ title, subtitle, children }) => (
  <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 16, marginTop: 8, marginBottom: 8 }}>
    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>{title}</div>
    {subtitle && <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12 }}>{subtitle}</div>}
    {children}
  </div>
)

export default function ChartArtifactRecharts({ spec }: { spec: ChartSpec }) {
  if (spec.type === 'bar') {
    const data = (spec.data || []) as Array<{ label: string; value: number }>
    return (
      <CardWrap title={spec.title} subtitle={spec.subtitle}>
        <ResponsiveContainer width="100%" height={Math.max(220, data.length * 36 + 40)}>
          <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
            <CartesianGrid horizontal={false} stroke={GRID_COLOR} />
            <XAxis type="number" stroke={AXIS_COLOR} fontSize={11} />
            <YAxis type="category" dataKey="label" stroke={AXIS_COLOR} fontSize={11} width={100} />
            <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }} />
            <Bar dataKey="value" fill={COLORS[0]} radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardWrap>
    )
  }

  if (spec.type === 'line') {
    const data = (spec.data || []) as Array<{ x: string | number; y: number }>
    return (
      <CardWrap title={spec.title} subtitle={spec.subtitle}>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" />
            <XAxis dataKey="x" stroke={AXIS_COLOR} fontSize={11} />
            <YAxis stroke={AXIS_COLOR} fontSize={11} />
            <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }} />
            <Line type="monotone" dataKey="y" stroke={COLORS[0]} strokeWidth={2} dot={{ r: 3, fill: COLORS[0] }} />
          </LineChart>
        </ResponsiveContainer>
      </CardWrap>
    )
  }

  if (spec.type === 'pie') {
    const data = (spec.data || []) as Array<{ label: string; value: number }>
    const total = data.reduce((s, d) => s + (d.value || 0), 0)
    return (
      <CardWrap title={spec.title} subtitle={spec.subtitle}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 8, fontSize: 12, color: 'var(--text3)' }}>
          {data.map((d, i) => (
            <span key={d.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: COLORS[i % COLORS.length] }} />
              {d.label} {d.value} ({total ? ((d.value / total) * 100).toFixed(0) + '%' : ''})
            </span>
          ))}
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="label" innerRadius={50} outerRadius={90} paddingAngle={1}>
              {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Pie>
            <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }} />
          </PieChart>
        </ResponsiveContainer>
      </CardWrap>
    )
  }

  return null
}
