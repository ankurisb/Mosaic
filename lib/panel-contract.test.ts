import { describe, it, expect } from 'vitest'
import { windowResponsive, validateChartShape, buildLineage } from './panel-contract'

describe('windowResponsive (#5 foot-gun)', () => {
  it('SQL/API panels are responsive only if they carry the time placeholder', () => {
    expect(windowResponsive('database', 'SELECT * FROM t WHERE ts >= {{time_from}}')).toBe(true)
    expect(windowResponsive('database', 'SELECT * FROM t')).toBe(false)           // ignores the window silently
    expect(windowResponsive('api', '/odata/x?$filter=ts ge {{time_from}}')).toBe(true)
    expect(windowResponsive('api', '/odata/x')).toBe(false)
  })
  it('PRISM and file always window (or have none) → never flagged', () => {
    expect(windowResponsive('prism', '{"op":"telemetry_history"}')).toBe(true)
    expect(windowResponsive('file_server', 'report.csv')).toBe(true)
  })
})

describe('validateChartShape', () => {
  const series = [{ d: 'd1', v: 10 }, { d: 'd2', v: 20 }]
  it('passes a well-formed line chart', () => {
    const r = validateChartShape('line', series, { x: 'd', y: 'v' })
    expect(r.ok).toBe(true); expect(r.errors).toEqual([])
  })
  it('errors a line chart with no numeric column', () => {
    const r = validateChartShape('line', [{ a: 'x', b: 'y' }], {})
    expect(r.ok).toBe(false); expect(r.errors[0]).toMatch(/numeric/)
  })
  it('errors when a configured column is absent', () => {
    const r = validateChartShape('line', series, { x: 'd', y: 'missing' })
    expect(r.ok).toBe(false); expect(r.errors.some(e => e.includes('missing'))).toBe(true)
  })
  it('warns on high-cardinality donut', () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ cat: 'c' + i, v: i }))
    const r = validateChartShape('donut', rows, { x: 'cat', y: 'v' })
    expect(r.warnings.some(w => /cardinality/i.test(w))).toBe(true)
  })
  it('warns (not errors) on an empty result', () => {
    const r = validateChartShape('bar', [], {})
    expect(r.ok).toBe(true); expect(r.warnings[0]).toMatch(/No rows/)
  })
  it('table accepts anything', () => {
    expect(validateChartShape('table', [{ a: 'x' }], {}).ok).toBe(true)
  })
})

describe('buildLineage', () => {
  it('captures how a value was produced', () => {
    const l = buildLineage({ sourceType: 'database', sourceId: 's1', window: '7d', transforms: ['delta:kwh', 'rollup:1d'], measures: ['kwh'] })
    expect(l).toMatchObject({ source_type: 'database', window: '7d', transforms: ['delta:kwh', 'rollup:1d'] })
  })
})
