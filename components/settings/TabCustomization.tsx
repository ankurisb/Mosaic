'use client'
import { useState, useEffect, useCallback } from 'react'
import type { SessionUser } from '@/lib/auth'
import { useTheme, PALETTES, type Mode, type Palette } from '@/lib/theme'
import { fmtNumber, fmtDate } from '@/lib/format'
import { SEL, Btn } from './ui'
import { safeJson } from '@/lib/fetch'

// Small representative swatch sets for each palette, shown in the selector card so
// the choice is visible before applying. These mirror the token values in
// globals.css (page bg, surface, accent, a couple of chart-ish accents).
const PREVIEW: Record<Palette, { light: string[]; dark: string[] }> = {
  mosaic:    { light: ['#f5f5f5', '#ffffff', '#0f0f0f', '#2563eb', '#16a34a'], dark: ['#0a0a0a', '#141414', '#f0f0f0', '#60a5fa', '#22c55e'] },
  fluent:    { light: ['#ffffff', '#ffffff', '#0f6cbd', '#038387', '#b4009e'], dark: ['#1b1a19', '#252423', '#2899f5', '#39a0a3', '#c87fc4'] },
  aubergine: { light: ['#ffffff', '#ffffff', '#611f69', '#2eb67d', '#e01e5a'], dark: ['#1a1d21', '#222529', '#cd9ee6', '#2eb67d', '#36c5f0'] },
}
const swatchR = (id: Palette, big: boolean) => id === 'fluent' ? (big ? 4 : 3) : id === 'aubergine' ? (big ? 7 : 4) : (big ? 10 : 8)

// ── Deployment (admin) option lists ─────────────────────────────────────────
const FONT_FAMILIES = [
  { v: 'default', label: 'Default (Mosaic)' },
  { v: 'system',  label: 'System UI' },
  { v: 'neutral', label: 'Neutral — Arial / Helvetica' },
  { v: 'serif',   label: 'Serif — Georgia' },
]
const FONT_SIZES = [{ v: 'small', label: 'Small' }, { v: 'medium', label: 'Medium' }, { v: 'large', label: 'Large' }]
const UNITS = [{ v: 'metric', label: 'Metric (SI)' }, { v: 'imperial', label: 'US / Imperial' }]
const LANGUAGES = [
  ['match', "Match the user's language"], ['en', 'English'], ['de', 'German'], ['fr', 'French'],
  ['es', 'Spanish'], ['it', 'Italian'], ['pt', 'Portuguese'], ['nl', 'Dutch'], ['pl', 'Polish'],
  ['sv', 'Swedish'], ['tr', 'Turkish'], ['cs', 'Czech'], ['ro', 'Romanian'], ['hu', 'Hungarian'],
  ['ru', 'Russian'], ['uk', 'Ukrainian'], ['ar', 'Arabic'], ['he', 'Hebrew'], ['hi', 'Hindi'],
  ['bn', 'Bengali'], ['ta', 'Tamil'], ['zh', 'Chinese (Simplified)'], ['ja', 'Japanese'],
  ['ko', 'Korean'], ['vi', 'Vietnamese'], ['th', 'Thai'], ['id', 'Indonesian'], ['ms', 'Malay'],
] as const
const LOCALES = ['en-GB', 'en-US', 'en-IN', 'de-DE', 'fr-FR', 'es-ES', 'it-IT', 'pt-PT', 'pt-BR', 'nl-NL', 'pl-PL', 'ru-RU', 'ar-SA', 'hi-IN', 'zh-CN', 'ja-JP', 'ko-KR']

// Full IANA tz list when the runtime exposes it, else a sensible curated set.
function timezones(): string[] {
  try {
    const sv = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf
    if (sv) return sv('timeZone')
  } catch { /* fall through */ }
  return ['UTC', 'Europe/London', 'Europe/Berlin', 'Europe/Paris', 'Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Shanghai', 'Asia/Tokyo', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Sao_Paulo', 'Australia/Sydney']
}

const SAMPLE = new Date(2026, 9, 26, 22, 14)   // for the "1,234.5 · 26 Oct 2026" preview

const Label = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 3 }}>{children}</div>
)
const Hint = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontSize: 12.5, color: 'var(--text3)', marginBottom: 12, lineHeight: 1.5 }}>{children}</div>
)

export default function TabCustomization({ user }: { user?: SessionUser }) {
  const { theme, palette, setMode, setPalette } = useTheme()
  const isAdmin = user?.role === 'admin'

  // Deployment settings (kv_settings via /api/keys). Values are returned plainly.
  const [cfg, setCfg] = useState<Record<string, string>>({})
  const [toast, setToast] = useState('')
  const [savingKey, setSavingKey] = useState('')

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/keys'); const d = await r.json()
      const k = d.keys || {}
      setCfg({
        UI_FONT_FAMILY: k.UI_FONT_FAMILY?.value || 'default',
        UI_FONT_SIZE: k.UI_FONT_SIZE?.value || 'medium',
        MOSAIC_LOCALE: k.MOSAIC_LOCALE?.value || 'en-GB',
        MOSAIC_TIMEZONE: k.MOSAIC_TIMEZONE?.value || '',
        MOSAIC_RESPONSE_LANGUAGE: k.MOSAIC_RESPONSE_LANGUAGE?.value || 'match',
        MOSAIC_UNITS: k.MOSAIC_UNITS?.value || 'metric',
      })
    } catch { /* leave defaults */ }
  }, [])
  useEffect(() => { if (isAdmin) load() }, [isAdmin, load])
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 2500); return () => clearTimeout(t) } }, [toast])

  // Apply the visual settings to <html> immediately so font/size/format preview is
  // live without a reload (the server bakes the same attributes on next load).
  function applyLive(key: string, value: string) {
    const el = document.documentElement
    if (key === 'UI_FONT_FAMILY') { if (value && value !== 'default') el.setAttribute('data-font', value); else el.removeAttribute('data-font') }
    if (key === 'UI_FONT_SIZE') el.setAttribute('data-font-size', value || 'medium')
    if (key === 'MOSAIC_LOCALE') el.setAttribute('data-locale', value || 'en-GB')
    if (key === 'MOSAIC_TIMEZONE') { if (value) el.setAttribute('data-timezone', value); else el.removeAttribute('data-timezone') }
  }

  async function save(key: string, value: string) {
    setCfg(p => ({ ...p, [key]: value }))
    applyLive(key, value)
    setSavingKey(key)
    try {
      const r = await fetch('/api/keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'set', key, value }) })
      const { error } = await safeJson<{ ok?: boolean }>(r)
      setToast(error ? 'Error: ' + error : 'Saved')
    } catch (e) { setToast('Error: ' + (e instanceof Error ? e.message : 'failed')) }
    finally { setSavingKey('') }
  }

  const localeSample = (loc: string) => {
    try { return `${fmtNumber(1234.5, { locale: loc })} · ${fmtDate(SAMPLE, { locale: loc })}` } catch { return loc }
  }

  return (
    <div>
      <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 24, fontWeight: 500, color: 'var(--text)', margin: '0 0 6px' }}>Customization</h2>
      <p style={{ fontSize: 13.5, color: 'var(--text3)', margin: '0 0 28px', lineHeight: 1.6 }}>
        Personalize how Mosaic looks. Light/dark and theme are saved on this device; font, language and region are set for the whole deployment by an admin.
      </p>

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 2000, padding: '10px 18px', background: 'var(--green-bg)', border: '1px solid rgba(22,163,74,.2)', borderRadius: 'var(--radius)', fontSize: 13, color: 'var(--green-t)', fontWeight: 500, boxShadow: 'var(--shadow-lg)' }}>{toast}</div>
      )}

      {/* 1. Appearance (mode) — per-device */}
      <section style={{ marginBottom: 34 }}>
        <Label>Appearance</Label>
        <Hint>Switch between light and dark. Saved on this device.</Hint>
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

      {/* 2. Theme (palette) — per-device */}
      <section style={{ marginBottom: 34 }}>
        <Label>Theme</Label>
        <Hint>Choose the overall visual style. Applies across Mosaic.</Hint>
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
                <div style={{ height: 68, background: swatches[0], borderBottom: '1px solid var(--border)', padding: 12, display: 'flex', alignItems: 'flex-end', gap: 6 }}>
                  <div style={{ width: 40, height: 40, borderRadius: swatchR(p.id, true), background: swatches[1], boxShadow: '0 1px 4px rgba(0,0,0,0.15)' }} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: 1 }}>
                    <div style={{ height: 7, width: '70%', borderRadius: 99, background: swatches[2] }} />
                    <div style={{ display: 'flex', gap: 5 }}>
                      {swatches.slice(2).map((c, i) => <div key={i} style={{ width: 16, height: 16, borderRadius: swatchR(p.id, false), background: c }} />)}
                    </div>
                  </div>
                </div>
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

      {/* 3. Font — deployment-wide (admin) */}
      {isAdmin && (
        <section style={{ marginBottom: 34, paddingTop: 28, borderTop: '1px solid var(--border)' }}>
          <Label>Font</Label>
          <Hint>Set the typeface and base text size for everyone on this deployment. Fonts are system-safe, so they work offline / air-gapped.</Hint>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ minWidth: 260 }}>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>Typeface</div>
              <select style={{ ...SEL, width: '100%' }} value={cfg.UI_FONT_FAMILY || 'default'} onChange={e => save('UI_FONT_FAMILY', e.target.value)} disabled={savingKey === 'UI_FONT_FAMILY'}>
                {FONT_FAMILIES.map(f => <option key={f.v} value={f.v}>{f.label}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>Text size</div>
              <div style={{ display: 'inline-flex', gap: 4, padding: 4, background: 'var(--bg3)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                {FONT_SIZES.map(s => {
                  const on = (cfg.UI_FONT_SIZE || 'medium') === s.v
                  return (
                    <button key={s.v} onClick={() => save('UI_FONT_SIZE', s.v)}
                      style={{ padding: '7px 16px', borderRadius: 'calc(var(--radius) - 3px)', border: '1px solid ' + (on ? 'var(--border)' : 'transparent'), background: on ? 'var(--surface)' : 'transparent', color: on ? 'var(--text)' : 'var(--text2)', fontSize: 13, fontWeight: on ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit', boxShadow: on ? 'var(--shadow)' : 'none' }}>
                      {s.label}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 4. Language & region — deployment-wide (admin) */}
      {isAdmin && (
        <section style={{ paddingTop: 28, borderTop: '1px solid var(--border)' }}>
          <Label>Language &amp; region</Label>
          <Hint>Controls the language Mosaic answers in, how dates and numbers are formatted, the timezone timestamps render in, and the units Mosaic uses in its answers. Applies to the whole deployment.</Hint>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 18, maxWidth: 820 }}>
            <div>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>Response language</div>
              <select style={{ ...SEL, width: '100%' }} value={cfg.MOSAIC_RESPONSE_LANGUAGE || 'match'} onChange={e => save('MOSAIC_RESPONSE_LANGUAGE', e.target.value)}>
                {LANGUAGES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
              </select>
              <div style={{ fontSize: 11, color: 'var(--text4)', marginTop: 5 }}>What Mosaic writes its answers in. Data values and codes stay unchanged.</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>Number &amp; date format</div>
              <select style={{ ...SEL, width: '100%' }} value={cfg.MOSAIC_LOCALE || 'en-GB'} onChange={e => save('MOSAIC_LOCALE', e.target.value)}>
                {LOCALES.map(l => <option key={l} value={l}>{l} — {localeSample(l)}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>Timezone</div>
              <select style={{ ...SEL, width: '100%' }} value={cfg.MOSAIC_TIMEZONE || ''} onChange={e => save('MOSAIC_TIMEZONE', e.target.value)}>
                <option value="">Server default</option>
                {timezones().map(z => <option key={z} value={z}>{z}</option>)}
              </select>
              <div style={{ fontSize: 11, color: 'var(--text4)', marginTop: 5 }}>Timestamps in reports and dashboards render in this zone.</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6 }}>Units</div>
              <div style={{ display: 'inline-flex', gap: 4, padding: 4, background: 'var(--bg3)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                {UNITS.map(u => {
                  const on = (cfg.MOSAIC_UNITS || 'metric') === u.v
                  return (
                    <button key={u.v} onClick={() => save('MOSAIC_UNITS', u.v)}
                      style={{ padding: '7px 14px', borderRadius: 'calc(var(--radius) - 3px)', border: '1px solid ' + (on ? 'var(--border)' : 'transparent'), background: on ? 'var(--surface)' : 'transparent', color: on ? 'var(--text)' : 'var(--text2)', fontSize: 12.5, fontWeight: on ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit', boxShadow: on ? 'var(--shadow)' : 'none' }}>
                      {u.label}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
          <p style={{ fontSize: 11.5, color: 'var(--text4)', marginTop: 16, lineHeight: 1.5 }}>
            Language and units take effect on the next message; formatting and timezone apply as content re-renders.
          </p>
        </section>
      )}

      {!isAdmin && (
        <p style={{ fontSize: 12, color: 'var(--text4)', marginTop: 8 }}>Font, language and region are managed by an admin for the whole deployment.</p>
      )}
    </div>
  )
}
