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

  it('tags cubes with data_source when provided', () => {
    const c = generateCubeSchema(fields, 'conn-123')[0]
    expect(c.data_source).toBe('conn-123')
    expect(renderCubeJs(c)).toContain('data_source: `conn-123`')
  })

  it('omits data_source when not provided', () => {
    const c = generateCubeSchema(fields)[0]
    expect(c.data_source).toBeUndefined()
    expect(renderCubeJs(c)).not.toContain('data_source:')
  })

  it('emits a day-grain pre-aggregation when a time dimension + additive measures exist', () => {
    const js = renderCubeJs(generateCubeSchema(fields)[0])
    expect(js).toContain('pre_aggregations:')
    expect(js).toContain('time_dimension: production.ts')
    expect(js).toContain('granularity: `day`')
    expect(js).toContain('production.units')
    // Partitioned + incremental so refreshes don't full-scan the warehouse table.
    expect(js).toContain('partition_granularity: `month`')
    expect(js).toContain('incremental: true')
    expect(js).toContain('update_window: `7 day`')
  })

  it('emits no pre-aggregation when the cube has no time dimension', () => {
    const js = renderCubeJs(generateCubeSchema([
      F('t.v', { role: 'measure', default_aggregation: 'sum' }),
      F('t.k', { role: 'dimension', data_type: 'string' }),
    ])[0])
    expect(js).not.toContain('pre_aggregations:')
  })

  // Regression: a non-public schema yields `schema.table.column` object keys.
  // The cube must bind to the full `schema.table` and reference bare columns —
  // not treat the schema as the table (which produced sql_table=`plant` and an
  // uncompilable cube).
  it('handles schema-qualified tables (schema.table.column)', () => {
    const cubes = generateCubeSchema([
      F('plant.production_runs.units_produced', { role: 'measure', default_aggregation: 'sum', data_type: 'number' }),
      F('plant.production_runs.run_date', { role: 'time', data_type: 'timestamp' }),
      F('plant.production_runs', { role: null }),
    ], 'conn-xyz')
    expect(cubes).toHaveLength(1)
    const c = cubes[0]
    expect(c.sql_table).toBe('plant.production_runs')
    // members are the bare column names (what the query planner references via chart_config)
    expect(c.measures.map(m => m.name).sort()).toEqual(['count', 'units_produced'])
    expect(c.dimensions.map(d => d.name)).toEqual(['run_date'])
    const js = renderCubeJs(c)
    expect(js).toContain('sql_table: `plant.production_runs`')
    expect(js).toContain('units_produced')
  })

  // Cross-project BigQuery: when the data lives in a different project than the billing
  // project, introspection emits `dataProject.dataset.table.column` object keys. The cube
  // must bind to the full 3-part `dataProject.dataset.table` (the only form BigQuery resolves
  // across projects) and reference bare columns. Hyphenated project IDs stay intact inside
  // the rendered backticks.
  it('handles cross-project tables (project.dataset.table.column)', () => {
    const cubes = generateCubeSchema([
      F('bigquery-public-data.austin_bikeshare.bikeshare_trips.duration_minutes', { role: 'measure', default_aggregation: 'sum', data_type: 'number' }),
      F('bigquery-public-data.austin_bikeshare.bikeshare_trips.start_time', { role: 'time', data_type: 'timestamp' }),
      F('bigquery-public-data.austin_bikeshare.bikeshare_trips', { role: null }),
    ], 'conn-bq')
    expect(cubes).toHaveLength(1)
    const c = cubes[0]
    expect(c.sql_table).toBe('bigquery-public-data.austin_bikeshare.bikeshare_trips')
    expect(c.measures.map(m => m.name).sort()).toEqual(['count', 'duration_minutes'])
    expect(c.dimensions.map(d => d.name)).toEqual(['start_time'])
    const js = renderCubeJs(c)
    expect(js).toContain('sql_table: `bigquery-public-data.austin_bikeshare.bikeshare_trips`')
    // cube name is hash-namespaced and SQL-safe (hyphens/dots → underscores)
    expect(c.name).toMatch(/^s_[0-9a-f]{8}_bigquery_public_data_austin_bikeshare_bikeshare_trips$/)
  })
})
