// lib/cube-schema.ts
// Phase 5: generate a Cube (cube.dev) data model from the semantic model, so DB
// sources can be queried through Cube — deterministic measures/dimensions/time
// dimensions + pre-aggregation/caching — while the semantic model stays the single
// source of truth (Cube files are a generated artifact). Pure + unit-testable; the
// Cube SERVICE deployment and query routing are the infra/box integration.
import type { SemanticField } from './semantic-model'

// Semantic default_aggregation → Cube measure type. 'last'/'none' have no native Cube
// measure type (would need custom SQL), so they are not emitted as measures.
const AGG_TO_CUBE: Record<string, string> = {
  sum: 'sum', avg: 'avg', min: 'min', max: 'max', count: 'count', count_distinct: 'countDistinct',
}

export interface CubeMeasure { name: string; sql: string; type: string; title?: string; unit?: string }
export interface CubeDimension { name: string; sql: string; type: string }
export interface CubeDef { name: string; sql_table: string; measures: CubeMeasure[]; dimensions: CubeDimension[]; data_source?: string }

function tableOf(objectKey: string): { table: string; column: string } {
  const i = objectKey.indexOf('.')
  return i === -1 ? { table: objectKey, column: objectKey } : { table: objectKey.slice(0, i), column: objectKey.slice(i + 1) }
}
function safeName(s: string): string {
  return s.replace(/[^A-Za-z0-9_]/g, '_')
}

// Cube names must be globally unique across ALL loaded schema files; two sources that both
// have a `production` table would collide in Cube's single namespace. Namespace the cube
// name by source id when one is given, so each source's cubes are distinct. The same
// function is used by the query planner so member refs match.
export function cubeNameFor(table: string, dataSource?: string): string {
  return dataSource ? `s_${safeName(dataSource)}_${safeName(table)}` : safeName(table)
}

// Build one cube per table from its column-level semantic fields.
// dataSource (optional) tags every cube so a Cube `driverFactory` can route it to the
// right physical connection (Phase 6 multi-datasource). Omitted → Cube's default source.
export function generateCubeSchema(fields: SemanticField[], dataSource?: string): CubeDef[] {
  const byTable = new Map<string, SemanticField[]>()
  for (const f of fields) {
    if (!f.object_key.includes('.')) continue  // skip table-level rows
    const { table } = tableOf(f.object_key)
    if (!byTable.has(table)) byTable.set(table, [])
    byTable.get(table)!.push(f)
  }
  const cubes: CubeDef[] = []
  for (const [table, cols] of byTable) {
    const measures: CubeMeasure[] = []
    const dimensions: CubeDimension[] = []
    for (const f of cols) {
      const { column } = tableOf(f.object_key)
      if (f.role === 'measure') {
        const agg = f.default_aggregation && AGG_TO_CUBE[f.default_aggregation]
        if (agg) measures.push({ name: safeName(column), sql: column, type: agg, unit: f.unit || undefined })
        // else: 'last'/'none'/unknown — not a native Cube measure; left to the app layer.
      } else if (f.role === 'time') {
        dimensions.push({ name: safeName(column), sql: column, type: 'time' })
      } else if (f.role) {
        dimensions.push({ name: safeName(column), sql: column, type: f.data_type === 'number' ? 'number' : 'string' })
      }
    }
    // A count measure is always useful.
    measures.unshift({ name: 'count', sql: '', type: 'count' })
    cubes.push({ name: cubeNameFor(table, dataSource), sql_table: table, measures, dimensions, ...(dataSource ? { data_source: dataSource } : {}) })
  }
  return cubes
}

// Render a cube definition to the JS file content Cube loads.
export function renderCubeJs(cube: CubeDef): string {
  const m = cube.measures.map(me =>
    me.type === 'count'
      ? `    ${me.name}: { type: \`count\` },`
      : `    ${me.name}: { sql: \`${me.sql}\`, type: \`${me.type}\` },`
  ).join('\n')
  const d = cube.dimensions.map(di => `    ${di.name}: { sql: \`${di.sql}\`, type: \`${di.type}\` },`).join('\n')
  const ds = cube.data_source ? `\n  data_source: \`${cube.data_source}\`,` : ''
  return `cube(\`${cube.name}\`, {
  sql_table: \`${cube.sql_table}\`,${ds}
  measures: {
${m}
  },
  dimensions: {
${d}
  },${renderPreAggs(cube)}
});
`
}

// Conservative pre-aggregation: a day-grain rollup over the time dimension for the
// aggregatable measures, only when the cube has a time dimension AND at least one
// additive measure. Refresh keyed every 1h (the app's fingerprint gate catches schema
// drift separately). Non-additive measures (avg) are included — Cube rolls them up via
// its own additive decomposition where possible and falls back otherwise.
function renderPreAggs(cube: CubeDef): string {
  const time = cube.dimensions.find(di => di.type === 'time')
  const rollupMeasures = cube.measures.filter(me => me.type === 'sum' || me.type === 'avg' || me.type === 'count')
  if (!time || rollupMeasures.length === 0) return ''
  const ms = rollupMeasures.map(me => `${cube.name}.${me.name}`).join(', ')
  return `
  pre_aggregations: {
    daily: {
      measures: [${ms}],
      time_dimension: ${cube.name}.${time.name},
      granularity: \`day\`,
      refresh_key: { every: \`1 hour\` },
    },
  },`
}

export function renderAllCubes(cubes: CubeDef[]): string {
  return cubes.map(renderCubeJs).join('\n')
}
