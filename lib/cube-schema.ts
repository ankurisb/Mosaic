// lib/cube-schema.ts
// Phase 5: generate a Cube (cube.dev) data model from the semantic model, so DB
// sources can be queried through Cube — deterministic measures/dimensions/time
// dimensions + pre-aggregation/caching — while the semantic model stays the single
// source of truth (Cube files are a generated artifact). Pure + unit-testable; the
// Cube SERVICE deployment and query routing are the infra/box integration.
import type { SemanticField } from './semantic-model'
import { createHash } from 'crypto'

// Semantic default_aggregation → Cube measure type. 'last'/'none' have no native Cube
// measure type (would need custom SQL), so they are not emitted as measures.
const AGG_TO_CUBE: Record<string, string> = {
  sum: 'sum', avg: 'avg', min: 'min', max: 'max', count: 'count', count_distinct: 'countDistinct',
}

export interface CubeMeasure { name: string; sql: string; type: string; title?: string; unit?: string }
export interface CubeDimension { name: string; sql: string; type: string }
export interface CubeDef { name: string; sql_table: string; measures: CubeMeasure[]; dimensions: CubeDimension[]; data_source?: string }

function tableOf(objectKey: string): { table: string; column: string } {
  // Split on the LAST dot: an object key is `table.column` for a public-schema
  // table but `schema.table.column` for a non-public schema (e.g. plant.production_runs.units_produced).
  // First-dot splitting mis-read the schema as the table → sql_table=`plant`,
  // column=`production_runs.units_produced`, and Cube failed to compile the cube.
  // A 2-part key has one dot, so public-schema behaviour is unchanged.
  const i = objectKey.lastIndexOf('.')
  return i === -1 ? { table: objectKey, column: objectKey } : { table: objectKey.slice(0, i), column: objectKey.slice(i + 1) }
}
function safeName(s: string): string {
  return s.replace(/[^A-Za-z0-9_]/g, '_')
}

// Cube names must be globally unique across ALL loaded schema files; two sources that both
// have a `production` table would collide in Cube's single namespace. Namespace by a SHORT
// lowercase hash of the source id: a raw id is often long and mixed-case, which Cube
// snake-cases into a huge name whose `<cube>__<member>` column aliases overflow Cube Store's
// name limit and collapse (all columns end up identically named). An 8-hex-char hash keeps
// names compact and SQL-safe. Deterministic, so the generator and the query planner agree.
export function cubeNameFor(table: string, dataSource?: string): string {
  const t = safeName(table).toLowerCase()
  if (!dataSource) return t
  const h = createHash('sha1').update(dataSource).digest('hex').slice(0, 8)
  return `s_${h}_${t}`
}

// Build one cube per table from its column-level semantic fields.
// dataSource (optional) tags every cube so a Cube `driverFactory` can route it to the
// right physical connection (Phase 6 multi-datasource). Omitted → Cube's default source.
export function generateCubeSchema(fields: SemanticField[], dataSource?: string): CubeDef[] {
  const byTable = new Map<string, SemanticField[]>()
  for (const f of fields) {
    // Skip table-level rows. These carry no role (just a description); keying off
    // the role is robust whether the table key is `table` (public) or
    // `schema.table` (non-public) — a dot-count check can't tell `schema.table`
    // from `table.column`.
    if (!f.role || !f.object_key.includes('.')) continue
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
// additive measure. Non-additive measures (avg) are included — Cube rolls them up via
// its own additive decomposition where possible and falls back otherwise.
//
// Partitioned + incremental so the rollup does NOT full-scan the source on every refresh —
// critical on large warehouse tables (BigQuery/Snowflake/Redshift) where a full re-scan each
// hour is a real cost. `partition_granularity: month` stores the rollup one partition per
// month; `incremental: true` with `update_window: 7 day` means only the partitions touching
// the last 7 days (plus the current one) are rebuilt on refresh — older partitions are left
// as-is. Trade-off: data arriving more than 7 days late into an old partition won't be picked
// up until a full rebuild; that's the right default for append-mostly time series, and the
// fingerprint gate still forces a full regenerate on schema drift.
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
      partition_granularity: \`month\`,
      refresh_key: { every: \`1 hour\`, incremental: true, update_window: \`7 day\` },
    },
  },`
}

export function renderAllCubes(cubes: CubeDef[]): string {
  return cubes.map(renderCubeJs).join('\n')
}
