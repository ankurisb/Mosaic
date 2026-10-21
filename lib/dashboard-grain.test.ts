import { describe, it, expect } from 'vitest'
import { allowedGrains, defaultGrain, clampGrain, windowMsFor } from './dashboard-grain'

describe('dashboard-grain: allowedGrains', () => {
  it('forbids 5m on a 7-day window (the headline rule)', () => {
    const g = allowedGrains(windowMsFor('7d'))
    expect(g).not.toContain('5m')
    expect(g).not.toContain('15m')
    expect(g).toContain('1h')
    expect(g).toContain('1d')
  })
  it('15m window only allows sub-window grains', () => {
    expect(allowedGrains(windowMsFor('15m'))).toEqual(['1m', '5m'])
  })
  it('24h window offers minute-to-hour grains, not 1m or 1d', () => {
    const g = allowedGrains(windowMsFor('24h'))
    expect(g).not.toContain('1m')   // 1440 buckets, too many
    expect(g).toContain('15m'); expect(g).toContain('1h')
    expect(g).not.toContain('1d')   // 1 bucket, degenerate
  })
  it('1-year window only allows coarse grains', () => {
    const g = allowedGrains(windowMsFor('1y'))
    expect(g).toEqual(['1d', '1w', '1mo'])
  })
  it('never returns empty (all-time → month)', () => {
    expect(allowedGrains(windowMsFor('all')).length).toBeGreaterThan(0)
  })
})

describe('dashboard-grain: defaultGrain', () => {
  it('picks a sensible default per window', () => {
    expect(defaultGrain(windowMsFor('15m'))).toBe('1m')
    expect(defaultGrain(windowMsFor('7d'))).toBe('1h')
    expect(defaultGrain(windowMsFor('30d'))).toBe('6h')
    expect(allowedGrains(windowMsFor('24h'))).toContain(defaultGrain(windowMsFor('24h')))
  })
})

describe('dashboard-grain: clampGrain', () => {
  it('clamps a too-fine grain up to the finest allowed', () => {
    // 5m on 7d is too fine → clamp to the finest allowed (30m)
    expect(clampGrain('5m', windowMsFor('7d'))).toBe('30m')
  })
  it('passes an allowed grain through', () => {
    expect(clampGrain('1h', windowMsFor('7d'))).toBe('1h')
  })
  it('clamps a too-coarse grain down to the coarsest allowed', () => {
    expect(clampGrain('1mo', windowMsFor('15m'))).toBe('5m')
  })
  it('returns null for an unknown grain', () => {
    expect(clampGrain('banana', windowMsFor('7d'))).toBeNull()
    expect(clampGrain(null, windowMsFor('7d'))).toBeNull()
  })
})

describe('dashboard-grain: windowMsFor custom', () => {
  it('computes duration from custom dates', () => {
    const ms = windowMsFor('custom', '2026-01-01', '2026-01-08')
    expect(ms).toBe(7 * 86400e3)
    expect(allowedGrains(ms)).not.toContain('5m')
  })
})
