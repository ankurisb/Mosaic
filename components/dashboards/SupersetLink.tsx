'use client'

import { useSuperset } from './useSuperset'

export function SupersetLink() {
  const { status, loading } = useSuperset()

  if (loading) return null
  if (!status?.configured) return null
  if (status.role !== 'admin') return null

  const isDown = status.reachable === false

  return (
    <a
      href={isDown ? undefined : status.url}
      target="_blank"
      rel="noopener noreferrer"
      title={isDown ? 'Analytics server unreachable' : 'Open FactoryOS Analytics'}
      aria-disabled={isDown}
      onClick={isDown ? (e) => e.preventDefault() : undefined}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '5px 12px',
        background: 'var(--bg)',
        border: '1px solid var(--border2)',
        borderRadius: 'var(--radius-pill)',
        fontSize: 12,
        fontWeight: 500,
        color: isDown ? 'var(--text4)' : 'var(--text2)',
        textDecoration: 'none',
        cursor: isDown ? 'not-allowed' : 'pointer',
        opacity: isDown ? 0.5 : 1,
        fontFamily: 'inherit',
      }}
    >
      <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
        <rect x="1" y="5" width="3" height="5" rx="0.5"/>
        <rect x="4.5" y="3" width="3" height="7" rx="0.5"/>
        <rect x="8" y="1" width="3" height="9" rx="0.5"/>
      </svg>
      Analytics
      <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
        <path d="M3.5 1.5H1.5a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-2"/>
        <path d="M5.5 1h3v3"/>
        <path d="M8.5 1 4 5.5"/>
      </svg>
    </a>
  )
}
