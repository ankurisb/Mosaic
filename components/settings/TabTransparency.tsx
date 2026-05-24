'use client'
import { useState, useEffect, useCallback } from 'react'
import { PageTitle, PageSub, Btn, Spinner } from './ui'

interface TEntry {
  id: string
  message_id: string | null
  conversation_id: string | null
  user_email: string
  question: string
  answer_summary: string
  tool_calls_count: number
  tools_used: string[]
  sources_queried: Array<{ type: string; label: string }>
  rows_read: number
  web_search_used: boolean
  input_tokens: number
  output_tokens: number
  cost_usd: number
  latency_ms: number
  model: string
  is_rca: boolean
  created_at: string
}

const PAGE = 25

const TOOL_LABELS: Record<string, string> = {
  query_database:           'Database',
  call_api:                 'API',
  read_file_server:         'File server',
  web_search:               'Web search',
  query_prism:              'Prism IoT',
  run_statistical_analysis: 'Statistics',
}

function fmt(iso: string) {
  try { return new Date(iso).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) }
  catch { return iso }
}
function fmtMs(ms: number) {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}
function fmtCost(usd: number) {
  return usd < 0.001 ? '<$0.001' : `$${usd.toFixed(4)}`
}

function SourceBadge({ s }: { s: { type: string; label: string } }) {
  const colors: Record<string, string> = {
    database: 'var(--blue)',
    api: 'var(--amber)',
    file_server: 'var(--text3)',
    web: 'var(--green)',
    prism: 'var(--blue)',
  }
  const color = colors[s.type] || 'var(--text3)'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-pill)', padding: '1px 8px', fontSize: 11, color: 'var(--text2)', marginRight: 4, marginBottom: 2 }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
      {s.label}
    </span>
  )
}

function EntryRow({ e }: { e: TEntry }) {
  const [open, setOpen] = useState(false)
  const hasTools = e.tool_calls_count > 0

  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      {/* Summary row */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, padding: '12px 16px', cursor: 'pointer', background: open ? 'var(--bg3)' : 'transparent' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>{fmt(e.created_at)}</span>
            <span style={{ fontSize: 11, color: 'var(--text4)' }}>·</span>
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>{e.user_email}</span>
            {e.is_rca && <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--blue-t)', background: 'var(--blue-bg)', border: '1px solid rgba(37,99,235,.2)', borderRadius: 'var(--radius-pill)', padding: '0 6px' }}>RCA</span>}
            {e.web_search_used && <span style={{ fontSize: 10, color: 'var(--text3)', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-pill)', padding: '0 6px' }}>web</span>}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500, marginBottom: hasTools ? 5 : 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {e.question || '—'}
          </div>
          {hasTools && (
            <div style={{ display: 'flex', flexWrap: 'wrap', marginTop: 2 }}>
              {e.sources_queried.map((s, i) => <SourceBadge key={i} s={s} />)}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: 'var(--text3)' }}>{(e.input_tokens + e.output_tokens).toLocaleString()} tokens</span>
          <span style={{ fontSize: 11, color: 'var(--text4)' }}>{fmtMs(e.latency_ms)}</span>
          <span style={{ fontSize: 9, opacity: 0.5 }}>{open ? '▲' : '▼'}</span>
        </div>
      </div>

      {/* Expanded detail */}
      {open && (
        <div style={{ padding: '12px 16px 16px', background: 'var(--bg3)', borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--text3)', marginBottom: 5 }}>Question</div>
              <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{e.question}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--text3)', marginBottom: 5 }}>Response summary</div>
              <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{e.answer_summary || '—'}</div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8, marginBottom: hasTools ? 12 : 0 }}>
            {[
              { label: 'Model',         value: e.model },
              { label: 'Input tokens',  value: e.input_tokens.toLocaleString() },
              { label: 'Output tokens', value: e.output_tokens.toLocaleString() },
              { label: 'Latency',       value: fmtMs(e.latency_ms) },
              { label: 'Est. cost',     value: fmtCost(e.cost_usd) },
              ...(e.rows_read > 0 ? [{ label: 'Rows read', value: e.rows_read.toLocaleString() }] : []),
            ].map(stat => (
              <div key={stat.label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '8px 10px' }}>
                <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 2 }}>{stat.label}</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{stat.value}</div>
              </div>
            ))}
          </div>

          {hasTools && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--text3)', marginBottom: 6 }}>Data sources accessed</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {e.sources_queried.map((s, i) => <SourceBadge key={i} s={s} />)}
                {e.tools_used.filter(t => !['query_database','call_api','read_file_server','web_search','query_prism'].includes(t)).map((t, i) => (
                  <span key={i} style={{ fontSize: 11, color: 'var(--text3)', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-pill)', padding: '1px 8px' }}>
                    {TOOL_LABELS[t] || t}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function TabTransparency() {
  const [entries,  setEntries]  = useState<TEntry[]>([])
  const [total,    setTotal]    = useState(0)
  const [loading,  setLoading]  = useState(true)
  const [page,     setPage]     = useState(0)
  const [q,        setQ]        = useState('')
  const [rcaOnly,  setRcaOnly]  = useState(false)

  const load = useCallback(async (p = 0) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        limit: String(PAGE), offset: String(p * PAGE),
        ...(q      ? { q }       : {}),
        ...(rcaOnly ? { is_rca: '1' } : {}),
      })
      const r = await fetch(`/api/transparency?${params}`)
      if (!r.ok) return
      const d = await r.json()
      setEntries(d.entries || [])
      setTotal(d.total || 0)
    } finally { setLoading(false) }
  }, [q, rcaOnly])

  useEffect(() => { load(page) }, [load, page])
  useEffect(() => { setPage(0) }, [q, rcaOnly])

  const totalPages = Math.max(1, Math.ceil(total / PAGE))

  return (
    <div className="fade-in">
      <PageTitle>AI Decision Log</PageTitle>
      <PageSub>Every AI response — what was asked, which data was queried, how many tokens were used. An auditable record for each AI decision.</PageSub>

      {/* Filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          style={{ flex: 1, minWidth: 200, background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', padding: '5px 10px', fontSize: 12, color: 'var(--text)', fontFamily: 'inherit', outline: 'none' }}
          placeholder="Search questions, sources, users…"
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { setPage(0); load(0) } }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text2)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={rcaOnly} onChange={e => setRcaOnly(e.target.checked)} />
          RCA only
        </label>
        <Btn size="sm" onClick={() => { setPage(0); load(0) }}>Search</Btn>
        {(q || rcaOnly) && <Btn size="sm" variant="ghost" onClick={() => { setQ(''); setRcaOnly(false) }}>Clear</Btn>}
        <span style={{ fontSize: 11, color: 'var(--text3)' }}>
          {loading ? '' : `${total.toLocaleString()} response${total !== 1 ? 's' : ''}`}
        </span>
      </div>

      {/* Table */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', marginBottom: 16 }}>
        {/* Header */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, padding: '8px 16px', background: 'var(--bg3)', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--text3)' }}>Question / Sources</span>
          <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--text3)' }}>Tokens / Time</span>
        </div>

        {loading ? (
          <div style={{ padding: 40, display: 'flex', justifyContent: 'center' }}><Spinner /></div>
        ) : entries.length === 0 ? (
          <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
            {q || rcaOnly ? 'No responses match your filters.' : 'No AI responses logged yet. Start a conversation to see entries here.'}
          </div>
        ) : (
          entries.map(e => <EntryRow key={e.id} e={e} />)
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', fontSize: 12 }}>
          <Btn size="sm" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>← Prev</Btn>
          <span style={{ color: 'var(--text3)' }}>Page {page + 1} of {totalPages}</span>
          <Btn size="sm" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}>Next →</Btn>
        </div>
      )}
    </div>
  )
}
