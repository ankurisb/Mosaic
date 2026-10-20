import { describe, it, expect } from 'vitest'
import { buildModel, deltaColumn, applySemanticModel, coerceStructured, hasStructured, type SemanticField } from './semantic-model'

const F = (object_key: string, extra: Partial<SemanticField> = {}): SemanticField => ({ object_key, ...extra })

describe('buildModel', () => {
  it('indexes by full key and by bare column', () => {
    const m = buildModel([F('meter.kWh', { role: 'measure' }), F('shift', { role: 'dimension' })])
    expect(m.byKey.get('meter.kWh')?.role).toBe('measure')
    expect(m.byColumn.get('kWh')?.role).toBe('measure')
    expect(m.byColumn.get('shift')?.role).toBe('dimension')
  })
})

describe('deltaColumn', () => {
  it('computes per-interval deltas, first point = 0', () => {
    const rows = [{ t: 1, e: 100 }, { t: 2, e: 130 }, { t: 3, e: 175 }]
    expect(deltaColumn(rows, 'e').map(r => r.e)).toEqual([0, 30, 45])
  })
  it('treats a counter reset (drop) as the current reading, not a negative spike', () => {
    const rows = [{ e: 900 }, { e: 950 }, { e: 20 }, { e: 60 }]  // reset between 950 and 20
    expect(deltaColumn(rows, 'e').map(r => r.e)).toEqual([0, 50, 20, 40])
  })
  it('deltas each series independently when grouped', () => {
    const rows = [
      { dev: 'A', e: 10 }, { dev: 'B', e: 100 },
      { dev: 'A', e: 25 }, { dev: 'B', e: 140 },
    ]
    expect(deltaColumn(rows, 'e', 'dev').map(r => r.e)).toEqual([0, 0, 15, 40])
  })
  it('leaves non-numeric values untouched', () => {
    const rows = [{ e: 'n/a' }, { e: 10 }, { e: 25 }]
    const out = deltaColumn(rows, 'e')
    expect(out[0].e).toBe('n/a'); expect(out[2].e).toBe(15)
  })
})

describe('coerceStructured', () => {
  it('accepts valid enums and clamps confidence', () => {
    const s = coerceStructured({ role: 'Measure', default_aggregation: 'SUM', accumulation: 'cumulative_counter', unit: 'kWh', status: 'proposed', confidence: 1.4 })
    expect(s.role).toBe('measure'); expect(s.default_aggregation).toBe('sum')
    expect(s.accumulation).toBe('cumulative_counter'); expect(s.unit).toBe('kWh')
    expect(s.status).toBe('proposed'); expect(s.confidence).toBe(1)
  })
  it('nulls invalid enums rather than storing junk', () => {
    const s = coerceStructured({ role: 'banana', default_aggregation: 'median', accumulation: 'xyz' })
    expect(s.role).toBeNull(); expect(s.default_aggregation).toBeNull(); expect(s.accumulation).toBeNull()
  })
  it('serialises evidence to bounded JSON and strips control chars from unit', () => {
    const s = coerceStructured({ unit: 'k\u0007Wh', evidence: { basis: 'name', samples: [1, 2] } })
    expect(s.unit).toBe('kWh')
    expect(s.evidence).toContain('"basis":"name"')
  })
  it('hasStructured is false for a description-only item', () => {
    expect(hasStructured(coerceStructured({}))).toBe(false)
    expect(hasStructured(coerceStructured({ role: 'measure' }))).toBe(true)
  })
})

describe('applySemanticModel', () => {
  const model = buildModel([
    F('meter.energy_kwh', { role: 'measure', unit: 'kWh', accumulation: 'cumulative_counter', status: 'verified' }),
    F('meter.day', { role: 'time', data_type: 'timestamp' }),
  ])

  it('deltas a cumulative counter that is the plotted y, and surfaces its unit', () => {
    const rows = [{ day: 'd1', energy_kwh: 1000 }, { day: 'd2', energy_kwh: 1240 }, { day: 'd3', energy_kwh: 1600 }]
    const r = applySemanticModel(rows, model, { chartType: 'line', chartConfig: { x: 'day', y: 'energy_kwh' } })
    expect(r.rows.map(x => x.energy_kwh)).toEqual([0, 240, 360])
    expect(r.meta.applied).toContain('delta:energy_kwh')
    expect(r.meta.units.energy_kwh).toBe('kWh')
    expect(r.meta.unverified).toEqual([])
  })

  it('does NOT delta a cumulative counter that is not actually plotted', () => {
    const rows = [{ day: 'd1', energy_kwh: 1000 }, { day: 'd2', energy_kwh: 1240 }]
    // y is something else → energy_kwh is not a plotted measure here
    const r = applySemanticModel(rows, model, { chartType: 'line', chartConfig: { x: 'day', y: 'day' } })
    expect(r.rows.map(x => x.energy_kwh)).toEqual([1000, 1240])  // untouched
    expect(r.meta.applied).toEqual([])
  })

  it('flags an unverified field that was used', () => {
    const m2 = buildModel([F('meter.energy_kwh', { role: 'measure', unit: 'kWh', accumulation: 'raw', status: 'proposed' })])
    const r = applySemanticModel([{ day: 'd1', energy_kwh: 5 }], m2, { chartConfig: { x: 'day', y: 'energy_kwh' } })
    expect(r.meta.unverified).toEqual(['energy_kwh'])
  })

  it('is a no-op with an empty model', () => {
    const rows = [{ a: 1 }, { a: 2 }]
    const r = applySemanticModel(rows, buildModel([]), {})
    expect(r.rows).toBe(rows); expect(r.meta.applied).toEqual([])
  })

  it('groups the delta by the chart series key', () => {
    const rows = [
      { day: 'd1', dev: 'A', energy_kwh: 10 }, { day: 'd1', dev: 'B', energy_kwh: 100 },
      { day: 'd2', dev: 'A', energy_kwh: 25 }, { day: 'd2', dev: 'B', energy_kwh: 160 },
    ]
    const r = applySemanticModel(rows, model, { chartConfig: { x: 'day', y: 'energy_kwh', series: 'dev' } })
    expect(r.rows.map(x => x.energy_kwh)).toEqual([0, 0, 15, 60])
  })
})
