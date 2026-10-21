import { describe, it, expect } from 'vitest'
import { generateCubeSchema, renderCubeJs } from './cube-schema'
import type { SemanticField } from './semantic-model'

const F = (object_key: string, extra: Partial<SemanticField>): SemanticField => ({ object_key, ...extra })

describe('generateCubeSchema', () => {
  const fields: SemanticField[] = [
    F('production.units', { role: 'measure', default_aggregation: 'sum', data_type: 'number', unit: 'units' }),
    F('production.oee', { role: 'measure', default_aggregation: 'avg', data_type: 'number', unit: '%' }),
    F('production.status', { role: 'measure', default_aggregation: 'last' }),   // last → not a native cube measure
    F('production.shift', { role: 'dimension', data_type: 'string' }),
    F('production.ts', { role: 'time', data_type: 'timestamp' }),
    F('production', { role: null }),   // table-level row → skipped
  ]
  it('builds one cube per table with mapped measures and dimensions', () => {
    const cubes = generateCubeSchema(fields)
    expect(cubes).toHaveLength(1)
    const c = cubes[0]
    expect(c.name).toBe('production')
    // units(sum) + oee(avg) + the always-on count; 'last' status is NOT a measure.
    expect(c.measures.map(m => m.name).sort()).toEqual(['count', 'oee', 'units'])
    expect(c.measures.find(m => m.name === 'units')?.type).toBe('sum')
    expect(c.measures.find(m => m.name === 'oee')?.type).toBe('avg')
    // shift (string) + ts (time)
    expect(c.dimensions.find(d => d.name === 'shift')?.type).toBe('string')
    expect(c.dimensions.find(d => d.name === 'ts')?.type).toBe('time')
  })

  it('maps count_distinct and skips a measure with no aggregation', () => {
    const cubes = generateCubeSchema([
      F('t.ops', { role: 'measure', default_aggregation: 'count_distinct' }),
      F('t.note', { role: 'measure', default_aggregation: 'none' }),
    ])
    const m = cubes[0].measures
    expect(m.find(x => x.name === 'ops')?.type).toBe('countDistinct')
    expect(m.find(x => x.name === 'note')).toBeUndefined()
  })

  it('renders valid-looking Cube JS', () => {
    const js = renderCubeJs(generateCubeSchema(fields)[0])
    expect(js).toContain('cube(`production`')
    expect(js).toContain('sql_table: `production`')
    expect(js).toContain('units: { sql: `units`, type: `sum` }')
    expect(js).toContain('ts: { sql: `ts`, type: `time` }')
    expect(js).toContain('count: { type: `count` }')
  })
})
