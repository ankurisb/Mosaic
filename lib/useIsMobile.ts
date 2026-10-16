'use client'
import { useState, useEffect } from 'react'

// Shared phone-width detector for the mobile shells (chat, AppShell, settings).
// Returns false during SSR / first paint, then resolves on mount — callers must
// render a layout that is correct in both states (desktop-first, mobile as an
// override) so there's no hydration flash.
export function useIsMobile(breakpoint = 760): boolean {
  const [m, setM] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`)
    const on = () => setM(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [breakpoint])
  return m
}
