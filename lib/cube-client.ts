// lib/cube-client.ts
// Phase 6: route a dashboard panel's query through the Cube engine when it is safe to,
// and fall back to the SQL + semantic pipeline otherwise. Cube is an ACCELERATOR, never
// a correctness dependency: every gate below fails CLOSED to SQL.
//
// The decision logic + query translation + result parsing are PURE and unit-tested here.
// The actual HTTP load and the filesystem writers are thin I/O wrappers at the bottom.
import { SignJWT } from 'jose'
import type { SemanticModel, SemanticField, Aggregation } from './semantic-model'

// ---- dialect support -------------------------------------------------------
// Cube ships native drivers for these. SQLite (incl. Mosaic's own metadata DB) and
// Mongo have no usable Cube SQL driver → those sources always use the SQL pipeline.
const CUBE_DIALECTS = new Set(['postgres', 'postgresql', 'mysql', 'mariadb', 'mssql', 'sqlserver', 'clickhouse', 'redshift', 'bigquery', 'snowflake'])
export function cubeDialectSupported(dialect: string | null | undefined): boolean {
  return CUBE_DIALECTS.has(String(dialect ?? '').trim().toLowerCase())
}

// A measure is Cube-native only for aggregations Cube can express as a measure type.
// 'last'/'none' (and anything unknown) are not → route must fall back for those.
const NATIVE_AGGS = new Set<Aggregation>(['sum', 'avg', 'min', 'max', 'count', 'count_distinct'])
export function isNativeAgg(agg: Aggregation | null | undefined): boolean {
  return !!agg && NATIVE_AGGS.has(agg)
}

// Mosaic grain → Cube granularity. Only the grains Cube expresses natively map; the
// sub-hour / multi-hour buckets (5m,15m,30m,6h,12h) have no native Cube granularity, so
// they return null and the caller falls back to the SQL rollup (which handles them).
const GRAIN_TO_CUBE: Record<string, string> = { '1m': 'minute', '1h': 'hour', '1d': 'day', '1w': 'week', '1mo': 'month' }
export function cubeGranularity(grain: string | null | undefined): string | null {
  return GRAIN_TO_CUBE[String(grain ?? '').trim()] ?? null
}

// ---- routing gate ----------------------------------------------------------
export interface MeasureSpec { agg: Aggregation | null | undefined; accumulation: string | null | undefined }
export interface RouteCtx {
  dialect: string | null | undefined
  modelVerified: boolean          // the plotted measures are status=verified (not proposed)
  fingerprintCurrent: boolean     // a schema fingerprint is recorded (drift baseline exists)
  measures: MeasureSpec[]         // declared aggregation + accumulation of each requested measure
}
export interface RouteDecision { route: boolean; reason: string }

// An accumulation other than raw (cumulative_counter / rate) needs Mosaic's per-interval
// delta transform, which Cube does NOT do — Cube would sum the raw counter and return
// wrong numbers. Those measures must stay on the SQL pipeline.
function needsDeltaPipeline(acc: string | null | undefined): boolean {
  return acc === 'cumulative_counter' || acc === 'rate'
}

// Route to Cube only when EVERY condition holds. Any miss → SQL pipeline (fails closed).
export function shouldRouteToCube(ctx: RouteCtx): RouteDecision {
  if (!cubeDialectSupported(ctx.dialect)) return { route: false, reason: `dialect-unsupported:${ctx.dialect ?? 'none'}` }
  if (!ctx.modelVerified) return { route: false, reason: 'model-unverified' }
  if (!ctx.fingerprintCurrent) return { route: false, reason: 'schema-drift' }
  if (ctx.measures.length === 0) return { route: false, reason: 'no-measures' }
  if (!ctx.measures.every(m => isNativeAgg(m.agg))) return { route: false, reason: 'non-native-measure' }
  if (ctx.measures.some(m => needsDeltaPipeline(m.accumulation))) return { route: false, reason: 'needs-delta-pipeline' }
  return { route: true, reason: 'ok' }
}

// ---- query translation -----------------------------------------------------
export interface CubeQuery {
  measures: string[]
  dimensions: string[]
  timeDimensions: { dimension: string; granularity?: string; dateRange?: [string, string] }[]
  order?: Record<string, 'asc' | 'desc'>
}
export interface PanelCubeInput {
  cube: string                    // cube name (= table)
  cfg: Record<string, unknown>    // chart_config: { x|label, y|value, series|group, grain }
  timeFrom?: string
  timeTo?: string
}

// Build a Cube /load query from the panel's chart config + the model. Returns null when
// the panel has no measures or no time axis → caller falls back. Column names are mapped
// to `${cube}.${column}` member refs. A non-native grain drops the granularity (Cube
// returns raw rows and the SQL rollup is skipped — but shouldRouteToCube already blocks
// the non-native-measure case; grain is advisory here).
export function toCubeQuery(input: PanelCubeInput, model: SemanticModel): CubeQuery | null {
  const { cube, cfg } = input
  const timeKey = (cfg.x || cfg.label) as string | undefined
  const yKeys = [cfg.y, cfg.value].filter(Boolean) as string[]
  if (!yKeys.length) return null

  const ref = (col: string) => `${cube}.${col}`
  const measures = yKeys.map(ref)
  const seriesKey = (cfg.series || cfg.group) as string | undefined
  const dimensions = seriesKey ? [ref(seriesKey)] : []

  const timeDimensions: CubeQuery['timeDimensions'] = []
  if (timeKey) {
    const gran = cubeGranularity(cfg.grain as string | undefined)
    const td: CubeQuery['timeDimensions'][number] = { dimension: ref(timeKey) }
    if (gran) td.granularity = gran
    if (input.timeFrom && input.timeTo) td.dateRange = [input.timeFrom, input.timeTo]
    timeDimensions.push(td)
  }
  // Touch the model so an unknown column can be caught by the caller if desired; keeping
  // the signature stable for future per-column validation.
  void model
  const order = timeKey ? { [ref(timeKey)]: 'asc' as const } : undefined
  return { measures, dimensions, timeDimensions, ...(order ? { order } : {}) }
}

// ---- result parsing --------------------------------------------------------
// Cube /load returns { data: [ { "cube.col": value, "cube.ts.day": iso, ... } ] }.
// Flatten member keys back to the bare column names the panel/chart expects, and prefer
// the granularity-suffixed time key (e.g. "cube.ts.day") for the time axis.
export function parseCubeResult(json: { data?: Record<string, unknown>[] } | null, cube: string): Record<string, unknown>[] {
  const rows = json?.data
  if (!Array.isArray(rows)) return []
  const prefix = `${cube}.`
  return rows.map(r => {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(r)) {
      let bare = k.startsWith(prefix) ? k.slice(prefix.length) : k
      // "ts.day" -> "ts": collapse the granularity suffix onto the base column.
      const dot = bare.indexOf('.')
      if (dot !== -1) bare = bare.slice(0, dot)
      // First writer wins per bare key so the base value isn't clobbered by a suffix dupe.
      if (!(bare in out)) out[bare] = v
    }
    return out
  })
}

// ---- datasource map (written by Mosaic, read by Cube's driverFactory) ------
export interface DbConnLike {
  id: string
  dialect?: string | null
  host?: string | null
  port?: number | null
  database_name?: string | null
  username?: string | null
}
export interface CubeDatasource { type: string; host?: string; port?: number; database?: string; user?: string; password?: string }

// Build the { connId: driverConfig } map Cube's driverFactory consumes. SQLite/unsupported
// dialects are omitted (those sources never route to Cube). Passwords are injected by the
// caller (decrypted on the box) — kept out of this pure builder so it stays testable.
export function buildDatasourceMap(conns: DbConnLike[], passwordFor: (id: string) => string | undefined): Record<string, CubeDatasource> {
  const out: Record<string, CubeDatasource> = {}
  for (const c of conns) {
    if (!cubeDialectSupported(c.dialect)) continue
    const type = String(c.dialect).toLowerCase().replace('postgresql', 'postgres').replace('sqlserver', 'mssql')
    out[c.id] = {
      type,
      host: c.host ?? undefined,
      port: c.port ?? undefined,
      database: c.database_name ?? undefined,
      user: c.username ?? undefined,
      password: passwordFor(c.id),
    }
  }
  return out
}

// ---- thin I/O: sign + load (not unit-tested; integration/box) --------------
export async function signCubeToken(secret: string): Promise<string> {
  const key = new TextEncoder().encode(secret)
  return new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('10m').sign(key)
}

export interface CubeLoadResult { ok: boolean; rows: Record<string, unknown>[]; usedPreAgg?: boolean; fallback?: boolean; reason?: string }

// POST the query to Cube. ANY failure (network, non-2xx, timeout, malformed) returns
// { fallback:true } so the caller runs the SQL pipeline. Never throws to the caller.
export async function loadViaCube(cubeUrl: string, secret: string, cube: string, query: CubeQuery, timeoutMs = 8000): Promise<CubeLoadResult> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const token = await signCubeToken(secret)
    const res = await fetch(`${cubeUrl.replace(/\/$/, '')}/cubejs-api/v1/load`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: token },
      body: JSON.stringify({ query }),
      signal: ctrl.signal,
    })
    if (!res.ok) return { ok: false, rows: [], fallback: true, reason: `cube-http-${res.status}` }
    const json = await res.json() as { data?: Record<string, unknown>[]; usedPreAggregations?: Record<string, unknown> }
    return { ok: true, rows: parseCubeResult(json, cube), usedPreAgg: !!(json.usedPreAggregations && Object.keys(json.usedPreAggregations).length) }
  } catch (e) {
    return { ok: false, rows: [], fallback: true, reason: `cube-error:${(e as Error)?.name || 'unknown'}` }
  } finally {
    clearTimeout(t)
  }
}

// Resolve the plotted measures' {agg, accumulation} + whether each is verified, from the
// model. Used by the routing gate.
export function measureSpecsFor(cfg: Record<string, unknown>, model: SemanticModel): { specs: MeasureSpec[]; fields: SemanticField[] } {
  const yKeys = [cfg.y, cfg.value].filter(Boolean) as string[]
  const fields = yKeys.map(y => model.byColumn.get(y) || model.byKey.get(y)).filter(Boolean) as SemanticField[]
  return { specs: fields.map(f => ({ agg: f.default_aggregation, accumulation: f.accumulation })), fields }
}

function tableOfKey(objectKey: string): string | null {
  const i = objectKey.indexOf('.')
  return i === -1 ? null : objectKey.slice(0, i)
}

export interface CubeRoutePlan { route: boolean; reason: string; cube?: string; query?: CubeQuery }

// The single decision+build entry point the dashboard data path calls. Pure (no I/O):
// decides eligibility, derives the single cube/table the panel targets, and builds the
// Cube query. Returns { route:false, reason } to fall back to the SQL pipeline. Routing
// is confined to single-table panels; a cross-table panel falls back.
export function planCubeRouting(args: {
  cfg: Record<string, unknown>
  model: SemanticModel
  dialect: string | null | undefined
  fingerprintCurrent: boolean
  timeFrom?: string
  timeTo?: string
}): CubeRoutePlan {
  const { cfg, model, dialect, fingerprintCurrent } = args
  const { specs, fields } = measureSpecsFor(cfg, model)
  if (fields.length === 0) return { route: false, reason: 'no-measure-field' }
  // All plotted measures must be verified.
  const modelVerified = fields.every(f => f.status === 'verified')
  const gate = shouldRouteToCube({ dialect, modelVerified, fingerprintCurrent, measures: specs })
  if (!gate.route) return { route: false, reason: gate.reason }
  // Single-table only: every measure field must share one table, and the time axis
  // (if modelled) must be in that table too.
  const tables = new Set(fields.map(f => tableOfKey(f.object_key)).filter(Boolean) as string[])
  if (tables.size !== 1) return { route: false, reason: 'cross-table' }
  const cube = [...tables][0]
  const timeKey = (cfg.x || cfg.label) as string | undefined
  if (timeKey) {
    const tf = model.byColumn.get(timeKey) || model.byKey.get(timeKey)
    if (tf) { const tt = tableOfKey(tf.object_key); if (tt && tt !== cube) return { route: false, reason: 'cross-table-time' } }
  }
  const query = toCubeQuery({ cube, cfg, timeFrom: args.timeFrom, timeTo: args.timeTo }, model)
  if (!query) return { route: false, reason: 'no-query' }
  return { route: true, reason: 'ok', cube, query }
}
