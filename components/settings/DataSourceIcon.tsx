'use client'
import { BRAND_ICONS } from './datasource-icons-data'

// Relative luminance of a #rrggbb colour (0..1) — detects near-black brand marks (GitHub, Notion)
// so their glyph stays visible in dark mode.
function isDark(hex?: string): boolean {
  if (!hex || hex[0] !== '#' || hex.length < 7) return false
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16)
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.22
}

// Clean generic (Lucide-style, stroked) glyphs used when a source has no brand logo — one per kind,
// so every tile shows a real icon rather than letters.
const GENERIC: Record<string, string> = {
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3"/>',
  api: '<path d="M8 3H7a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h1"/><path d="M16 3h1a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-1"/>',
  mcp: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v3a6 6 0 0 1-12 0V8z"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  connector: '<path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><line x1="8" y1="12" x2="16" y2="12"/>',
  prism: '<path d="M12 2 2 20h20z"/><path d="M12 2v18"/>',
}

// Connector logos ship at their own intrinsic size (e.g. width="250", height="824", "500pt"), which
// does not fit a small tile — so the raw SVG would be clipped to a blank corner. Normalise the root
// <svg>: guarantee a viewBox (derived from its own width/height when absent), strip the fixed
// width/height, and set the tile size so the art scales to fit (preserveAspectRatio centres it).
function fitSvg(raw: string, px: number): string {
  const m = raw.match(/<svg\b[^>]*>/i)
  if (!m) return raw
  let tag = m[0]
  if (!/viewBox\s*=/i.test(tag)) {
    const w = (tag.match(/\bwidth\s*=\s*["']?([\d.]+)/i) || [])[1]
    const h = (tag.match(/\bheight\s*=\s*["']?([\d.]+)/i) || [])[1]
    if (w && h) tag = tag.replace(/<svg\b/i, `<svg viewBox="0 0 ${w} ${h}"`)
  }
  tag = tag.replace(/\s(width|height)\s*=\s*(["'][^"']*["']|[\d.]+)/gi, '')
  tag = tag.replace(/<svg\b/i, `<svg width="${px}" height="${px}" preserveAspectRatio="xMidYMid meet"`)
  return raw.replace(m[0], tag)
}

// A data-source logo tile. In order: a raw brand SVG (`svg`, Airbyte connector logos from the local
// asset), a bundled brand glyph (`icon` → BRAND_ICONS, air-gap), or a generic glyph for `kind`.
// Chrome uses tokens; the brand colour is DATA.
export default function DataSourceIcon({ icon, color, name, size = 44, svg, kind = 'connector' }: { icon?: string; color?: string; name: string; size?: number; svg?: string; kind?: string }) {
  const dark = isDark(color)
  const brand = dark ? 'var(--text)' : (color || 'var(--text3)')
  const tileBase: React.CSSProperties = {
    width: size, height: size, flex: `0 0 ${size}px`, borderRadius: 'var(--radius)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  }

  // Connector logo (full-colour SVG) on a neutral tile, normalised to fit.
  if (svg) {
    const g = Math.round(size * 0.62)
    return (
      <div style={{ ...tileBase, background: 'var(--surface)', border: '1px solid var(--border)' }} aria-hidden>
        <span style={{ width: g, height: g, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text)' }} dangerouslySetInnerHTML={{ __html: fitSvg(svg, g) }} />
      </div>
    )
  }

  // Bundled brand glyph (filled) on a brand-tinted tile.
  const glyph = icon ? BRAND_ICONS[icon] : undefined
  if (glyph) {
    const tinted = color && !dark
    const g = Math.round(size * 0.56)
    return (
      <div style={{ ...tileBase, background: tinted ? `color-mix(in srgb, ${color} 12%, var(--surface))` : 'var(--bg3)', border: `1px solid ${tinted ? `color-mix(in srgb, ${color} 26%, var(--border))` : 'var(--border)'}` }} aria-hidden>
        <svg width={g} height={g} viewBox="0 0 24 24" fill={brand} role="img"><path d={glyph.path} /></svg>
      </div>
    )
  }

  // Generic glyph (stroked) for the source kind, on a neutral tile.
  const gen = GENERIC[kind] || GENERIC.connector
  const g = Math.round(size * 0.52)
  const stroke = color && !dark ? color : 'var(--text3)'
  return (
    <div style={{ ...tileBase, background: 'var(--bg3)', border: '1px solid var(--border)' }} aria-hidden>
      <svg width={g} height={g} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" role="img" dangerouslySetInnerHTML={{ __html: gen }} />
    </div>
  )
}
