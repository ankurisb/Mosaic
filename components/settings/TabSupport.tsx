'use client'
import { useState, useEffect, useRef } from 'react'
import type { SessionUser } from '@/lib/auth'
import { PageTitle, PageSub, Btn, Alert } from './ui'

interface SessionState {
  running: boolean
  url: string | null
  sessionId: string | null
  startedAt: string | null
  expiresAt: string | null
  error?: string
}

export default function TabSupport({ user }: { user: SessionUser }) {
  const [state,    setState]    = useState<SessionState | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [acting,   setActing]   = useState(false)
  const [error,    setError]    = useState('')
  const pollRef = useRef<NodeJS.Timeout | null>(null)

  async function fetchStatus() {
    try {
      const r = await fetch('/api/support-session')
      if (r.ok) setState(await r.json())
    } catch { /* silent — tunnel service may not be running */ }
    finally { setLoading(false) }
  }

  useEffect(() => {
    fetchStatus()
    // Poll every 15s while tab is open to keep expiry countdown live
    pollRef.current = setInterval(fetchStatus, 15_000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  async function start() {
    setActing(true); setError('')
    try {
      const r = await fetch('/api/support-session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      })
      const d = await r.json()
      if (!d.ok) { setError(d.error || 'Failed to start session'); return }
      setState({ running: true, url: d.url, sessionId: d.sessionId, startedAt: d.startedAt, expiresAt: d.expiresAt })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally { setActing(false) }
  }

  async function stop() {
    setActing(true); setError('')
    try {
      await fetch('/api/support-session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' }),
      })
      setState({ running: false, url: null, sessionId: null, startedAt: null, expiresAt: null })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally { setActing(false) }
  }

  function timeLeft(expiresAt: string | null) {
    if (!expiresAt) return ''
    const ms = new Date(expiresAt).getTime() - Date.now()
    if (ms <= 0) return 'Expired'
    const h = Math.floor(ms / 3_600_000)
    const m = Math.floor((ms % 3_600_000) / 60_000)
    return h > 0 ? `${h}h ${m}m remaining` : `${m}m remaining`
  }

  function fmt(iso: string | null) {
    if (!iso) return ''
    return new Date(iso).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
  }

  const tunnelUnavailable = !loading && state?.error === 'Tunnel service unavailable'

  return (
    <div className="fade-in">
      <PageTitle>Remote Support</PageTitle>
      <PageSub>Start a secure session so Mosaic support can diagnose issues remotely. You control when it starts and ends.</PageSub>

      {error && <div style={{ marginBottom: 16 }}><Alert variant="error">{error}</Alert></div>}

      {/* How it works */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '16px 20px', marginBottom: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 12 }}>How it works</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {[
            { n: '1', title: 'Start session', body: 'Click Start below. Mosaic opens a secure outbound tunnel — no firewall changes needed.' },
            { n: '2', title: 'Share session ID', body: 'Send the Session ID to Mosaic support via your existing support channel.' },
            { n: '3', title: 'End when done', body: 'Support sees your Mosaic UI only. Click End Session at any time to close it immediately.' },
          ].map(step => (
            <div key={step.n} style={{ display: 'flex', gap: 10 }}>
              <div style={{ flexShrink: 0, width: 22, height: 22, borderRadius: '50%', background: 'var(--blue)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>{step.n}</div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 3 }}>{step.title}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)', lineHeight: 1.5 }}>{step.body}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Security callout */}
      <div style={{ marginBottom: 20, padding: '10px 14px', background: 'rgba(59,130,246,.05)', border: '1px solid rgba(59,130,246,.15)', borderRadius: 'var(--radius)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="var(--blue-t)" strokeWidth="1.6" style={{ flexShrink: 0, marginTop: 1 }}><path d="M7 1l3 2v4c0 2-1.5 3.5-3 4.5C4.5 10.5 3 9 3 7V3l3-2z"/></svg>
        <div style={{ fontSize: 11, color: 'var(--text3)', lineHeight: 1.6 }}>
          <strong style={{ color: 'var(--text2)' }}>Outbound only.</strong> The tunnel opens from your server to Cloudflare's edge — no inbound ports are opened.
          Support can see your Mosaic interface only, not your OS, files, or other applications.
          Sessions auto-expire after 4 hours and are logged in the <strong style={{ color: 'var(--text2)' }}>Audit trail</strong>.
        </div>
      </div>

      {/* Session panel */}
      {tunnelUnavailable ? (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '24px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 4 }}>Tunnel service is not running</div>
          <div style={{ fontSize: 11, color: 'var(--text4)' }}>
            Check that <code style={{ background: 'var(--bg3)', padding: '1px 5px', borderRadius: 3, fontSize: 11 }}>mosaic-tunnel</code> is running:
            {' '}<code style={{ background: 'var(--bg3)', padding: '1px 5px', borderRadius: 3, fontSize: 11 }}>docker compose up -d mosaic-tunnel</code>
          </div>
        </div>
      ) : loading ? (
        <div style={{ padding: 40, display: 'flex', justifyContent: 'center' }}>
          <div style={{ width: 20, height: 20, border: '2px solid var(--border)', borderTopColor: 'var(--blue)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        </div>
      ) : state?.running ? (
        /* ── Active session ──────────────────────────── */
        <div style={{ background: 'var(--surface)', border: '1px solid rgba(22,163,74,.3)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
          {/* Status bar */}
          <div style={{ background: 'rgba(22,163,74,.08)', borderBottom: '1px solid rgba(22,163,74,.2)', padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--green)', flexShrink: 0 }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--green-t)' }}>Session active</span>
            </div>
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>{timeLeft(state.expiresAt)}</span>
          </div>

          <div style={{ padding: '16px 20px' }}>
            {/* Session ID — the only thing the customer needs to share */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>Session ID — share this with support</div>
              <div style={{ background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', padding: '10px 14px', fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, letterSpacing: 4, color: 'var(--text)', textAlign: 'center' }}>
                {state.sessionId}
              </div>
            </div>

            {/* Meta */}
            <div style={{ display: 'flex', gap: 20, fontSize: 11, color: 'var(--text4)', marginBottom: 20 }}>
              <span>Started: {fmt(state.startedAt)}</span>
              <span>Auto-expires: {fmt(state.expiresAt)}</span>
            </div>

            <Btn onClick={stop} disabled={acting} style={{ background: 'var(--red)', color: '#fff' }}>
              {acting ? 'Ending…' : 'End Session'}
            </Btn>
          </div>
        </div>
      ) : (
        /* ── No active session ───────────────────────── */
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '32px 24px', textAlign: 'center' }}>
          <div style={{ marginBottom: 6 }}>
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="var(--text4)" strokeWidth="1.5" style={{ margin: '0 auto 12px' }}>
              <path d="M16 3l7 4.5v9c0 4.5-3.5 8-7 10.5C12.5 24.5 9 21 9 16.5v-9L16 3z"/>
              <path d="M12 16l2.5 2.5L20 13"/>
            </svg>
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>No active support session</div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 24, maxWidth: 360, margin: '0 auto 24px' }}>
            Only start a session when asked to by Mosaic support. You can end it at any time.
          </div>
          <Btn onClick={start} disabled={acting}>
            {acting ? 'Starting tunnel…' : 'Start Remote Session'}
          </Btn>
          {acting && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 10 }}>Connecting to Cloudflare… this takes about 10 seconds</div>}
        </div>
      )}
    </div>
  )
}
