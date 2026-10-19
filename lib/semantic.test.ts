import { describe, it, expect } from 'vitest'
import { annotateTableLine, columnGloss, hasAnyHints, type SchemaHints } from './semantic'

const hints: SchemaHints = new Map<string, string>([
  ['orders', 'customer purchase orders'],
  ['orders.cycle_time_s', 'order fulfilment time in seconds'],
  ['readings.kWh_sf', 'scaling factor applied to kWh'],
  ['readings.v1n', 'phase-1 line-to-neutral voltage'],
])

describe('annotateTableLine', () => {
  it('appends the table description when present', () => {
    expect(annotateTableLine('orders(id*:int)', 'orders', hints))
      .toBe('orders(id*:int)  — customer purchase orders')
  })
  it('returns the line unchanged when no hint', () => {
    expect(annotateTableLine('widgets(id*:int)', 'widgets', hints))
      .toBe('widgets(id*:int)')
  })
  it('returns the line unchanged with an empty hint map', () => {
    expect(annotateTableLine('orders(id*:int)', 'orders', new Map()))
      .toBe('orders(id*:int)')
  })
})

describe('columnGloss', () => {
  it('glosses only the columns that have descriptions', () => {
    const g = columnGloss('readings', ['ts', 'kWh_sf', 'v1n', 'kW'], hints)
    expect(g).toContain('kWh_sf = scaling factor applied to kWh')
    expect(g).toContain('v1n = phase-1 line-to-neutral voltage')
    expect(g).not.toContain('ts =')
    expect(g).not.toContain('kW =')
    expect(g.startsWith('        cols: ')).toBe(true)
  })
  it('returns empty string when no column in the table is described', () => {
    expect(columnGloss('widgets', ['a', 'b'], hints)).toBe('')
  })
  it('returns empty string when the hint map is empty (adds nothing to the prompt)', () => {
    expect(columnGloss('readings', ['kWh_sf'], new Map())).toBe('')
  })
  it('respects a custom indent', () => {
    const g = columnGloss('orders', ['cycle_time_s'], hints, '  ')
    expect(g).toBe('  cols: cycle_time_s = order fulfilment time in seconds')
  })
})

describe('clip (via columnGloss)', () => {
  it('truncates an over-long description to ~120 chars with an ellipsis', () => {
    const long = 'x'.repeat(300)
    const m: SchemaHints = new Map([['t.c', long]])
    const g = columnGloss('t', ['c'], m)
    // "        cols: c = " prefix + <=120 chars + ellipsis
    const val = g.split(' = ')[1]
    expect(val.length).toBeLessThanOrEqual(120)
    expect(val.endsWith('…')).toBe(true)
  })
})

describe('hasAnyHints', () => {
  it('is true only for a non-empty map', () => {
    expect(hasAnyHints(hints)).toBe(true)
    expect(hasAnyHints(new Map())).toBe(false)
    expect(hasAnyHints(null)).toBe(false)
    expect(hasAnyHints(undefined)).toBe(false)
  })
})
