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
        boxShadow: 'var(--shadow)', transition: 'background .15s',
        ...style,
      }}
    >
      {theme === 'light' ? '🌙' : '☀️'}
    </button>
  )
}
