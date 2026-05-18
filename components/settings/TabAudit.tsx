'use client'
import { useState, useEffect, useCallback } from 'react'
import type { SessionUser } from '@/lib/auth'
import { PageTitle, PageSub, Card, CardRow, Btn, Badge, Spinner } from './ui'

interface AuditEvent {
  id: string
  timestamp: string
  actor_email: string | null
  actor_ip: string | null
  actor_role: string | null
  action: string
  resource: string
  outcome: string
  detail: string | null
}

const OUTCOME_COLOR: Record<string, string> = {
  success: 'green',
  failure: 'amber',
  error:   'red',
}

const ACTION_COLOR: Record<string, string> = {
  LOGIN: 'green', LOGIN_FAILED: 'red', LOGOUT: 'gray',
  CONNECTION_CREATE: 'blue', CONNECTION_UPDATE: 'blue', CONNECTION_DELETE: 'red',
  CREDENTIAL_VIEW: 'amber',
  CHAT_START: 'gray', TOOL_CALL: 'gray', RCA_TRIGGER: 'blue',
  API_KEY_CREATE: 'blue', API_KEY_REVOKE: 'red',
  USER_CREATE: 'blue', USER_UPDATE: 'blue', USER_DELETE: 'red', USER_BAN: 'red',
  SETTINGS_UPDATE: 'amber', GUARDRAIL_UPDATE: 'amber',
  RULE_FIRE: 'amber', NOTIFICATION_SEND: 'gray',
}

const SINCE_OPTIONS = [
  { label: 'Last 1 hour',  value: () => new Date(Date.now() - 3600_000).toISOString() },
  { label: 'Last 24 hours', value: () => new Date(Date.now() - 86400_000).toISOString() },
  { label: 'Last 7 days',  value: () => new Date(Date.now() - 7*86400_000).toISOString() },
  { label: 'Last 30 days', value: () => new Date(Date.now() - 30*86400_000).toISOString() },
  { label: 'All time',     value: () => '' },
]

export default function TabAudit({ user }: { user: SessionUser }) {
  const [events,        setEvents]        = useState<AuditEvent[]>([])
  const [total,         setTotal]         = useState(0)
  const [loading,       setLoading]       = useState(true)
  const [offset,        setOffset]        = useState(0)
  const [actionTypes,   setActionTypes]   = useState<string[]>([])
  const [chain,         setChain]         = useState<{ valid: boolean; totalRows: number } | null>(null)
  const [settings,      setSettings]      = useState<Record<string, string>>({})
  const [retDays,       setRetDays]       = useState('')
  const [savingRet,     setSavingRet]     = useState(false)
  const [retMsg,        setRetMsg]        = useState('')

  // Filters
  const [sinceIdx,    setSinceIdx]    = useState(1)  // default: last 24h
  const [actorFilter, setActorFilter] = useState('')
  const [actionFilter,setActionFilter]= useState('')
  const [outcomeFilter,setOutcomeFilter] = useState('')
  const [expanded,    setExpanded]    = useState<string | null>(null)

  const LIMIT = 100

  const load = useCallback(async (newOffset = 0) => {
    setLoading(true)
    try {
      const since = SINCE_OPTIONS[sinceIdx].value()
      const params = new URLSearchParams({
        limit: String(LIMIT),
        offset: String(newOffset),
        ...(actorFilter  ? { actor: actorFilter }    : {}),
        ...(actionFilter ? { action: actionFilter }  : {}),
        ...(outcomeFilter? { outcome: outcomeFilter } : {}),
        ...(since        ? { since }                 : {}),
        ...(newOffset === 0 ? { verify: 'true' }     : {}),
      })
      const r = await fetch(`/api/audit?${params}`)
      if (!r.ok) return
      const d = await r.json()
      setEvents(newOffset === 0 ? d.events : prev => [...prev, ...d.events])
      setTotal(d.total)
      setOffset(newOffset + d.events.length)
      if (d.actionTypes?.length) setActionTypes(d.actionTypes)
      if (d.chain) setChain(d.chain)
      if (d.settings) {
        setSettings(d.settings)
        setRetDays(d.settings.retention_days || '365')
      }
    } finally { setLoading(false) }
  }, [sinceIdx, actorFilter, actionFilter, outcomeFilter])

  useEffect(() => { load(0) }, [load])

  function exportCsv() {
    const since = SINCE_OPTIONS[sinceIdx].value()
    const params = new URLSearchParams({
      format: 'csv', limit: '500', offset: '0',
      ...(actorFilter   ? { actor: actorFilter }    : {}),
      ...(actionFilter  ? { action: actionFilter }  : {}),
      ...(outcomeFilter ? { outcome: outcomeFilter } : {}),
      ...(since         ? { since }                 : {}),
    })
    window.open(`/api/audit?${params}`, '_blank')
  }

  async function saveRetention() {
    const days = parseInt(retDays)
    if (isNaN(days) || days < 30) { setRetMsg('Minimum 30 days'); return }
    setSavingRet(true)
    try {
      const r = await fetch('/api/audit', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ retention_days: days })
      })
      const d = await r.json()
      setRetMsg(d.ok ? `Saved — events older than ${days} days will be purged nightly` : d.error)
      setTimeout(() => setRetMsg(''), 4000)
    } finally { setSavingRet(false) }
  }

  function formatTime(iso: string) {
    try { return new Date(iso).toLocaleString([], { dateStyle: 'short', timeStyle: 'medium' }) }
    catch { return iso }
  }

  const sel: React.CSSProperties = {
    background: 'var(--bg)', border: '1px solid var(--border2)',
    borderRadius: 'var(--radius-sm)', padding: '5px 8px', fontSize: 12,
    color: 'var(--text)', fontFamily: 'inherit', cursor: 'pointer',
  }
  const inp: React.CSSProperties = {
    ...sel, outline: 'none', width: 160,
  }

  return (
    <div className="fade-in">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 }}>
        <div>
          <PageTitle>Audit Trail</PageTitle>
          <PageSub>ISO 27001-compliant event log. Every event is hash-chained — modifications are detectable.</PageSub>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
          {chain && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: chain.valid ? 'var(--green-t)' : 'var(--red-t)', background: chain.valid ? 'var(--green-bg)' : 'rgba(220,38,38,.08)', border: `1px solid ${chain.valid ? 'rgba(22,163,74,.2)' : 'rgba(220,38,38,.2)'}`, borderRadius: 'var(--radius-pill)', padding: '4px 12px', whiteSpace: 'nowrap', flexShrink: 0 }}>
              <span>{chain.valid ? '✓ Chain intact' : '⚠ Chain broken'}</span>
              <span style={{ color: 'var(--text3)' }}>({chain.totalRows})</span>
            </div>
          )}
          <Btn size="sm" onClick={exportCsv}>Export CSV</Btn>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <select value={sinceIdx} onChange={e => setSinceIdx(Number(e.target.value))} style={sel}>
          {SINCE_OPTIONS.map((o, i) => <option key={o.label} value={i}>{o.label}</option>)}
        </select>
        <input style={inp} placeholder="Filter by email" value={actorFilter}
          onChange={e => setActorFilter(e.target.value)} />
        <select value={actionFilter} onChange={e => setActionFilter(e.target.value)} style={sel}>
          <option value="">All actions</option>
          {actionTypes.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={outcomeFilter} onChange={e => setOutcomeFilter(e.target.value)} style={sel}>
          <option value="">All outcomes</option>
          <option value="success">Success</option>
          <option value="failure">Failure</option>
          <option value="error">Error</option>
        </select>
        <Btn size="sm" onClick={() => load(0)}>Search</Btn>
        <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 4 }}>
          {total > 0 && `${total.toLocaleString()} event${total !== 1 ? 's' : ''}`}
        </span>
      </div>

      {/* Retention + integrity status panel */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
        {/* Retention policy */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '14px 16px' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>Retention policy</div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 10 }}>
            Events older than this are purged nightly.
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="number" min={365} max={3650} value={retDays}
              onChange={e => setRetDays(e.target.value)}
              style={{ ...inp, width: 80 }}
            />
            <span style={{ fontSize: 12, color: 'var(--text3)' }}>days</span>
            <Btn size="sm" onClick={saveRetention} disabled={savingRet}>{savingRet ? 'Saving…' : 'Save'}</Btn>
          </div>
          <div style={{ fontSize: 10, color: 'var(--text4)', marginTop: 5 }}>* ISO 27001 requires minimum 1 year (365 days)</div>
          {retMsg && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6 }}>{retMsg}</div>}
          {settings.last_purge_at && <div style={{ fontSize: 11, color: 'var(--text4)', marginTop: 4 }}>Last purge: {formatTime(settings.last_purge_at)} ({settings.last_purge_count || 0} events)</div>}
        </div>

        {/* Chain integrity */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '14px 16px' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>Chain integrity</div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 10 }}>
            Every event is SHA-256 chained. Verification runs daily and is logged.
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {chain ? (
              <span style={{ fontSize: 12, fontWeight: 500, color: chain.valid ? 'var(--green-t)' : 'var(--red-t)' }}>
                {chain.valid ? `✓ Intact` : `⚠ BROKEN`} — {chain.totalRows} events
              </span>
            ) : (
              <span style={{ fontSize: 12, color: 'var(--text3)' }}>Loading…</span>
            )}
          </div>
          {settings.last_chain_verify_at && (
            <div style={{ fontSize: 11, color: 'var(--text4)', marginTop: 6 }}>
              Last verified: {formatTime(settings.last_chain_verify_at)}
              {settings.last_chain_verify_ok && <span style={{ marginLeft: 6, color: settings.last_chain_verify_ok === 'true' ? 'var(--green-t)' : 'var(--red-t)' }}>{settings.last_chain_verify_ok === 'true' ? '✓ passed' : '⚠ failed'}</span>}
            </div>
          )}
        </div>
      </div>

      {/* ISO 27001 Compliance Documents */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 10 }}>
          ISO 27001 Compliance Documents
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {[
            {
              doc: 'retention-policy',
              title: 'Retention Policy Statement',
              ref: 'A.8.15',
              desc: 'Defines retention period, purge schedule, and tamper-evidence controls. Auto-populated with live configuration.',
            },
            {
              doc: 'risk-assessment',
              title: 'Risk Assessment',
              ref: '6.1.2',
              desc: 'Asset inventory, risk register, and controls status. Populated with live counts from the platform.',
            },
            {
              doc: 'training-records',
              title: 'Training Records',
              ref: 'A.6.3',
              desc: 'Staff awareness training register. User list auto-populated from all active Mosaic accounts.',
            },
          ].map(item => (
            <div key={item.doc} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text4)', background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 3, padding: '1px 6px', fontFamily: 'var(--font-mono)' }}>{item.ref}</span>
                <a
                  href={`/api/docs/${item.doc}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: 11, color: 'var(--text2)', textDecoration: 'none', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', padding: '3px 10px', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                >
                  View →
                </a>
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 5 }}>{item.title}</div>
              <div style={{ fontSize: 11, color: 'var(--text3)', lineHeight: 1.5 }}>{item.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Event list */}
      {loading && events.length === 0 ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spinner size={20} /></div>
      ) : events.length === 0 ? (
        <Card><div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>No audit events found for the selected filters.</div></Card>
      ) : (
        <>
          <Card>
            {events.map((ev, i) => {
              const isExpanded = expanded === ev.id
              const detail = (() => { try { return ev.detail ? JSON.parse(ev.detail) : null } catch { return ev.detail } })()
              return (
                <div key={ev.id} style={{ borderBottom: i < events.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <div
                    onClick={() => setExpanded(isExpanded ? null : ev.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', cursor: 'pointer' }}
                  >
                    {/* Timestamp */}
                    <span style={{ fontSize: 11, color: 'var(--text3)', flexShrink: 0, minWidth: 130, fontFamily: 'var(--font-mono)' }}>
                      {formatTime(ev.timestamp)}
                    </span>
                    {/* Action badge */}
                    <Badge label={ev.action} color={(ACTION_COLOR[ev.action] || 'gray') as 'green' | 'amber' | 'red' | 'blue' | 'gray'} />
                    {/* Outcome badge */}
                    <Badge label={ev.outcome} color={(OUTCOME_COLOR[ev.outcome] || 'gray') as 'green' | 'amber' | 'red' | 'blue' | 'gray'} />
                    {/* Actor */}
                    <span style={{ fontSize: 12, color: 'var(--text2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {ev.actor_email || 'unauthenticated'}
                      {ev.actor_ip && <span style={{ color: 'var(--text4)', marginLeft: 6 }}>{ev.actor_ip}</span>}
                    </span>
                    {/* Resource */}
                    <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
                      {ev.resource}
                    </span>
                    {/* Expand chevron */}
                    <span style={{ color: 'var(--text4)', fontSize: 10, flexShrink: 0 }}>{isExpanded ? '▲' : '▼'}</span>
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div style={{ padding: '0 16px 12px 16px', background: 'var(--bg2)' }}>
                      <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text3)', marginBottom: 6 }}>
                        ID: {ev.id}
                      </div>
                      {ev.actor_role && (
                        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 4 }}>
                          Role: {ev.actor_role}
                        </div>
                      )}
                      {detail && (
                        <pre style={{ fontSize: 11, color: 'var(--text)', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', overflowX: 'auto', margin: 0, fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          {typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2)}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </Card>

          {/* Load more */}
          {offset < total && (
            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'center' }}>
              <Btn size="sm" onClick={() => load(offset)} disabled={loading}>
                {loading ? 'Loading...' : `Load more (${total - offset} remaining)`}
              </Btn>
            </div>
          )}
        </>
      )}
    </div>
  )
}
