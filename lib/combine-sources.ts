// lib/combine-sources.ts
// Cross-source analysis: load 2+ result sets (from prior query_database / call_api /
// read_file_server calls) into an in-process DuckDB, run a single SQL query that
// JOINs / aggregates across them, and return the merged rows. Real, deterministic SQL
// joins across a database + an API + a file — instead of the model eyeball-matching
// rows in its context (error-prone, doesn't scale).
//
// SECURITY: the AI writes the SQL, and source data could carry a prompt injection, so
// the query must NOT be able to touch the filesystem or attach the real Mosaic DB.
// DuckDB by default CAN (ATTACH '/data/mosaic.db', read_csv('/etc/passwd'), COPY TO
// file). We therefore (1) load data purely in-memory via INSERT (no temp files), then
// (2) SET enable_external_access=false BEFORE running the user's query — so the query
// runs only against the loaded arrays, with no file/db access. (Loading in-memory also
// removes any temp-file concurrency concern.)
import { DuckDBInstance } from '@duckdb/node-api'

const MAX_TABLES = 6
const MAX_ROWS_PER_TABLE = 50_000
const MAX_COLS = 200
const VALID_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/

function jsonSafe(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => {
    if (typeof v === 'bigint') return [k, Number(v)]
    if (v instanceof Date) return [k, v.toISOString()]
    return [k, v]
  })))
}

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

// SQL string literal escape (single quotes doubled). Used for VALUES we insert.
// Column name for CREATE TABLE — quote it so any characters are safe, escape embedded quotes.
function col(name: string): string {
  return `"${String(name).replace(/"/g, '""')}"`
}

// Emit a SQL literal for a value given the inferred column type. NULL for missing/
// non-coercible. Strings always single-quote-escaped.
function qTyped(v: unknown, type: 'DOUBLE' | 'BIGINT' | 'BOOLEAN' | 'VARCHAR'): string {
  if (v === null || v === undefined || v === '') return 'NULL'
  if (type === 'BOOLEAN') return v === true || v === 'true' ? 'TRUE' : 'FALSE'
  if (type === 'BIGINT' || type === 'DOUBLE') {
    const n = typeof v === 'bigint' ? v : Number(v)
    return Number.isFinite(Number(n)) ? String(n) : 'NULL'
  }
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
  return `'${s.replace(/'/g, "''")}'`
}

export interface CombineInput {
  tables: Record<string, unknown>
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

  let inst: Awaited<ReturnType<typeof DuckDBInstance.create>> | null = null
  try {
    inst = await DuckDBInstance.create(':memory:')
    const conn = await inst.connect()

    for (const name of names) {
      const rows = extractRows(tables[name])
      if (!rows.length) return { error: `Table "${name}" has no rows. Fetch the data first (query_database / call_api / read_file_server), then pass its rows here.` }
      if (rows.length > MAX_ROWS_PER_TABLE) return { error: `Table "${name}" has ${rows.length} rows (max ${MAX_ROWS_PER_TABLE}). Narrow the upstream query first.` }

      // Union of all column names across rows (rows can have inconsistent schema).
      const colSet = new Set<string>()
      for (const r of rows) { for (const k of Object.keys(r)) { colSet.add(k); if (colSet.size > MAX_COLS) return { error: `Table "${name}" has too many columns (max ${MAX_COLS}).` } } }
      const cols = [...colSet]
      if (!cols.length) return { error: `Table "${name}" rows have no columns.` }

      // Infer a DuckDB type per column from the values so numeric aggregations/sorts
      // work without the AI having to CAST. A column is numeric only if EVERY non-null
      // value is a JS number (or numeric string); boolean if all booleans; else VARCHAR.
      const typeOf = (c: string): 'DOUBLE' | 'BIGINT' | 'BOOLEAN' | 'VARCHAR' => {
        let sawNumber = false, allInt = true, sawBool = false, sawOther = false, sawAny = false
        for (const r of rows) {
          const v = r[c]
          if (v === null || v === undefined || v === '') continue
          sawAny = true
          if (typeof v === 'boolean') { sawBool = true; continue }
          if (typeof v === 'number' && Number.isFinite(v)) { sawNumber = true; if (!Number.isInteger(v)) allInt = false; continue }
          if (typeof v === 'bigint') { sawNumber = true; continue }
          if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) { sawNumber = true; if (!Number.isInteger(Number(v))) allInt = false; continue }
          sawOther = true
        }
        if (!sawAny) return 'VARCHAR'
        if (sawBool && !sawNumber && !sawOther) return 'BOOLEAN'
        if (sawNumber && !sawOther && !sawBool) return allInt ? 'BIGINT' : 'DOUBLE'
        return 'VARCHAR'
      }
      const colTypes = cols.map(c => ({ name: c, type: typeOf(c) }))

      await conn.run(`CREATE TABLE ${col(name)} (${colTypes.map(c => `${col(c.name)} ${c.type}`).join(', ')})`)
      // Insert in chunks to keep statements bounded.
      const CHUNK = 500
      for (let i = 0; i < rows.length; i += CHUNK) {
        const slice = rows.slice(i, i + CHUNK)
        const values = slice.map(r => `(${colTypes.map(c => qTyped(r[c.name], c.type)).join(', ')})`).join(', ')
        await conn.run(`INSERT INTO ${col(name)} VALUES ${values}`)
      }
    }

    // LOCK DOWN before running the AI-authored query: no file access, no ATTACH, no
    // COPY-to-file, no reading external CSV/parquet/db. The query can now only touch
    // the in-memory tables we loaded.
    await conn.run('SET enable_external_access=false')

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
    return { error: `Cross-source query failed: ${(e as Error).message.slice(0, 300)}`, hint: 'Check table names match what you passed, and column names match the fetched data. Note: file/database access is disabled — this only queries the data you passed in.' }
  } finally {
    try { if (inst) inst.closeSync() } catch { /* ignore */ }
  }
}
