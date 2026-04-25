'use client'
import React from 'react'
import { createContext, useContext, useEffect, useState } from 'react'

type Theme = 'light' | 'dark'
const ThemeCtx = createContext<{ theme: Theme; toggle: () => void }>({ theme: 'light', toggle: () => {} })

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Default to 'light' for the SSR pass; the inline script in app/layout.tsx
  // has already set <html data-theme> on the client before hydration runs.
  const [theme, setTheme] = useState<Theme>('light')

  useEffect(() => {
    // Read whatever the inline script wrote, so React state matches the DOM.
    const current = (document.documentElement.getAttribute('data-theme') as Theme | null)
      || (localStorage.getItem('theme') as Theme | null)
      || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    if (current !== theme) setTheme(current)
    document.documentElement.setAttribute('data-theme', current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function toggle() {
    setTheme(t => {
      const next: Theme = t === 'light' ? 'dark' : 'light'
      localStorage.setItem('theme', next)
      document.documentElement.setAttribute('data-theme', next)
      return next
    })
  }

  return <ThemeCtx.Provider value={{ theme, toggle }}>{children}</ThemeCtx.Provider>
}

export const useTheme = () => useContext(ThemeCtx)
