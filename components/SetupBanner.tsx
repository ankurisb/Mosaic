'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface SetupStatus {
  allCriticalDone: boolean
  allDone: boolean
  anthropicKey:  { done: boolean }
  dataSource:    { done: boolean; count: number }
  users:         { done: boolean; count: number }
  notifications: { done: boolean }
}

// Shown only to admins while critical setup items remain incomplete.
// Dismissed per-session (sessionStorage). Auto-hides once allCriticalDone.
export default function SetupBanner({ isAdmin }: { isAdmin: boolean }) {
  const router = useRouter()
  const [status, setStatus]   = useState<SetupStatus | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!isAdmin) return
    if (typeof window !== 'undefined' && sessionStorage.getItem('setup-banner-dismissed') === '1') {
      setDismissed(true)
      return
    }
    fetch('/api/setup-status')
      .then(r => r.json())
      .then(d => setStatus(d))
      .catch(() => {})
  }, [isAdmin])

  function dismiss() {
    sessionStorage.setItem('setup-banner-dismissed', '1')
    setDismissed(true)
  }

  // Only show to admins with incomplete critical items, and not dismissed
  if (!isAdmin || dismissed || !status || status.allCriticalDone) return null

  // Build the pending items label
  const pending: string[] = []
  if (!status.anthropicKey.done) pending.push('Anthropic API key')
  if (!status.dataSource.done)   pending.push('data source')

  return (
    <div style={{
      background: 'var(--amber-bg)',
      borderBottom: '1px solid rgba(217,119,6,.2)',
      padding: '10px 24px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 16,
      fontSize: 13,
      color: 'var(--amber-t)',
      flexShrink: 0,
    }}>
      <span>
        Mosaic setup incomplete — {pending.join(' and ')} {pending.length === 1 ? 'is' : 'are'} required before your team can use it.
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <button
          onClick={() => router.push('/settings#setup')}
          style={{
            background: 'none', border: '1px solid rgba(217,119,6,.4)',
            borderRadius: 'var(--radius-pill)', padding: '4px 12px',
            fontSize: 12, fontWeight: 500, color: 'var(--amber-t)',
            cursor: 'pointer', fontFamily: 'inherit',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(217,119,6,.08)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
        >
          Go to setup
        </button>
        <button
          onClick={dismiss}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--amber-t)', opacity: 0.6, padding: '2px 4px',
            fontSize: 16, lineHeight: 1, fontFamily: 'inherit',
          }}
          onMouseEnter={e => { e.currentTarget.style.opacity = '1' }}
          onMouseLeave={e => { e.currentTarget.style.opacity = '0.6' }}
          title="Dismiss"
          aria-label="Dismiss setup banner"
        >
          ×
        </button>
      </div>
    </div>
  )
}
