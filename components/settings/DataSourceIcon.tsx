'use client'
import { BRAND_ICONS } from './datasource-icons-data'

// A data-source logo tile: the bundled brand glyph (air-gap, no runtime fetch) on a subtly
// brand-tinted surface, or a monogram fallback for sources without a bundled glyph (e.g. SQL
// Server, generic REST API, MCP). The brand colour is DATA (from the catalog registry /
// simple-icons), consumed here — not a hard-coded chrome literal; all chrome uses tokens.
export default function DataSourceIcon({ icon, color, name, size = 40 }: { icon?: string; color?: string; name: string; size?: number }) {
  const brand = color || 'var(--text3)'
  const glyph = icon ? BRAND_ICONS[icon] : undefined
  const tile: React.CSSProperties = {
    width: size,
    height: size,
    flex: `0 0 ${size}px`,
    borderRadius: 'var(--radius)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: color ? `color-mix(in srgb, ${brand} 12%, var(--surface))` : 'var(--bg3)',
    border: `1px solid ${color ? `color-mix(in srgb, ${brand} 26%, var(--border))` : 'var(--border)'}`,
    overflow: 'hidden',
  }
  if (glyph) {
    const g = Math.round(size * 0.56)
    return (
      <div style={tile} aria-hidden>
        <svg width={g} height={g} viewBox="0 0 24 24" fill={brand} role="img"><path d={glyph.path} /></svg>
      </div>
    )
  }
  // Monogram fallback: first two significant characters of the name.
  const mono = name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?'
  return (
    <div style={tile} aria-hidden>
      <span style={{ fontSize: Math.round(size * 0.34), fontWeight: 700, color: brand, letterSpacing: '.02em' }}>{mono}</span>
    </div>
  )
}
