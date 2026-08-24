'use client'
import { useState, useEffect, useCallback } from 'react'
import type { SessionUser } from '@/lib/auth'
import { PageTitle, PageSub, Card, Btn, Badge, Spinner } from './ui'

interface AuditEvent {
  id: string; timestamp: string; actor_email: string | null
  actor_ip: string | null; actor_role: string | null
  action: string; resource: string; outcome: string; detail: string | null
}

interface ComplianceCheck {
  id: string; control: string; title: string
  status: 'pass' | 'fail' | 'partial' | 'na'; detail: string; metric?: string
}
interface ComplianceSection { section: string; checks: ComplianceCheck[] }
interface ComplianceData {
  sections: ComplianceSection[]
  summary: { pass: number; partial: number; fail: number; na: number; total: number }
  generatedAt: string
}

const OUTCOME_COLOR: Record<string, string> = { success: 'green', failure: 'amber', error: 'red' }
const ACTION_COLOR: Record<string, string> = {
  LOGIN: 'green', LOGIN_FAILED: 'red', LOGOUT: 'gray',
  CONNECTION_CREATE: 'blue', CONNECTION_UPDATE: 'blue', CONNECTION_DELETE: 'red',
  CREDENTIAL_VIEW: 'amber', CHAT_START: 'gray', TOOL_CALL: 'gray', RCA_TRIGGER: 'blue',
  API_KEY_CREATE: 'blue', API_KEY_REVOKE: 'red',
  USER_CREATE: 'blue', USER_UPDATE: 'blue', USER_DELETE: 'red', USER_BAN: 'red',
  SETTINGS_UPDATE: 'amber', GUARDRAIL_UPDATE: 'amber',
  GUARDRAIL_BLOCK: 'red', DATA_ACCESS_DENY: 'red', SSO_ROLE_ASSIGNED: 'blue',
  RULE_FIRE: 'amber', NOTIFICATION_SEND: 'gray',
}
const SINCE_OPTIONS = [
  { label: 'Last 1 hour',   value: () => new Date(Date.now() - 3600_000).toISOString() },
  { label: 'Last 24 hours', value: () => new Date(Date.now() - 86400_000).toISOString() },
  { label: 'Last 7 days',   value: () => new Date(Date.now() - 7*86400_000).toISOString() },
  { label: 'Last 30 days',  value: () => new Date(Date.now() - 30*86400_000).toISOString() },
  { label: 'All time',      value: () => '' },
]
const PAGE_SIZE = 25

const STATUS_ICON: Record<string, string> = { pass: '✓', fail: '✗', partial: '~', na: '–' }
const STATUS_COLOR: Record<string, string> = {
  pass:    'var(--green-t)',
  fail:    'var(--red-t)',
  partial: 'var(--amber-t)',
  na:      'var(--text4)',
}
const STATUS_BG: Record<string, string> = {
  pass:    'var(--green-bg)',
  fail:    'rgba(220,38,38,.06)',
  partial: 'rgba(245,158,11,.07)',
  na:      'var(--bg3)',
}

export default function TabAudit({ user }: { user: SessionUser }) {
  const [events,       setEvents]       = useState<AuditEvent[]>([])
  const [total,        setTotal]        = useState(0)
  const [page,         setPage]         = useState(0)   // 0-based page index
  const [loading,      setLoading]      = useState(true)
  const [actionTypes,  setActionTypes]  = useState<string[]>([])
  const [chain,        setChain]        = useState<{ valid: boolean; totalRows: number } | null>(null)
  const [settings,     setSettings]     = useState<Record<string, string>>({})
  const [retDays,      setRetDays]      = useState('')
  const [savingRet,    setSavingRet]    = useState(false)
  const [retMsg,       setRetMsg]       = useState('')
  const [expanded,     setExpanded]     = useState<string | null>(null)

  // Compliance
  const [compliance,   setCompliance]   = useState<ComplianceData | null>(null)
  const [compLoading,  setCompLoading]  = useState(false)
  const [showComp,     setShowComp]     = useState(false)
  const [expandedSec,  setExpandedSec]  = useState<string | null>(null)
  // CISO is an optional bring-your-own integration (not bundled). Only surface
  // the "Open CISO Assistant" links when the operator has actually configured a
  // CISO instance (Settings → Keys); otherwise they'd point at a dead URL.
  const [cisoUrl,      setCisoUrl]      = useState<string | null>(null)

  // Filters
  const [sinceIdx,     setSinceIdx]     = useState(1)
  const [qFilter,      setQFilter]      = useState('')
  const [actorFilter,  setActorFilter]  = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [outcomeFilter,setOutcomeFilter]= useState('')

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const load = useCallback(async (p = 0) => {
    setLoading(true)
    try {
      const since = SINCE_OPTIONS[sinceIdx].value()
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE), offset: String(p * PAGE_SIZE),
        ...(qFilter       ? { q: qFilter }            : {}),
        ...(actorFilter   ? { actor: actorFilter }    : {}),
        ...(actionFilter  ? { action: actionFilter }  : {}),
        ...(outcomeFilter ? { outcome: outcomeFilter } : {}),
        ...(since         ? { since }                 : {}),
        ...(p === 0       ? { verify: 'true' }        : {}),
      })
      const r = await fetch(`/api/audit?${params}`)
      if (!r.ok) return
      const d = await r.json()
      setEvents(d.events)
      setTotal(d.total)
      if (d.actionTypes?.length) setActionTypes(d.actionTypes)
      if (d.chain) setChain(d.chain)
      if (d.settings) { setSettings(d.settings); setRetDays(d.settings.retention_days || '365') }
    } finally { setLoading(false) }
  }, [sinceIdx, qFilter, actorFilter, actionFilter, outcomeFilter])

  useEffect(() => { load(page) }, [load, page])
  // Reset to page 0 when filters change
  useEffect(() => { setPage(0) }, [sinceIdx, qFilter, actorFilter, actionFilter, outcomeFilter])

  async function loadCompliance() {
    setCompLoading(true)
    try {
      const r = await fetch('/api/docs/compliance-status')
      if (r.ok) setCompliance(await r.json())
    } finally { setCompLoading(false) }
  }
  useEffect(() => { if (showComp && !compliance) loadCompliance() }, [showComp])

  // Resolve whether a CISO portal is available to link to. CISO is an optional
  // bring-your-own integration (not bundled); the portal link only makes sense
  // when a browser-facing CISO URL is configured (NEXT_PUBLIC_CISO_URL). Without
  // one there's nothing valid to open, so the links stay hidden — regardless of
  // whether a leftover bundled backend happens to be reachable.
  useEffect(() => {
    const publicUrl = process.env.NEXT_PUBLIC_CISO_URL
    setCisoUrl(publicUrl && /^https?:\/\//.test(publicUrl) ? publicUrl : null)
  }, [])

  function exportCsv() {
    const since = SINCE_OPTIONS[sinceIdx].value()
    const params = new URLSearchParams({
      format: 'csv', limit: '500', offset: '0',
      ...(qFilter       ? { q: qFilter }            : {}),
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
      const r = await fetch('/api/audit', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ retention_days: days }) })
      const d = await r.json()
      setRetMsg(d.ok ? `Saved — ${days}-day retention active` : d.error)
      setTimeout(() => setRetMsg(''), 4000)
    } finally { setSavingRet(false) }
  }

  function fmt(iso: string) {
    try { return new Date(iso).toLocaleString([], { dateStyle: 'short', timeStyle: 'medium' }) } catch { return iso }
  }

  const sel: React.CSSProperties = {
    background: 'var(--bg)', border: '1px solid var(--border2)',
    borderRadius: 'var(--radius-sm)', padding: '5px 8px', fontSize: 12,
    color: 'var(--text)', fontFamily: 'inherit', cursor: 'pointer',
  }

  return (
    <div className="fade-in">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 }}>
        <div>
          <PageTitle>Audit Trail</PageTitle>
          <PageSub>ISO 27001-compliant event log. Every event is hash-chained — modifications are detectable.</PageSub>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
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
        <input
          style={{ ...sel, outline: 'none', width: 220 }}
          placeholder="Search events…"
          value={qFilter}
          onChange={e => setQFilter(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { setPage(0); load(0) } }}
        />
        <input style={{ ...sel, outline: 'none', width: 140 }} placeholder="Filter by email"
          value={actorFilter} onChange={e => setActorFilter(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { setPage(0); load(0) } }} />
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
        <Btn size="sm" onClick={() => { setPage(0); load(0) }}>Search</Btn>
        {(qFilter || actorFilter || actionFilter || outcomeFilter) && (
          <Btn size="sm" variant="ghost" onClick={() => { setQFilter(''); setActorFilter(''); setActionFilter(''); setOutcomeFilter('') }}>Clear</Btn>
        )}
        <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 4 }}>
          {total > 0 && `${total.toLocaleString()} event${total !== 1 ? 's' : ''}`}
        </span>
      </div>

      {/* Retention + integrity panel */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '14px 16px' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>Retention policy</div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 10 }}>Events older than this are purged nightly.</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="number" min={365} max={3650} value={retDays} onChange={e => setRetDays(e.target.value)} style={{ ...sel, outline: 'none', width: 80 }} />
            <span style={{ fontSize: 12, color: 'var(--text3)' }}>days</span>
            <Btn size="sm" onClick={saveRetention} disabled={savingRet}>{savingRet ? 'Saving…' : 'Save'}</Btn>
          </div>
          <div style={{ fontSize: 10, color: 'var(--text4)', marginTop: 5 }}>* ISO 27001 requires minimum 1 year (365 days)</div>
          {retMsg && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6 }}>{retMsg}</div>}
          {settings.last_purge_at && <div style={{ fontSize: 11, color: 'var(--text4)', marginTop: 4 }}>Last purge: {fmt(settings.last_purge_at)} ({settings.last_purge_count || 0} events)</div>}
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '14px 16px' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>Chain integrity</div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 10 }}>Every event is SHA-256 chained. Verification runs daily and is logged.</div>
          {chain ? (
            <span style={{ fontSize: 12, fontWeight: 500, color: chain.valid ? 'var(--green-t)' : 'var(--red-t)' }}>
              {chain.valid ? '✓ Intact' : '⚠ BROKEN'} — {chain.totalRows} events
            </span>
          ) : <span style={{ fontSize: 12, color: 'var(--text3)' }}>Loading…</span>}
          {settings.last_chain_verify_at && (
            <div style={{ fontSize: 11, color: 'var(--text4)', marginTop: 6 }}>
              Last verified: {fmt(settings.last_chain_verify_at)}
              {settings.last_chain_verify_ok && <span style={{ marginLeft: 6, color: settings.last_chain_verify_ok === 'true' ? 'var(--green-t)' : 'var(--red-t)' }}>{settings.last_chain_verify_ok === 'true' ? '✓ passed' : '⚠ failed'}</span>}
            </div>
          )}
        </div>
      </div>

      {/* ISO 27001 Live Compliance Panel */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>
            ISO 27001 Compliance Status
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {compliance && (
              <div style={{ display: 'flex', gap: 6, fontSize: 11 }}>
                <span style={{ color: 'var(--green-t)', fontWeight: 600 }}>{compliance.summary.pass} pass</span>
                <span style={{ color: 'var(--text4)' }}>·</span>
                <span style={{ color: 'var(--amber-t)', fontWeight: 600 }}>{compliance.summary.partial} partial</span>
                <span style={{ color: 'var(--text4)' }}>·</span>
                <span style={{ color: 'var(--red-t)', fontWeight: 600 }}>{compliance.summary.fail} fail</span>
              </div>
            )}
            <Btn size="sm" onClick={() => {
              setShowComp(v => !v)
              if (!showComp && !compliance) loadCompliance()
            }}>
              {showComp ? 'Hide checks' : 'Show live checks'}
            </Btn>
            {showComp && <Btn size="sm" onClick={() => { setCompliance(null); loadCompliance() }}>Refresh</Btn>}
          </div>
        </div>

        {showComp && (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
            {compLoading && !compliance ? (
              <div style={{ padding: 40, display: 'flex', justifyContent: 'center' }}><Spinner size={20} /></div>
            ) : compliance ? (
              <>
                {/* Summary bar */}
                <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg2)' }}>
                  <div style={{ display: 'flex', gap: 4, height: 6, borderRadius: 4, overflow: 'hidden', marginBottom: 8 }}>
                    {compliance.summary.pass > 0 && <div style={{ flex: compliance.summary.pass, background: 'var(--green)', opacity: .8 }} />}
                    {compliance.summary.partial > 0 && <div style={{ flex: compliance.summary.partial, background: 'var(--amber)', opacity: .8 }} />}
                    {compliance.summary.fail > 0 && <div style={{ flex: compliance.summary.fail, background: 'var(--red)', opacity: .8 }} />}
                    {compliance.summary.na > 0 && <div style={{ flex: compliance.summary.na, background: 'var(--bg3)' }} />}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                    {compliance.summary.pass} of {compliance.summary.total - compliance.summary.na} applicable controls passing
                    <span style={{ marginLeft: 12, color: 'var(--text4)' }}>Generated: {new Date(compliance.generatedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span>
                  </div>
                </div>

                {/* Sections */}
                {compliance.sections.map(sec => (
                  <div key={sec.section} style={{ borderBottom: '1px solid var(--border)' }}>
                    {/* Section header */}
                    <div
                      onClick={() => setExpandedSec(expandedSec === sec.section ? null : sec.section)}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', cursor: 'pointer', background: expandedSec === sec.section ? 'var(--bg2)' : 'transparent' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{sec.section}</span>
                        {/* Mini status pills */}
                        <div style={{ display: 'flex', gap: 3 }}>
                          {sec.checks.map(c => (
                            <span key={c.id} title={c.title} style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLOR[c.status], display: 'inline-block', opacity: .85 }} />
                          ))}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 10, color: 'var(--text3)' }}>
                          {sec.checks.filter(c => c.status === 'pass').length}/{sec.checks.filter(c => c.status !== 'na').length} pass
                        </span>
                        <span style={{ fontSize: 10, color: 'var(--text4)' }}>{expandedSec === sec.section ? '▲' : '▼'}</span>
                      </div>
                    </div>

                    {/* Checks */}
                    {expandedSec === sec.section && (
                      <div>
                        {sec.checks.map((check, ci) => (
                          <div key={check.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 16px 10px 28px', borderTop: '1px solid var(--border)', background: STATUS_BG[check.status] }}>
                            {/* Status icon */}
                            <div style={{ flexShrink: 0, width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: STATUS_COLOR[check.status], background: 'var(--surface)', border: `1px solid ${STATUS_COLOR[check.status]}`, marginTop: 1 }}>
                              {STATUS_ICON[check.status]}
                            </div>
                            {/* Content */}
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                                <span style={{ fontSize: 9, fontWeight: 600, color: 'var(--text4)', background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 2, padding: '1px 5px', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{check.control}</span>
                                <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>{check.title}</span>
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--text3)', lineHeight: 1.5 }}>{check.detail}</div>
                            </div>
                            {/* Metric */}
                            {check.metric && (
                              <div style={{ flexShrink: 0, fontSize: 11, fontWeight: 600, color: STATUS_COLOR[check.status], whiteSpace: 'nowrap', marginTop: 2 }}>
                                {check.metric}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </>
            ) : null}
          </div>
        )}
      </div>

      {/* ISO 27001 Document Links */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>
            ISO 27001 Compliance Documents
          </div>
          {/* CISO Assistant link — only shown when a CISO instance is configured
              (bring-your-own). CISO is not bundled by default. */}
          {cisoUrl && (
            <button
              onClick={() => window.open(cisoUrl, '_blank', 'noopener,noreferrer')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 500, color: 'var(--blue-t)', textDecoration: 'none', background: 'rgba(59,130,246,.07)', border: '1px solid rgba(59,130,246,.2)', borderRadius: 'var(--radius-sm)', padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit' }}>
              <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M7 1l3 2v4c0 2-1.5 3.5-3 4.5C4.5 10.5 3 9 3 7V3l3-2z"/><path d="M5 7l1.2 1.2L9 5"/></svg>
              Open CISO Assistant
            </button>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {[
            { doc: 'retention-policy',        title: 'Retention Policy',          ref: 'A.8.15', desc: 'Live retention config, purge schedule, and tamper-evidence controls.' },
            { doc: 'risk-assessment',          title: 'Risk Assessment',           ref: '6.1.2',  desc: 'Asset inventory, risk register, and live controls status.' },
            { doc: 'training-records',         title: 'Training Records',          ref: 'A.6.3',  desc: 'Staff awareness register. User list auto-populated.' },
            { doc: 'isms-policy',              title: 'ISMS Policy',               ref: '5.2',    desc: 'Information Security Policy skeleton. Requires management sign-off.' },
            { doc: 'statement-of-applicability', title: 'Statement of Applicability', ref: '6.1.3', desc: 'All 93 Annex A controls with live implementation counts.' },
          ].map(item => (
            <div key={item.doc} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text4)', background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 3, padding: '1px 5px', fontFamily: 'var(--font-mono)' }}>{item.ref}</span>
                <a href={`/api/docs/${item.doc}`} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: 11, color: 'var(--text2)', textDecoration: 'none', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', padding: '2px 8px' }}>
                  View →
                </a>
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 3 }}>{item.title}</div>
              <div style={{ fontSize: 11, color: 'var(--text3)', lineHeight: 1.5 }}>{item.desc}</div>
            </div>
          ))}
        </div>
        {/* Governance-layer note. When a CISO instance is connected (bring-your-
            own), point to it for the governance artefacts; otherwise explain that
            these documents above are Mosaic's own audit-backed evidence and that a
            GRC tool can optionally be connected in Settings → Keys. */}
        <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(59,130,246,.05)', border: '1px solid rgba(59,130,246,.15)', borderRadius: 'var(--radius)', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="var(--blue-t)" strokeWidth="1.6" style={{ marginTop: 1, flexShrink: 0 }}><circle cx="7" cy="7" r="5.5"/><path d="M7 6.5v3M7 4.5v.5"/></svg>
          <div style={{ fontSize: 11, color: 'var(--text3)', lineHeight: 1.6 }}>
            {cisoUrl ? (
              <>
                Go to{' '}
                <button onClick={() => window.open(cisoUrl, '_blank', 'noopener,noreferrer')} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--blue-t)', fontWeight: 500, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>CISO Assistant ↗</button>
                {' '}to view governance related artefacts (risk register, SoA sign-off, SOPs, supplier register).
              </>
            ) : (
              <>
                The documents above are Mosaic&rsquo;s own audit-backed compliance evidence (logging, encryption, RBAC, retention). For the governance layer — risk register, SoA sign-off, SOPs, supplier register — you can optionally connect a GRC tool such as CISO Assistant in Settings &rarr; Keys.
              </>
            )}
          </div>
        </div>
      </div>

      {/* Event list with pagination */}
      {loading && events.length === 0 ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spinner size={20} /></div>
      ) : events.length === 0 ? (
        <Card><div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>No audit events found for the selected filters.</div></Card>
      ) : (
        <>
          {/* Pagination controls — top */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>
              Page {page + 1} of {totalPages} · showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total.toLocaleString()}
            </span>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <Btn size="sm" onClick={() => setPage(0)} disabled={page === 0 || loading}>«</Btn>
              <Btn size="sm" onClick={() => setPage(p => p - 1)} disabled={page === 0 || loading}>‹ Prev</Btn>
              {/* Page number pills */}
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const startPage = Math.max(0, Math.min(page - 2, totalPages - 5))
                const p = startPage + i
                return (
                  <button key={p} onClick={() => setPage(p)} disabled={loading}
                    style={{ minWidth: 28, height: 26, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border2)', background: p === page ? 'var(--blue)' : 'var(--bg)', color: p === page ? '#fff' : 'var(--text3)', fontSize: 11, fontWeight: p === page ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit' }}>
                    {p + 1}
                  </button>
                )
              })}
              <Btn size="sm" onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1 || loading}>Next ›</Btn>
              <Btn size="sm" onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1 || loading}>»</Btn>
            </div>
          </div>

          <Card>
            {loading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Spinner size={20} /></div>
            ) : (
              events.map((ev, i) => {
                const isExpanded = expanded === ev.id
                const detail = (() => { try { return ev.detail ? JSON.parse(ev.detail) : null } catch { return ev.detail } })()
                return (
                  <div key={ev.id} style={{ borderBottom: i < events.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <div onClick={() => setExpanded(isExpanded ? null : ev.id)}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', cursor: 'pointer' }}>
                      <span style={{ fontSize: 11, color: 'var(--text3)', flexShrink: 0, minWidth: 130, fontFamily: 'var(--font-mono)' }}>{fmt(ev.timestamp)}</span>
                      <Badge label={ev.action} color={(ACTION_COLOR[ev.action] || 'gray') as 'green' | 'amber' | 'red' | 'blue' | 'gray'} />
                      <Badge label={ev.outcome} color={(OUTCOME_COLOR[ev.outcome] || 'gray') as 'green' | 'amber' | 'red' | 'blue' | 'gray'} />
                      <span style={{ fontSize: 12, color: 'var(--text2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {ev.actor_email || 'unauthenticated'}
                        {ev.actor_ip && <span style={{ color: 'var(--text4)', marginLeft: 6 }}>{ev.actor_ip}</span>}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>{ev.resource}</span>
                      <span style={{ color: 'var(--text4)', fontSize: 10, flexShrink: 0 }}>{isExpanded ? '▲' : '▼'}</span>
                    </div>
                    {isExpanded && (
                      <div style={{ padding: '0 16px 12px 16px', background: 'var(--bg2)' }}>
                        <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text3)', marginBottom: 6 }}>ID: {ev.id}</div>
                        {ev.actor_role && <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 4 }}>Role: {ev.actor_role}</div>}
                        {detail && (
                          <pre style={{ fontSize: 11, color: 'var(--text)', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', overflowX: 'auto', margin: 0, fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            {typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2)}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </Card>

          {/* Pagination controls — bottom */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 12 }}>
            <Btn size="sm" onClick={() => setPage(0)} disabled={page === 0 || loading}>«</Btn>
            <Btn size="sm" onClick={() => setPage(p => p - 1)} disabled={page === 0 || loading}>‹ Prev</Btn>
            <span style={{ fontSize: 11, color: 'var(--text3)', padding: '0 8px' }}>Page {page + 1} of {totalPages}</span>
            <Btn size="sm" onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1 || loading}>Next ›</Btn>
            <Btn size="sm" onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1 || loading}>»</Btn>
          </div>
        </>
      )}
    </div>
  )
}
