'use client'
import React from 'react'
import { createContext, useContext, useEffect, useState } from 'react'

// Two independent axes:
//   mode    — 'light' | 'dark'   (per device)
//   palette — colour family       (per device). 'default' is the Atlassian-style
//             base theme (no data-palette attribute); alternates live in
//             app/globals.css as [data-palette="…"] blocks.
export type Mode = 'light' | 'dark'
export type Palette = 'default' | 'editorial' | 'graphite'
export const PALETTES: Palette[] = ['default', 'editorial', 'graphite']

interface ThemeState {
  theme: Mode
  palette: Palette
  toggle: () => void
  setMode: (m: Mode) => void
  setPalette: (p: Palette) => void
}

const ThemeCtx = createContext<ThemeState>({
  theme: 'light', palette: 'default', toggle: () => {}, setMode: () => {}, setPalette: () => {},
})

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Default to the SSR value; the inline script in app/layout.tsx has already set
  // <html data-theme> / data-palette on the client before hydration runs.
  const [theme, setThemeState] = useState<Mode>('light')
  const [palette, setPaletteState] = useState<Palette>('default')

  useEffect(() => {
    const el = document.documentElement
    const mode = (el.getAttribute('data-theme') as Mode | null)
      || (localStorage.getItem('theme') as Mode | null)
      || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    if (mode !== theme) setThemeState(mode)
    el.setAttribute('data-theme', mode)

    // Mirror the saved palette into React state (the inline script already applied
    // the attribute pre-hydration, so there is no flash).
    let raw = el.getAttribute('data-palette') as string | null
    if (!raw) { try { raw = localStorage.getItem('palette') } catch { raw = null } }
    if (raw === 'ramp') raw = 'graphite'   // legacy rename (was briefly shipped as "ramp")
    const p: Palette = raw === 'editorial' || raw === 'graphite' ? raw : 'default'
    if (p !== 'default') el.setAttribute('data-palette', p); else el.removeAttribute('data-palette')
    if (p !== palette) setPaletteState(p)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function setMode(next: Mode) {
    try { localStorage.setItem('theme', next) } catch { /* private mode */ }
    document.documentElement.setAttribute('data-theme', next)
    setThemeState(next)
  }
  function toggle() { setMode(theme === 'light' ? 'dark' : 'light') }

  function setPalette(next: Palette) {
    const el = document.documentElement
    try {
      if (next === 'default') localStorage.removeItem('palette')
      else localStorage.setItem('palette', next)
    } catch { /* private mode */ }
    if (next === 'default') el.removeAttribute('data-palette')
    else el.setAttribute('data-palette', next)
    setPaletteState(next)
  }

  return <ThemeCtx.Provider value={{ theme, palette, toggle, setMode, setPalette }}>{children}</ThemeCtx.Provider>
}

export const useTheme = () => useContext(ThemeCtx)
