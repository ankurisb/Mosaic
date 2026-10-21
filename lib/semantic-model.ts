// lib/semantic-model.ts
// Phase 1 of the semantic architecture: the STRUCTURED field model the executor
// acts on (vs lib/semantic.ts, which only feeds descriptions into the AI prompt).
//
// Two halves:
//   1. getSemanticModel() — load the structured records for a source from
//      semantic_descriptions (the columns added in migration 021).
//   2. applySemanticModel() — PURE post-processing of a panel's result rows against
//      the model: deterministic cumulative-counter → per-interval delta, unit
//      surfacing, and flagging of unverified fields that were actually used. No DB,
//      so it is fully unit-testable.
import { getDb } from './db'
import { type Grain, type Agg, type RollupSpec } from './semantic-rollup'

const GRAINS = new Set<string>(['1m', '5m', '15m', '30m', '1h', '6h', '12h', '1d', '1w', '1mo'])

// Build a rollup spec from the panel's chart config + the semantic model, or null if
// the panel didn't ask for a grain (chart_config.grain). Measures aggregate by their
// declared default_aggregation (fallback sum); the x key is the time axis.
export function planRollup(model: SemanticModel, chartConfig?: Record<string, unknown>): RollupSpec | null {
  const cfg = chartConfig || {}
  const grain = String(cfg.grain || '').trim()
  if (!GRAINS.has(grain)) return null
  const timeKey = (cfg.x || cfg.label) as string | undefined
  const yKeys = [cfg.y, cfg.value].filter(Boolean) as string[]
  if (!timeKey || !yKeys.length) return null
  const seriesKey = (cfg.series || cfg.group) as string | undefined
  const measures: Record<string, Agg> = {}
  for (const y of yKeys) {
    const f = model.byColumn.get(y) || model.byKey.get(y)
    const agg = f?.default_aggregation && f.default_aggregation !== 'none' ? f.default_aggregation : 'sum'
    measures[y] = agg as Agg
  }
  return { timeKey, grain: grain as Grain, measures, seriesKeys: seriesKey ? [seriesKey] : [] }
}

export type Role = 'measure' | 'dimension' | 'time' | 'identifier' | 'attribute'
export type Aggregation = 'sum' | 'avg' | 'min' | 'max' | 'last' | 'count' | 'count_distinct' | 'none'
export type Accumulation = 'raw' | 'cumulative_counter' | 'rate'
export type Status = 'proposed' | 'verified' | 'rejected'

export interface SemanticField {
  object_key: string            // 'meter' | 'meter.kWh'
  role?: Role | null
  data_type?: string | null
  unit?: string | null
  default_aggregation?: Aggregation | null
  additivity?: string | null
  accumulation?: Accumulation | null
  time_grain?: string | null
  status?: Status | null
  confidence?: number | null
  description?: string | null
}

// Keyed by object_key, plus a bare-column index so a panel result column (a SQL
// alias that is usually the bare column name) can be resolved without the table
// prefix.
export interface SemanticModel {
  byKey: Map<string, SemanticField>
  byColumn: Map<string, SemanticField>   // last path segment -> field (last wins; fine for Phase 1)
}

export function emptyModel(): SemanticModel {
  return { byKey: new Map(), byColumn: new Map() }
}

// ---- Validation of structured fields (write-time, pure/testable) -----------
const ROLES = new Set(['measure', 'dimension', 'time', 'identifier', 'attribute'])
const AGGS = new Set(['sum', 'avg', 'min', 'max', 'last', 'count', 'count_distinct', 'none'])
const ACCS = new Set(['raw', 'cumulative_counter', 'rate'])
const ADDITIV = new Set(['additive', 'semi_additive', 'non_additive'])
const DTYPES = new Set(['number', 'string', 'timestamp', 'boolean', 'json'])
const STATUSES = new Set(['proposed', 'verified', 'rejected'])

function oneOf(v: unknown, set: Set<string>): string | null {
  const s = String(v ?? '').trim().toLowerCase()
  return set.has(s) ? s : null
}
function cleanUnit(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).replace(/[\u0000-\u001f\u007f]+/g, '').trim()
  return s ? s.slice(0, 24) : null
}
function clampConf(v: unknown): number | null {
  const n = Number(v)
  return isFinite(n) ? Math.max(0, Math.min(1, n)) : null
}

export interface StructuredInput {
  role?: unknown; data_type?: unknown; unit?: unknown; default_aggregation?: unknown
  additivity?: unknown; accumulation?: unknown; time_grain?: unknown
  status?: unknown; confidence?: unknown; evidence?: unknown
}
export interface StructuredFields {
  role: string | null; data_type: string | null; unit: string | null; default_aggregation: string | null
  additivity: string | null; accumulation: string | null; time_grain: string | null
  status: string | null; confidence: number | null; evidence: string | null
}

// Coerce raw upsert input into validated structured fields. Unknown/invalid enum
// values become null (never stored as junk). Returns null for every field when no
// structured input is present, so a description-only upsert is unaffected.
export function coerceStructured(it: StructuredInput): StructuredFields {
  let evidence: string | null = null
  if (it.evidence != null) {
    try { evidence = JSON.stringify(it.evidence).slice(0, 2000) } catch { evidence = null }
  }
  const timeGrain = it.time_grain == null ? null : String(it.time_grain).replace(/[\u0000-\u001f\u007f]+/g, '').trim().slice(0, 16) || null
  return {
    role: oneOf(it.role, ROLES),
    data_type: oneOf(it.data_type, DTYPES),
    unit: cleanUnit(it.unit),
    default_aggregation: oneOf(it.default_aggregation, AGGS),
    additivity: oneOf(it.additivity, ADDITIV),
    accumulation: oneOf(it.accumulation, ACCS),
    time_grain: timeGrain,
    status: oneOf(it.status, STATUSES),
    confidence: clampConf(it.confidence),
    evidence,
  }
}
export function hasStructured(s: StructuredFields): boolean {
  return !!(s.role || s.unit || s.default_aggregation || s.accumulation || s.time_grain || s.data_type || s.additivity)
}

export function buildModel(fields: SemanticField[]): SemanticModel {
  const m = emptyModel()
  for (const f of fields) {
    m.byKey.set(f.object_key, f)
    const seg = f.object_key.includes('.') ? f.object_key.split('.').pop()! : f.object_key
    m.byColumn.set(seg, f)
  }
  return m
}

// Load the structured model for one source. Only rows that carry at least one
// structured field (role set) are included — pure description rows from 018 don't
// drive the executor. Degrades to an empty model on any error (never throws).
export async function getSemanticModel(sourceType: string, sourceId: string): Promise<SemanticModel> {
  if (!sourceId) return emptyModel()
  try {
    const sql = getDb()
    const rows = await sql`
      SELECT object_key, role, data_type, unit, default_aggregation, additivity,
             accumulation, time_grain, status, confidence, description
      FROM   semantic_descriptions
      WHERE  source_type = ${sourceType} AND source_id = ${sourceId}
        AND  role IS NOT NULL
    ` as unknown as SemanticField[]
    return buildModel(rows || [])
  } catch {
    return emptyModel()
  }
}

// ---- Pure post-processing -------------------------------------------------

export interface ApplyOpts {
  chartType?: string
  chartConfig?: Record<string, unknown>
}
export interface ApplyMeta {
  units: Record<string, string>   // result column -> unit (for axis labels/formatting)
  applied: string[]               // e.g. ['delta:energy_kwh']
  unverified: string[]            // result columns whose semantic field is status=proposed and was used
}

// Resolve a result column name to a semantic field (exact key, then bare column).
function fieldFor(model: SemanticModel, col: string): SemanticField | undefined {
  return model.byKey.get(col) || model.byColumn.get(col)
}

// Convert a cumulative counter column to per-interval deltas over rows ALREADY
// ordered by their time/x axis. Counter resets (value drops) are treated as the new
// reading (delta = current), never a negative spike. Optionally grouped by a series
// key so multi-device series each delta independently.
export function deltaColumn(
  rows: Record<string, unknown>[],
  col: string,
  seriesKey?: string,
): Record<string, unknown>[] {
  const prev = new Map<string, number>()
  const seen = new Map<string, boolean>()
  return rows.map(r => {
    const g = seriesKey ? String(r[seriesKey] ?? '') : ''
    const cur = Number(r[col])
    if (!isFinite(cur)) return r
    let d: number
    if (!seen.get(g)) { d = 0; seen.set(g, true) }       // first point of a series has no prior
    else { const p = prev.get(g)!; d = cur - p; if (d < 0) d = cur }  // reset → treat current as the delta
    prev.set(g, cur)
    return { ...r, [col]: d }
  })
}

// Apply the semantic model to a panel's rows. Returns possibly-transformed rows and
// meta describing what was applied and which used columns are unverified.
export function applySemanticModel(
  rows: Record<string, unknown>[],
  model: SemanticModel,
  opts: ApplyOpts = {},
): { rows: Record<string, unknown>[]; meta: ApplyMeta } {
  const meta: ApplyMeta = { units: {}, applied: [], unverified: [] }
  if (!rows.length || (model.byColumn.size === 0 && model.byKey.size === 0)) return { rows, meta }

  const cfg = opts.chartConfig || {}
  const xKey = (cfg.x || cfg.label) as string | undefined
  const seriesKey = (cfg.series || cfg.group) as string | undefined
  const yKeys = [cfg.y, cfg.value].filter(Boolean) as string[]
  const cols = Object.keys(rows[0])

  // Columns to consider as measures: the chart's y/value if given, else every column
  // that isn't the x/series key.
  const candidates = yKeys.length ? yKeys : cols.filter(c => c !== xKey && c !== seriesKey)

  let out = rows
  for (const col of cols) {
    const f = fieldFor(model, col)
    if (!f) continue
    if (f.unit) meta.units[col] = f.unit
    const used = candidates.includes(col)
    if (used && f.status === 'proposed') meta.unverified.push(col)
    // Deterministic cumulative → delta (only for a measure actually plotted).
    if (used && f.accumulation === 'cumulative_counter') {
      out = deltaColumn(out, col, seriesKey && cols.includes(seriesKey) ? seriesKey : undefined)
      meta.applied.push(`delta:${col}`)
    }
  }
  return { rows: out, meta }
}
