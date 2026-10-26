'use client'
import { useTheme, PALETTES, type Mode, type Palette } from '@/lib/theme'

// Small representative swatch sets for each palette, shown in the selector card so
// the choice is visible before applying. These mirror the token values in
// globals.css (page bg, surface, accent, a couple of chart-ish accents).
const PREVIEW: Record<Palette, { light: string[]; dark: string[] }> = {
  mosaic:    { light: ['#f5f5f5', '#ffffff', '#0f0f0f', '#2563eb', '#16a34a'], dark: ['#0a0a0a', '#141414', '#f0f0f0', '#60a5fa', '#22c55e'] },
  fluent:    { light: ['#ffffff', '#ffffff', '#0f6cbd', '#038387', '#b4009e'], dark: ['#1b1a19', '#252423', '#2899f5', '#39a0a3', '#c87fc4'] },
  aubergine: { light: ['#ffffff', '#ffffff', '#611f69', '#2eb67d', '#e01e5a'], dark: ['#1a1d21', '#222529', '#cd9ee6', '#2eb67d', '#36c5f0'] },
}

// Preview swatch corner rounding per palette (mirrors each theme's --radius feel).
const swatchR = (id: Palette, big: boolean) => id === 'fluent' ? (big ? 4 : 3) : id === 'aubergine' ? (big ? 7 : 4) : (big ? 10 : 8)

export default function TabCustomization() {
  const { theme, palette, setMode, setPalette } = useTheme()

  return (
    <div>
      <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 24, fontWeight: 500, color: 'var(--text)', margin: '0 0 6px' }}>Customization</h2>
      <p style={{ fontSize: 13.5, color: 'var(--text3)', margin: '0 0 28px', lineHeight: 1.6 }}>
        Personalize how Mosaic looks. These settings are saved on this device.
      </p>

      {/* 1. Appearance (mode) — the first setting */}
      <section style={{ marginBottom: 34 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 3 }}>Appearance</div>
        <div style={{ fontSize: 12.5, color: 'var(--text3)', marginBottom: 12 }}>Switch between light and dark.</div>
        <div style={{ display: 'inline-flex', gap: 4, padding: 4, background: 'var(--bg3)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
          {([['light', 'Light'], ['dark', 'Dark']] as [Mode, string][]).map(([m, label]) => (
            <button key={m} onClick={() => setMode(m)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 16px', borderRadius: 'calc(var(--radius) - 3px)',
                border: '1px solid ' + (theme === m ? 'var(--border)' : 'transparent'),
                background: theme === m ? 'var(--surface)' : 'transparent',
                color: theme === m ? 'var(--text)' : 'var(--text2)',
                fontSize: 13, fontWeight: theme === m ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit',
                boxShadow: theme === m ? 'var(--shadow)' : 'none', transition: 'all .12s',
              }}>
              {m === 'light'
                ? <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><circle cx="7" cy="7" r="2.5"/><path d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M3 3l1 1M10 10l1 1M3 11l1-1M10 4l1-1"/></svg>
                : <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M11.5 8.5A5 5 0 015.5 2.5a5.5 5.5 0 106 6z"/></svg>}
              {label}
            </button>
          ))}
        </div>
      </section>

      {/* 2. Theme (palette) */}
      <section>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 3 }}>Theme</div>
        <div style={{ fontSize: 12.5, color: 'var(--text3)', marginBottom: 14 }}>Choose the overall visual style. Applies across Mosaic.</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
          {PALETTES.map(p => {
            const selected = palette === p.id
            const swatches = PREVIEW[p.id][theme]
            return (
              <button key={p.id} onClick={() => setPalette(p.id)}
                style={{
                  textAlign: 'left', padding: 0, overflow: 'hidden', cursor: 'pointer', fontFamily: 'inherit',
                  background: 'var(--surface)',
                  border: '1.5px solid ' + (selected ? 'var(--accent)' : 'var(--border)'),
                  borderRadius: 'var(--radius)', boxShadow: selected ? 'var(--shadow-md)' : 'var(--shadow)', transition: 'all .12s',
                }}>
                {/* preview band */}
                <div style={{ height: 68, background: swatches[0], borderBottom: '1px solid var(--border)', padding: 12, display: 'flex', alignItems: 'flex-end', gap: 6 }}>
                  <div style={{ width: 40, height: 40, borderRadius: swatchR(p.id, true), background: swatches[1], boxShadow: '0 1px 4px rgba(0,0,0,0.15)' }} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: 1 }}>
                    <div style={{ height: 7, width: '70%', borderRadius: 99, background: swatches[2] }} />
                    <div style={{ display: 'flex', gap: 5 }}>
                      {swatches.slice(2).map((c, i) => <div key={i} style={{ width: 16, height: 16, borderRadius: swatchR(p.id, false), background: c }} />)}
                    </div>
                  </div>
                </div>
                {/* label row */}
                <div style={{ padding: '11px 13px', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      {p.label}
                      {p.id === 'mosaic' && <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', background: 'var(--bg3)', border: '1px solid var(--border)', padding: '1px 6px', borderRadius: 999 }}>Default</span>}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 3, lineHeight: 1.45 }}>{p.description}</div>
                  </div>
                  <span style={{
                    flexShrink: 0, width: 18, height: 18, borderRadius: 999, marginTop: 1,
                    border: '1.5px solid ' + (selected ? 'var(--accent)' : 'var(--border2)'),
                    background: selected ? 'var(--accent)' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {selected && <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="var(--accent-fg)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 6.5l2.5 2.5 4.5-5"/></svg>}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
        <p style={{ fontSize: 11.5, color: 'var(--text4)', marginTop: 14, lineHeight: 1.5 }}>
          Note: embedded Superset dashboards and map tiles render in their own frames and keep their own styling.
        </p>
      </section>
    </div>
  )
}
