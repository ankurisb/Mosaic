import { describe, it, expect } from 'vitest'
import {
  cubeDialectSupported, isNativeAgg, cubeGranularity, shouldRouteToCube,
  toCubeQuery, parseCubeResult, buildDatasourceMap, measureAggsFor,
} from './cube-client'
import { buildModel } from './semantic-model'
import type { SemanticField } from './semantic-model'

const model = (fields: SemanticField[]) => buildModel(fields)

describe('cube-client: gates', () => {
  it('recognises Cube-supported dialects and rejects sqlite/mongo', () => {
    expect(cubeDialectSupported('postgres')).toBe(true)
    expect(cubeDialectSupported('PostgreSQL')).toBe(true)
    expect(cubeDialectSupported('mssql')).toBe(true)
    expect(cubeDialectSupported('sqlite')).toBe(false)
    expect(cubeDialectSupported('mongodb')).toBe(false)
    expect(cubeDialectSupported(null)).toBe(false)
  })
  it('native-agg gate matches Cube measure types only', () => {
    expect(isNativeAgg('sum')).toBe(true)
    expect(isNativeAgg('count_distinct')).toBe(true)
    expect(isNativeAgg('last')).toBe(false)
    expect(isNativeAgg('none')).toBe(false)
    expect(isNativeAgg(null)).toBe(false)
  })
  it('maps only native Cube granularities', () => {
    expect(cubeGranularity('1d')).toBe('day')
    expect(cubeGranularity('1h')).toBe('hour')
    expect(cubeGranularity('1mo')).toBe('month')
    expect(cubeGranularity('15m')).toBeNull()   // sub-hour → SQL rollup
    expect(cubeGranularity('6h')).toBeNull()
  })
})

describe('cube-client: shouldRouteToCube fails closed', () => {
  const base = { dialect: 'postgres', modelVerified: true, fingerprintCurrent: true, measureAggs: ['sum' as const] }
  it('routes when everything holds', () => {
    expect(shouldRouteToCube(base)).toEqual({ route: true, reason: 'ok' })
  })
  it('blocks unsupported dialect', () => {
    expect(shouldRouteToCube({ ...base, dialect: 'sqlite' }).route).toBe(false)
  })
  it('blocks unverified model', () => {
    expect(shouldRouteToCube({ ...base, modelVerified: false }).reason).toBe('model-unverified')
  })
  it('blocks schema drift', () => {
    expect(shouldRouteToCube({ ...base, fingerprintCurrent: false }).reason).toBe('schema-drift')
  })
  it('blocks a non-native measure', () => {
    expect(shouldRouteToCube({ ...base, measureAggs: ['sum', 'last'] }).reason).toBe('non-native-measure')
  })
  it('blocks when no measures', () => {
    expect(shouldRouteToCube({ ...base, measureAggs: [] }).reason).toBe('no-measures')
  })
})

describe('cube-client: toCubeQuery', () => {
  const m = model([])
  it('builds measures, series dimension, time dimension with granularity + range', () => {
    const q = toCubeQuery({ cube: 'production', cfg: { x: 'ts', y: 'units', series: 'shift', grain: '1d' }, timeFrom: '2026-01-01', timeTo: '2026-02-01' }, m)!
    expect(q.measures).toEqual(['production.units'])
    expect(q.dimensions).toEqual(['production.shift'])
    expect(q.timeDimensions).toEqual([{ dimension: 'production.ts', granularity: 'day', dateRange: ['2026-01-01', '2026-02-01'] }])
    expect(q.order).toEqual({ 'production.ts': 'asc' })
  })
  it('omits granularity for a non-native grain but keeps the range', () => {
    const q = toCubeQuery({ cube: 'p', cfg: { x: 'ts', y: 'v', grain: '15m' }, timeFrom: 'a', timeTo: 'b' }, m)!
    expect(q.timeDimensions[0].granularity).toBeUndefined()
    expect(q.timeDimensions[0].dateRange).toEqual(['a', 'b'])
  })
  it('returns null when there are no measures', () => {
    expect(toCubeQuery({ cube: 'p', cfg: { x: 'ts' } }, m)).toBeNull()
  })
})

describe('cube-client: parseCubeResult', () => {
  it('flattens member keys and collapses the granularity suffix', () => {
    const rows = parseCubeResult({ data: [
      { 'production.units': 10, 'production.shift': 'A', 'production.ts.day': '2026-01-01T00:00:00.000' },
      { 'production.units': 20, 'production.shift': 'B', 'production.ts.day': '2026-01-02T00:00:00.000' },
    ] }, 'production')
    expect(rows).toEqual([
      { units: 10, shift: 'A', ts: '2026-01-01T00:00:00.000' },
      { units: 20, shift: 'B', ts: '2026-01-02T00:00:00.000' },
    ])
  })
  it('returns [] on malformed input', () => {
    expect(parseCubeResult(null, 'p')).toEqual([])
    expect(parseCubeResult({}, 'p')).toEqual([])
  })
})

describe('cube-client: buildDatasourceMap', () => {
  it('maps supported dialects, omits sqlite, injects passwords, normalises type', () => {
    const map = buildDatasourceMap(
      [
        { id: 'c1', dialect: 'postgresql', host: 'h1', port: 5432, database_name: 'db1', username: 'u1' },
        { id: 'c2', dialect: 'sqlserver', host: 'h2', port: 1433, database_name: 'db2', username: 'u2' },
        { id: 'c3', dialect: 'sqlite', database_name: 'local.db' },
      ],
      (id) => (id === 'c1' ? 'secret1' : undefined),
    )
    expect(Object.keys(map).sort()).toEqual(['c1', 'c2'])
    expect(map.c1).toEqual({ type: 'postgres', host: 'h1', port: 5432, database: 'db1', user: 'u1', password: 'secret1' })
    expect(map.c2.type).toBe('mssql')
    expect(map.c3).toBeUndefined()
  })
})

describe('cube-client: measureAggsFor', () => {
  it('resolves declared aggregations of the plotted measures', () => {
    const m = model([
      { object_key: 'production.units', role: 'measure', default_aggregation: 'sum' },
      { object_key: 'production.status', role: 'measure', default_aggregation: 'last' },
    ])
    expect(measureAggsFor({ y: 'units', value: 'status' }, m)).toEqual(['sum', 'last'])
  })
})
