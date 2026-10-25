'use client'
import React from 'react'
import { createContext, useContext, useEffect, useState } from 'react'

// Two independent axes:
//   - mode    ('light' | 'dark')   — the existing dark/light switch
//   - palette ('mosaic' | 'm365')  — the theme FAMILY (token set). 'mosaic' is the
//     default and sets no data-palette attribute (so the base :root tokens apply);
//     other palettes set data-palette="<name>" on <html>, which globals.css themes.
export type Mode = 'light' | 'dark'
export type Palette = 'mosaic' | 'm365'

export const PALETTES: { id: Palette; label: string; description: string }[] = [
  { id: 'mosaic', label: 'Mosaic', description: 'The default editorial theme — warm neutrals, serif headings.' },
  { id: 'm365', label: 'Microsoft 365', description: 'A Fluent-style theme — blue accent, Segoe typography, squared corners.' },
]

interface ThemeState {
  theme: Mode
  palette: Palette
  toggle: () => void
  setMode: (m: Mode) => void
  setPalette: (p: Palette) => void
}

const ThemeCtx = createContext<ThemeState>({
  theme: 'light', palette: 'mosaic', toggle: () => {}, setMode: () => {}, setPalette: () => {},
})

function applyPalette(p: Palette) {
  if (p === 'mosaic') document.documentElement.removeAttribute('data-palette')
  else document.documentElement.setAttribute('data-palette', p)
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Default to the SSR values; the inline script in app/layout.tsx has already set
  // <html data-theme>/<data-palette> on the client before hydration runs.
  const [theme, setThemeState] = useState<Mode>('light')
  const [palette, setPaletteState] = useState<Palette>('mosaic')

  useEffect(() => {
    const el = document.documentElement
    const mode = (el.getAttribute('data-theme') as Mode | null)
      || (localStorage.getItem('theme') as Mode | null)
      || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    const pal = (el.getAttribute('data-palette') as Palette | null)
      || (localStorage.getItem('palette') as Palette | null)
      || 'mosaic'
    if (mode !== theme) setThemeState(mode)
    if (pal !== palette) setPaletteState(pal)
    el.setAttribute('data-theme', mode)
    applyPalette(pal)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function setMode(next: Mode) {
    try { localStorage.setItem('theme', next) } catch { /* private mode */ }
    document.documentElement.setAttribute('data-theme', next)
    setThemeState(next)
  }
  function toggle() { setMode(theme === 'light' ? 'dark' : 'light') }
  function setPalette(next: Palette) {
    try { localStorage.setItem('palette', next) } catch { /* private mode */ }
    applyPalette(next)
    setPaletteState(next)
  }

  return <ThemeCtx.Provider value={{ theme, palette, toggle, setMode, setPalette }}>{children}</ThemeCtx.Provider>
}

export const useTheme = () => useContext(ThemeCtx)
