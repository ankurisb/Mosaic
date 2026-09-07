// lib/combine-sources.ts
// Cross-source analysis: load 2+ result sets (from prior query_database / call_api /
// read_file_server calls) into an in-process DuckDB, run a single SQL query that
// JOINs / aggregates across them, and return the merged rows. This gives real,
// deterministic SQL joins across a database + an API + a file — instead of the model
// eyeball-matching rows in its context (error-prone, doesn't scale).
import { DuckDBInstance } from '@duckdb/node-api'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'

const MAX_TABLES = 6
const MAX_ROWS_PER_TABLE = 50_000   // guard: this joins result SETS, not raw huge tables
const VALID_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/

// BigInt (DuckDB integers) and other non-JSON types -> JSON-safe values.
function jsonSafe(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => {
    if (typeof v === 'bigint') return [k, Number(v)]
    if (v instanceof Date) return [k, v.toISOString()]
    return [k, v]
  })))
}

// Pull a rows array out of whatever shape a prior tool result had.
function extractRows(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value as Record<string, unknown>[]
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>
    for (const key of ['rows', 'data', 'results', 'value', 'records', 'items']) {
      if (Array.isArray(o[key])) return o[key] as Record<string, unknown>[]
    }
  }
  return []
}

export interface CombineInput {
  tables: Record<string, unknown>   // { name: rows[] | {rows:[...]} }
  sql: string
  max_rows?: number
}

export async function combineSources(input: CombineInput): Promise<unknown> {
  const { tables, sql } = input
  const maxRows = Math.min(Number(input.max_rows) || 1000, 10_000)

  if (!tables || typeof tables !== 'object') return { error: 'tables must be an object mapping table names to row arrays.' }
  if (!sql || typeof sql !== 'string') return { error: 'sql (a SELECT query over the named tables) is required.' }

  const names = Object.keys(tables)
  if (names.length < 1) return { error: 'Provide at least one table.' }
  if (names.length > MAX_TABLES) return { error: `Too many tables (max ${MAX_TABLES}).` }
  for (const n of names) {
    if (!VALID_NAME.test(n)) return { error: `Invalid table name "${n}". Use letters, digits, underscores; must start with a letter/underscore.` }
  }

  const tmpFiles: string[] = []
  let inst: Awaited<ReturnType<typeof DuckDBInstance.create>> | null = null
  try {
    inst = await DuckDBInstance.create(':memory:')
    const conn = await inst.connect()

    for (const name of names) {
      const rows = extractRows(tables[name])
      if (!rows.length) return { error: `Table "${name}" has no rows. Fetch the data first (query_database / call_api / read_file_server), then pass its rows here.` }
      if (rows.length > MAX_ROWS_PER_TABLE) return { error: `Table "${name}" has ${rows.length} rows (max ${MAX_ROWS_PER_TABLE}). Narrow the upstream query first.` }
      const f = path.join(os.tmpdir(), `mosaic_combine_${process.pid}_${name}_${Date.now()}.json`)
      await fs.writeFile(f, JSON.stringify(rows))
      tmpFiles.push(f)
      // Load as a real table. Table name is validated above; the path is ours.
      await conn.run(`CREATE TABLE "${name}" AS SELECT * FROM read_json_auto('${f.replace(/'/g, "''")}')`)
    }

    const reader = await conn.run(sql)
    const raw = await reader.getRowObjects() as Record<string, unknown>[]
    const rows = jsonSafe(raw).slice(0, maxRows)
    const columns = rows.length ? Object.keys(rows[0]) : []
    return {
      content_type: 'tabular',
      source: 'combine_sources (DuckDB)',
      tables_combined: names,
      row_count: rows.length,
      truncated: raw.length > rows.length,
      columns,
      rows,
    }
  } catch (e) {
    // DuckDB SQL errors are informative — surface them so the model can fix its query.
    return { error: `Cross-source query failed: ${(e as Error).message.slice(0, 300)}`, hint: 'Check table names match what you passed, and column names match the fetched data.' }
  } finally {
    try { if (inst) inst.closeSync() } catch { /* ignore */ }
    for (const f of tmpFiles) { try { await fs.unlink(f) } catch { /* ignore */ } }
  }
}
