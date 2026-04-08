'use client'
import { useState, useEffect } from 'react'
import type { SessionUser } from '@/lib/auth'
import { PageTitle, PageSub, Spinner } from './ui'

interface UsageData {
  totals: { input_tokens: string; output_tokens: string; cost_usd: string; calls: string }
  byUser: { user_email: string; input_tokens: string; output_tokens: string; cost_usd: string; calls: string }[]
  daily: { date: string; input_tokens: string; output_tokens: string }[]
}

export default function TabUsage({ user }: { user: SessionUser }) {
  const [data, setData] = useState<UsageData | null>(null)
  const [period, setPeriod] = useState('7d')
  const [loading, setLoading] = useState(true)

  async function load(p: string) { setLoading(true); const r = await fetch(`/api/usage?period=${p}`); if (r.ok) setData(await r.json()); setLoading(false) }
  useEffect(() => { load(period) }, [period])

  const fmt = (n: string | number) => Number(n).toLocaleString()
  const fmtCost = (n: string | number) => `$${Number(n).toFixed(4)}`
  const maxVal = data ? Math.max(...data.daily.map(d => Number(d.input_tokens) + Number(d.output_tokens)), 1) : 1

  return (
    <div className="fade-in">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <PageTitle>Usage analytics</PageTitle>
        <div style={{ display: 'flex', gap: 4, background: 'var(--bg3)', padding: 3, borderRadius: 'var(--radius-pill)', border: '1px solid var(--border)' }}>
          {['24h', '7d', '30d'].map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              style={{ padding: '5px 14px', borderRadius: 'var(--radius-pill)', border: 'none', background: period === p ? 'var(--surface)' : 'transparent', color: period === p ? 'var(--text)' : 'var(--text3)', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', boxShadow: period === p ? 'var(--shadow)' : 'none', transition: 'all .15s' }}>
              {p}
            </button>
          ))}
        </div>
      </div>
      <PageSub>Token usage and estimated costs.</PageSub>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spinner size={24} /></div>
      ) : data ? (
        <>
          {/* Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 24 }}>
            {[
              { label: 'Total tokens', value: fmt(Number(data.totals.input_tokens) + Number(data.totals.output_tokens)), color: 'var(--blue-t)' },
              { label: 'Estimated cost', value: fmtCost(data.totals.cost_usd), color: 'var(--green-t)' },
              { label: 'API calls', value: fmt(data.totals.calls), color: 'var(--purple-t)' },
              { label: 'Output tokens', value: fmt(data.totals.output_tokens), color: 'var(--amber-t)' },
            ].map(c => (
              <div key={c.label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', padding: '18px 20px' }}>
                <div style={{ fontSize: 24, fontWeight: 600, color: c.color, marginBottom: 4 }}>{c.value}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>{c.label}</div>
              </div>
            ))}
          </div>

          {/* Chart */}
          {data.daily.length > 0 && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', padding: 20, marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>Daily token usage</div>
                <div style={{ display: 'flex', gap: 14, fontSize: 11, color: 'var(--text3)' }}>
                  <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'var(--blue)', marginRight: 5 }} />Input</span>
                  <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'var(--purple)', marginRight: 5 }} />Output</span>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 72 }}>
                {data.daily.map((d, i) => {
                  const total = Number(d.input_tokens) + Number(d.output_tokens)
                  const ih = Math.max(3, (Number(d.input_tokens) / maxVal) * 64)
                  const oh = Math.max(2, (Number(d.output_tokens) / maxVal) * 64 * .4)
                  return (
                    <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }} title={`${fmt(total)} tokens`}>
                      <div style={{ width: '100%', height: ih, background: 'var(--blue)', opacity: .7, borderRadius: '3px 3px 0 0' }} />
                      <div style={{ width: '100%', height: oh, background: 'var(--purple)', opacity: .8, borderRadius: '3px 3px 0 0' }} />
                      <div style={{ fontSize: 9, color: 'var(--text4)', marginTop: 3 }}>
                        {new Date(d.date).toLocaleDateString('en', { weekday: 'narrow' })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Per-user table */}
          {user.role === 'admin' && data.byUser.length > 0 && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
              <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>Usage by user</div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['User', 'Calls', 'Input tokens', 'Output tokens', 'Cost'].map(h => (
                      <th key={h} style={{ padding: '9px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.byUser.map((u, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '10px 16px', fontSize: 13, color: 'var(--text)' }}>{u.user_email}</td>
                      <td style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text2)' }}>{fmt(u.calls)}</td>
                      <td style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text2)' }}>{fmt(u.input_tokens)}</td>
                      <td style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text2)' }}>{fmt(u.output_tokens)}</td>
                      <td style={{ padding: '10px 16px', fontSize: 12, color: 'var(--green-t)', fontWeight: 500 }}>{fmtCost(u.cost_usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!data.daily.length && !data.byUser.length && (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text3)', fontSize: 14 }}>
              No usage data yet. Start chatting to see analytics here.
            </div>
          )}
        </>
      ) : null}
    </div>
  )
}
