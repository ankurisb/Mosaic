'use client'
import { useTheme } from '@/lib/theme'

export default function ThemeToggle({ style }: { style?: React.CSSProperties }) {
  const { theme, toggle } = useTheme()
  return (
    <button
      onClick={toggle}
      title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 32, height: 32, borderRadius: 'var(--radius-pill)',
        border: '1px solid var(--border2)', background: 'var(--surface)',
        cursor: 'pointer', fontSize: 15, flexShrink: 0,
        color: 'var(--text2)',
        boxShadow: 'var(--shadow)', transition: 'background .15s',
        ...style,
      }}
    >
      {theme === 'light' ? (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
          <circle cx="7" cy="7" r="2.5"/>
          <path d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M3 3l1 1M10 10l1 1M3 11l1-1M10 4l1-1"/>
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
          <path d="M11.5 8.5A5 5 0 015.5 2.5a5.5 5.5 0 106 6z"/>
        </svg>
      )}
    </button>
  )
}
