'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import type { SessionUser } from '@/lib/auth'
import { PageTitle, PageSub, Spinner } from './ui'

interface SetupStatus {
  anthropicKey:    { done: boolean }
  dataSource:      { done: boolean; count: number }
  users:           { done: boolean; count: number }
  notifications:   { done: boolean }
  allCriticalDone: boolean
  allDone:         boolean
}

const ITEMS = [
  {
    key: 'anthropicKey' as const,
    label: 'Anthropic API key',
    description: 'Required for all AI features. Without this, Mosaic cannot answer any queries.',
    critical: true,
    href: '#keys',
    action: 'Add key',
  },
  {
    key: 'dataSource' as const,
    label: 'Connect a data source',
    description: 'Add at least one database or API so Mosaic has something to query.',
    critical: true,
    href: '#data-sources',
    action: 'Add data source',
  },
  {
    key: 'users' as const,
    label: 'Invite team members',
    description: 'Create user accounts for the people who will use Mosaic.',
    critical: false,
    href: '#users',
    action: 'Manage users',
  },
  {
    key: 'notifications' as const,
    label: 'Configure notifications',
    description: 'Set up Slack, email or webhook channels for automated alerts and rule triggers.',
    critical: false,
    href: '#notifications',
    action: 'Configure',
  },
]

export default function TabSetup({ user }: { user: SessionUser }) {
  const router = useRouter()
  const [status, setStatus] = useState<SetupStatus | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/setup-status')
      .then(r => r.json())
      .then(d => setStatus(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function navigate(href: string) {
    window.location.hash = href.replace('#', '')
  }

  const criticalDone = status?.allCriticalDone ?? false
  const allDone = status?.allDone ?? false

  return (
    <div className="fade-in">
      <PageTitle>Setup</PageTitle>
      <PageSub>Complete these steps to get Mosaic ready for your team.</PageSub>

      {loading ? (
        <div style={{ padding: 48, display: 'flex', justifyContent: 'center' }}><Spinner size={20} /></div>
      ) : (
        <>
          {/* Progress summary */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '16px 20px', marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 3 }}>
                {allDone
                  ? 'Mosaic is fully configured'
                  : criticalDone
                    ? 'Mosaic is ready — recommended steps remaining'
                    : 'Complete required steps to activate Mosaic'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>
                {ITEMS.filter(i => status?.[i.key]?.done).length} of {ITEMS.length} steps complete
              </div>
            </div>
            {/* Progress bar */}
            <div style={{ width: 120, height: 6, background: 'var(--border2)', borderRadius: 99, overflow: 'hidden', flexShrink: 0 }}>
              <div style={{
                height: '100%',
                width: `${(ITEMS.filter(i => status?.[i.key]?.done).length / ITEMS.length) * 100}%`,
                background: allDone ? 'var(--green-t)' : criticalDone ? 'var(--accent-bg)' : 'var(--accent-bg)',
                borderRadius: 99,
                transition: 'width .3s ease',
              }} />
            </div>
          </div>

          {/* Required section */}
          <div style={{ marginBottom: 8, fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>Required</div>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', marginBottom: 24 }}>
            {ITEMS.filter(i => i.critical).map((item, idx, arr) => (
              <SetupRow
                key={item.key}
                item={item}
                done={status?.[item.key]?.done ?? false}
                last={idx === arr.length - 1}
                onNavigate={navigate}
              />
            ))}
          </div>

          {/* Recommended section */}
          <div style={{ marginBottom: 8, fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>Recommended</div>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
            {ITEMS.filter(i => !i.critical).map((item, idx, arr) => (
              <SetupRow
                key={item.key}
                item={item}
                done={status?.[item.key]?.done ?? false}
                last={idx === arr.length - 1}
                onNavigate={navigate}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function SetupRow({
  item, done, last, onNavigate
}: {
  item: typeof ITEMS[number]
  done: boolean
  last: boolean
  onNavigate: (href: string) => void
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '16px 20px',
      borderBottom: last ? 'none' : '1px solid var(--border)',
      gap: 16,
    }}>
      {/* Status dot + text */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flex: 1, minWidth: 0 }}>
        {/* Dot */}
        <div style={{
          width: 8, height: 8, borderRadius: '50%', flexShrink: 0, marginTop: 5,
          background: done ? 'var(--green-t)' : 'var(--border2)',
          border: done ? 'none' : '1.5px solid var(--text4)',
        }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: done ? 'var(--text3)' : 'var(--text)', marginBottom: 3, textDecoration: done ? 'none' : 'none' }}>
            {item.label}
            {done && <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--green-t)', fontWeight: 500 }}>Done</span>}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.5 }}>{item.description}</div>
        </div>
      </div>

      {/* Action */}
      {!done && (
        <button
          onClick={() => onNavigate(item.href)}
          style={{
            flexShrink: 0, padding: '6px 14px',
            background: 'var(--bg)', border: '1px solid var(--border2)',
            borderRadius: 'var(--radius-pill)', fontSize: 12, fontWeight: 500,
            color: 'var(--text)', cursor: 'pointer', fontFamily: 'inherit',
            whiteSpace: 'nowrap',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--text3)' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border2)' }}
        >
          {item.action}
        </button>
      )}
    </div>
  )
}
