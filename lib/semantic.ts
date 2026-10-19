// lib/semantic.ts
// Semantic schema dictionary — plain-language descriptions for tables and columns,
// per data source. Complements lib/metrics.ts (business metrics/terms): this is the
// data-dictionary that tells the model what an opaque column name actually means
// (e.g. PRISM `kWh_sf` = "scaling factor for kWh", `v1n` = "phase-1 line voltage").
//
// Descriptions are woven into the schema block the model already receives
// (formatSchemaForPrompt in lib/tools.ts) so every NL->SQL path benefits: chat,
// PanelBuilder, and the conversational dashboard builder.
import { getDb } from './db'

export interface SemanticDescription {
  id: string
  source_type: string
  source_id: string
  object_type: 'table' | 'column'
  object_key: string   // 'orders' | 'orders.cycle_time_s'
  description: string
  updated_at?: string
}

// A lookup from object_key -> description for one source. Keys match exactly what
// formatSchemaForPrompt emits (bare table name; 'table.column' for columns).
export type SchemaHints = Map<string, string>

const EMPTY: SchemaHints = new Map()

/**
 * Load the description hints for one data source. Returns an empty map on any error
 * or when the table doesn't exist yet — callers must degrade to the plain schema,
 * never fail. Cheap single indexed read.
 */
export async function getSchemaHints(sourceType: string, sourceId: string): Promise<SchemaHints> {
  if (!sourceId) return EMPTY
  try {
    const sql = getDb()
    const rows = await sql`
      SELECT object_key, description
      FROM   semantic_descriptions
      WHERE  source_type = ${sourceType} AND source_id = ${sourceId}
        AND  description <> ''
    ` as unknown as Array<{ object_key: string; description: string }>
    if (!rows.length) return EMPTY
    const m: SchemaHints = new Map()
    for (const r of rows) m.set(r.object_key, r.description)
    return m
  } catch {
    return EMPTY
  }
}

// Storage/abuse bounds — enforced server-side at write time so neither a human
// nor the (future) programmatic dashboard writer can bloat the table or the prompt.
export const MAX_DESC_LEN = 500          // per description, at rest
export const MAX_KEY_LEN = 300           // per object_key, at rest
export const MAX_ITEMS_PER_UPSERT = 500  // per upsert call
const MAX_GLOSS_COLS = 40                // columns glossed per table in the prompt

// Neutralise and bound a description for storage: strip control characters,
// collapse any whitespace (newlines included) to single spaces, trim, and cap
// length. This makes stored values single-line, bounded, and free of the
// newline/control vectors a prompt-injection attempt in sample data could carry
// through the AI drafter. Returns '' for empty/whitespace-only input (callers
// treat '' as "clear this entry").
export function sanitizeDescription(s: string): string {
  if (!s) return ''
  const t = String(s).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  return t.length > MAX_DESC_LEN ? t.slice(0, MAX_DESC_LEN) : t
}

// Truncate a hint so one verbose description can't blow the schema budget. Also
// strips control chars as a second line of defence at prompt-build time.
const MAX_HINT_CHARS = 120
function clip(s: string): string {
  const t = s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  return t.length > MAX_HINT_CHARS ? t.slice(0, MAX_HINT_CHARS - 1) + '…' : t
}

/**
 * Append a table hint to a schema line, e.g.
 *   "orders(id*:int, cycle_time_s:int)"  ->  "orders(id*:int, cycle_time_s:int)  — customer orders"
 * Pure/string-only so it is unit-testable and safe to call in the hot path.
 */
export function annotateTableLine(line: string, tableName: string, hints: SchemaHints): string {
  const d = hints.get(tableName)
  return d ? `${line}  — ${clip(d)}` : line
}

/**
 * Build a compact per-column gloss block for a table, listing only the columns that
 * actually have a description. Returns '' when none, so it adds nothing to the prompt
 * when the dictionary is empty. Example:
 *   "        cols: kWh_sf = scaling factor for kWh; v1n = phase-1 line voltage"
 */
export function columnGloss(tableName: string, columnNames: string[], hints: SchemaHints, indent = '        '): string {
  if (hints.size === 0) return ''
  const parts: string[] = []
  for (const col of columnNames) {
    const d = hints.get(`${tableName}.${col}`)
    if (d) parts.push(`${col} = ${clip(d)}`)
    if (parts.length >= MAX_GLOSS_COLS) break   // bound the gloss so a huge dictionary can't starve the schema
  }
  return parts.length ? `${indent}cols: ${parts.join('; ')}` : ''
}

export function hasAnyHints(hints: SchemaHints | null | undefined): boolean {
  return !!hints && hints.size > 0
}
