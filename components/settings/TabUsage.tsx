'use client'
import { useState, useEffect } from 'react'
import type { SessionUser } from '@/lib/auth'
import { PageTitle, PageSub, Spinner } from './ui'

interface UsageData {
  totals: {
    input_tokens: string; output_tokens: string; cost_usd: string; calls: string
    avg_latency_ms: string; tool_calls_total: string
    cache_read_tokens?: string; cache_write_tokens?: string
  }
  byUser: {
    user_email: string; input_tokens: string; output_tokens: string
    cost_usd: string; calls: string; avg_latency_ms: string
    cache_read_tokens?: string; cache_write_tokens?: string
  }[]
  daily: {
    date: string; input_tokens: string; output_tokens: string
    cost_usd: string; avg_latency_ms: string
  }[]
  toolBreakdown: { tool: string; count: number }[]
  sourceBreakdown: { source: string; count: number }[]
}

const TOOL_LABELS: Record<string, string> = {
  query_database: 'Database', query_prism: 'Prism IoT', call_api: 'REST API',
  read_file_server: 'File Server', web_search: 'Web Search',
  run_statistical_analysis: 'Stats Engine',
}
const TOOL_COLORS = [
  'var(--blue)', 'var(--purple)', 'var(--green)', 'var(--amber)',
  'var(--red)', '#06b6d4',
]

export default function TabUsage({ user }: { user: SessionUser }) {
  const [data, setData] = useState<UsageData | null>(null)
  const [period, setPeriod] = useState('7d')
  const [loading, setLoading] = useState(true)
  const [userPage, setUserPage] = useState(1)
  const USERS_PER_PAGE = 10

  async function load(p: string) {
    setLoading(true)
    setUserPage(1)
    const r = await fetch(`/api/usage?period=${p}`)
    if (r.ok) setData(await r.json())
    setLoading(false)
  }
  useEffect(() => { load(period) }, [period])

  function exportCsv() {
    // Hits the same endpoint with format=csv; the browser downloads the file.
    window.open(`/api/usage?period=${period}&format=csv`, '_blank')
  }

  const fmt = (n: string | number) => Number(n).toLocaleString()
  const fmtCost = (n: string | number) => `$${Number(n).toFixed(4)}`
  const fmtMs = (n: string | number) => `${Math.round(Number(n))}ms`
  const maxTokens = data ? Math.max(...data.daily.map(d => Number(d.input_tokens) + Number(d.output_tokens)), 1) : 1
  const maxLatency = data ? Math.max(...data.daily.map(d => Number(d.avg_latency_ms)), 1) : 1

  const card = (label: string, value: string, color: string) => (
    <div key={label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', padding: '18px 20px' }}>
      <div style={{ fontSize: 24, fontWeight: 600, color, marginBottom: 4 }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--text3)' }}>{label}</div>
    </div>
  )

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
      <PageSub>Token usage, costs, latency, and tool activity.</PageSub>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spinner size={24} /></div>
      ) : data ? (
        <>
          {/* ── Row 1: 6 stat cards ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 8 }}>
            {card('Total tokens', fmt(Number(data.totals.input_tokens) + Number(data.totals.output_tokens)), 'var(--blue-t)')}
            {card('Estimated cost', fmtCost(data.totals.cost_usd), 'var(--green-t)')}
            {card('API calls', fmt(data.totals.calls), 'var(--purple-t)')}
            {card('Input tokens', fmt(data.totals.input_tokens), 'var(--text)')}
            {card('Avg latency', fmtMs(data.totals.avg_latency_ms), 'var(--amber-t)')}
            {card('Tool calls', fmt(data.totals.tool_calls_total), 'var(--red-t, #f97316)')}
          </div>
          {/* Cost is derived from a built-in per-model price table, including
              prompt-cache read/write rates. It's an estimate — actual billing is
              the provider invoice, and the table can lag price changes. */}
          <div style={{ fontSize: 11, color: 'var(--text4)', marginBottom: 20 }}>
            Cost is estimated from current model prices (incl. prompt-cache rates) and may differ slightly from your provider invoice.
          </div>

          {/* ── Row 2: Token chart + Latency chart side by side ── */}
          {data.daily.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
              {/* Token chart */}
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', padding: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>Daily token usage</div>
                  <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text3)' }}>
                    <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'var(--blue)', marginRight: 5 }} />Input</span>
                    <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'var(--purple)', marginRight: 5 }} />Output</span>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 72 }}>
                  {data.daily.map((d, i) => {
                    const ih = Math.max(3, (Number(d.input_tokens) / maxTokens) * 64)
                    const oh = Math.max(2, (Number(d.output_tokens) / maxTokens) * 64 * .4)
                    return (
                      <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}
                        title={`${fmt(Number(d.input_tokens) + Number(d.output_tokens))} tokens`}>
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

              {/* Latency chart */}
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', padding: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>Avg response latency</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>ms per call</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 72 }}>
                  {data.daily.map((d, i) => {
                    const h = Math.max(3, (Number(d.avg_latency_ms) / maxLatency) * 64)
                    return (
                      <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}
                        title={`${fmtMs(d.avg_latency_ms)} avg`}>
                        <div style={{ width: '100%', height: h, background: 'var(--amber)', opacity: .75, borderRadius: '3px 3px 0 0' }} />
                        <div style={{ fontSize: 9, color: 'var(--text4)', marginTop: 3 }}>
                          {new Date(d.date).toLocaleDateString('en', { weekday: 'narrow' })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ── Row 3: Tool breakdown + Source breakdown ── */}
          {(data.toolBreakdown.length > 0 || data.sourceBreakdown.length > 0) && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
              {/* Tool type breakdown */}
              {data.toolBreakdown.length > 0 && (
                <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', padding: 20 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 16 }}>Tool usage breakdown</div>
                  {(() => {
                    const total = data.toolBreakdown.reduce((s, t) => s + t.count, 0)
                    return data.toolBreakdown.map((t, i) => (
                      <div key={t.tool} style={{ marginBottom: 10 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span style={{ fontSize: 12, color: 'var(--text2)' }}>{TOOL_LABELS[t.tool] || t.tool}</span>
                          <span style={{ fontSize: 11, color: 'var(--text3)' }}>{t.count} calls · {Math.round(t.count / total * 100)}%</span>
                        </div>
                        <div style={{ height: 5, background: 'var(--bg3)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${t.count / total * 100}%`, background: TOOL_COLORS[i % TOOL_COLORS.length], borderRadius: 3, transition: 'width .4s' }} />
                        </div>
                      </div>
                    ))
                  })()}
                </div>
              )}

              {/* Source type breakdown */}
              {data.sourceBreakdown.length > 0 && (
                <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', padding: 20 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 16 }}>Data source activity</div>
                  {(() => {
                    const total = data.sourceBreakdown.reduce((s, t) => s + t.count, 0)
                    return data.sourceBreakdown.map((t, i) => (
                      <div key={t.source} style={{ marginBottom: 10 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span style={{ fontSize: 12, color: 'var(--text2)', textTransform: 'capitalize' }}>{t.source.replace(/_/g, ' ')}</span>
                          <span style={{ fontSize: 11, color: 'var(--text3)' }}>{t.count} queries · {Math.round(t.count / total * 100)}%</span>
                        </div>
                        <div style={{ height: 5, background: 'var(--bg3)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${t.count / total * 100}%`, background: TOOL_COLORS[(i + 2) % TOOL_COLORS.length], borderRadius: 3, transition: 'width .4s' }} />
                        </div>
                      </div>
                    ))
                  })()}
                </div>
              )}
            </div>
          )}

          {/* ── Row 4: Per-user table (admin only) ── */}
          {user.role === 'admin' && data.byUser.length > 0 && (() => {
            const totalUserPages = Math.ceil(data.byUser.length / USERS_PER_PAGE)
            const pageRows = data.byUser.slice((userPage - 1) * USERS_PER_PAGE, userPage * USERS_PER_PAGE)
            return (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
              <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 500, color: 'var(--text)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>Usage by user <span style={{ color: 'var(--text3)', fontWeight: 400 }}>({data.byUser.length})</span></span>
                <button onClick={exportCsv} style={{ fontSize: 12, padding: '5px 12px', borderRadius: 'var(--radius-pill)', border: '1px solid var(--border2)', background: 'var(--surface)', color: 'var(--text2)', cursor: 'pointer', fontFamily: 'inherit' }}>Export CSV</button>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['User', 'Calls', 'Input tokens', 'Output tokens', 'Cache tokens', 'Avg latency', 'Cost'].map(h => (
                      <th key={h} style={{ padding: '9px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((u, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '10px 16px', fontSize: 13, color: 'var(--text)' }}>{u.user_email}</td>
                      <td style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text2)' }}>{fmt(u.calls)}</td>
                      <td style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text2)' }}>{fmt(u.input_tokens)}</td>
                      <td style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text2)' }}>{fmt(u.output_tokens)}</td>
                      <td style={{ padding: '10px 16px', fontSize: 12, color: 'var(--text3)' }} title="cache read + write">{fmt(Number(u.cache_read_tokens || 0) + Number(u.cache_write_tokens || 0))}</td>
                      <td style={{ padding: '10px 16px', fontSize: 12, color: 'var(--amber-t)' }}>{fmtMs(u.avg_latency_ms)}</td>
                      <td style={{ padding: '10px 16px', fontSize: 12, color: 'var(--green-t)', fontWeight: 500 }}>{fmtCost(u.cost_usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {totalUserPages > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderTop: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 12, color: 'var(--text3)' }}>{data.byUser.length} users</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button onClick={() => setUserPage(p => Math.max(1, p - 1))} disabled={userPage === 1} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', cursor: userPage === 1 ? 'not-allowed' : 'pointer', color: 'var(--text3)', fontSize: 12 }}>←</button>
                    <span style={{ fontSize: 12, color: 'var(--text3)' }}>Page {userPage} of {totalUserPages}</span>
                    <button onClick={() => setUserPage(p => Math.min(totalUserPages, p + 1))} disabled={userPage === totalUserPages} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', cursor: userPage === totalUserPages ? 'not-allowed' : 'pointer', color: 'var(--text3)', fontSize: 12 }}>→</button>
                  </div>
                </div>
              )}
            </div>
            )
          })()}

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
