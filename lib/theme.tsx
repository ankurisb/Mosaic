'use client'
import React from 'react'
import { createContext, useContext, useEffect, useState } from 'react'

// Single theme family (the Atlassian-style default, defined in app/globals.css).
// Only one axis remains: mode ('light' | 'dark'). The old palette selector
// (mosaic/fluent/aubergine) was removed — see DESIGN_SYSTEM.md.
export type Mode = 'light' | 'dark'

interface ThemeState {
  theme: Mode
  toggle: () => void
  setMode: (m: Mode) => void
}

const ThemeCtx = createContext<ThemeState>({
  theme: 'light', toggle: () => {}, setMode: () => {},
})

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Default to the SSR value; the inline script in app/layout.tsx has already set
  // <html data-theme> on the client before hydration runs.
  const [theme, setThemeState] = useState<Mode>('light')

  useEffect(() => {
    const el = document.documentElement
    const mode = (el.getAttribute('data-theme') as Mode | null)
      || (localStorage.getItem('theme') as Mode | null)
      || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    if (mode !== theme) setThemeState(mode)
    el.setAttribute('data-theme', mode)
    // The palette selector is gone: clear any palette a user picked before so
    // everyone lands on the single default theme (no one stranded on an old look).
    try { localStorage.removeItem('palette') } catch { /* private mode */ }
    el.removeAttribute('data-palette')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function setMode(next: Mode) {
    try { localStorage.setItem('theme', next) } catch { /* private mode */ }
    document.documentElement.setAttribute('data-theme', next)
    setThemeState(next)
  }
  function toggle() { setMode(theme === 'light' ? 'dark' : 'light') }

  return <ThemeCtx.Provider value={{ theme, toggle, setMode }}>{children}</ThemeCtx.Provider>
}

export const useTheme = () => useContext(ThemeCtx)
