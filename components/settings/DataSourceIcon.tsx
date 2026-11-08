'use client'
import { BRAND_ICONS } from './datasource-icons-data'

// Relative luminance of a #rrggbb colour (0..1) — used to detect near-black brand marks
// (GitHub, Notion) so their glyph stays visible in dark mode.
function isDark(hex?: string): boolean {
  if (!hex || hex[0] !== '#' || hex.length < 7) return false
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16)
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.22
}

// A data-source logo tile. Three sources, in order: a raw brand SVG passed in (`svg`, used for
// Airbyte connector icons served from the local asset), a bundled brand glyph (`icon` → BRAND_ICONS,
// air-gap, no runtime fetch), or a monogram fallback. Chrome uses tokens; the brand colour is DATA.
export default function DataSourceIcon({ icon, color, name, size = 40, svg }: { icon?: string; color?: string; name: string; size?: number; svg?: string }) {
  const dark = isDark(color)
  const brand = dark ? 'var(--text)' : (color || 'var(--text3)')
  const tileBase: React.CSSProperties = {
    width: size, height: size, flex: `0 0 ${size}px`, borderRadius: 'var(--radius)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  }

  // Airbyte connector icon (full-colour SVG) on a neutral tile.
  if (svg) {
    const g = Math.round(size * 0.62)
    return (
      <div style={{ ...tileBase, background: 'var(--surface)', border: '1px solid var(--border)' }} aria-hidden>
        <span style={{ width: g, height: g, display: 'inline-flex' }} dangerouslySetInnerHTML={{ __html: svg }} />
      </div>
    )
  }

  const glyph = icon ? BRAND_ICONS[icon] : undefined
  const tinted = color && !dark
  const tile: React.CSSProperties = {
    ...tileBase,
    background: tinted ? `color-mix(in srgb, ${color} 12%, var(--surface))` : 'var(--bg3)',
    border: `1px solid ${tinted ? `color-mix(in srgb, ${color} 26%, var(--border))` : 'var(--border)'}`,
  }
  if (glyph) {
    const g = Math.round(size * 0.56)
    return (
      <div style={tile} aria-hidden>
        <svg width={g} height={g} viewBox="0 0 24 24" fill={brand} role="img"><path d={glyph.path} /></svg>
      </div>
    )
  }
  const mono = name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?'
  return (
    <div style={tile} aria-hidden>
      <span style={{ fontSize: Math.round(size * 0.34), fontWeight: 700, color: brand, letterSpacing: '.02em' }}>{mono}</span>
    </div>
  )
}
