// -- lib/db.ts -------------------------------------------------
// Unified database client. Detects the DATABASE_URL scheme and
// returns the appropriate driver:
//
//   postgres://...       pg (standard TCP, local / self-hosted)
//   postgresql://...     pg (standard TCP, local / self-hosted)
//   sqlite://...         better-sqlite3 (local, zero-config)
//   neondb.net in URL    @neondatabase/serverless (Neon cloud)
//   (default)            @neondatabase/serverless (Neon cloud)
//
// All drivers return a tagged-template SQL function compatible
// with the rest of the codebase: sql`SELECT ...`

import { neon, type NeonQueryFunction } from '@neondatabase/serverless'

// -- Type for our unified SQL interface -----------------------
type SqlRow   = Record<string, unknown>
type SqlQuery = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<SqlRow[]>

// Columns that store free-form user text that may coincidentally look like
// JSON (e.g. pasted objects in chat). Skip auto-parse to preserve string type.
const SKIP_AUTO_PARSE = new Set([
  'content',          // messages.content — chat message bodies
  'message_template', // rule_groups / integration_rules — notification templates
])

let _client: SqlQuery | null = null
let _driver: 'sqlite' | 'postgres' | 'neon' = 'sqlite'

export function getDbDriver(): 'sqlite' | 'postgres' | 'neon' {
  return _driver
}

// Convenience: true when running on any Postgres-compatible backend
export function isPostgres(): boolean {
  return _driver === 'postgres' || _driver === 'neon'
}

export function getDb(): SqlQuery {
  if (_client) return _client

  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')

  // -- SQLite (local installer default) -------------------------
  if (url.startsWith('sqlite://') || url.startsWith('sqlite:')) {
    const path = url.replace(/^sqlite:\/\//, '').replace(/^sqlite:/, '')
    // Lazy require -- better-sqlite3 is optional dep, only needed locally
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _driver = 'sqlite'
    const Database = require('better-sqlite3')
    const db = new Database(path === ':memory:' ? ':memory:' : path)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')

    // Wrap in a tagged-template function matching Neon's interface
    _client = async (strings: TemplateStringsArray, ...values: unknown[]): Promise<SqlRow[]> => {
      // Build parameterised query  ($1, $2  ?, ?)
      let sql = ''
      const params: unknown[] = []
      strings.forEach((s, i) => {
        sql += s
        if (i < values.length) {
          const v = values[i]
          params.push(typeof v === 'boolean' ? (v ? 1 : 0) : v)
          sql += '?'
        }
      })
      try {
        const stmt = db.prepare(sql)
        // SELECT returns rows; INSERT/UPDATE/DELETE returns info
        if (/^\s*(select|pragma|with)/i.test(sql) || /\breturning\b/i.test(sql)) {
          const rows = stmt.all(...params) as SqlRow[]
          // SQLite stores JSON as TEXT; parse values that look like JSON
          // arrays/objects so handlers see the same shape as Postgres/Neon.
          return rows.map(row => {
            const out: SqlRow = { ...row }
            for (const [k, v] of Object.entries(out)) {
              if (typeof v === 'string' && v.length > 0 &&
                  (v[0] === '[' || v[0] === '{') &&
                  !SKIP_AUTO_PARSE.has(k)) {
                try { out[k] = JSON.parse(v) } catch { /* leave as-is */ }
              }
            }
            return out
          })
        } else {
          stmt.run(...params)
          return []
        }
      } catch (err) {
        // Re-throw with query context for easier debugging
        throw Object.assign(new Error(`SQLite error: ${(err as Error).message}\nQuery: ${sql}`), { cause: err })
      }
    }
    return _client
  }

  // -- Standard Postgres via pg (local / self-hosted Postgres) ---
  if (
    (url.startsWith('postgres://') || url.startsWith('postgresql://')) &&
    !url.includes('neon.tech') &&
    !url.includes('neondb.net')
  ) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _driver = 'postgres'
    const { Pool } = require('pg')
    const pool = new Pool({ connectionString: url, max: 10 })

    _client = async (strings: TemplateStringsArray, ...values: unknown[]): Promise<SqlRow[]> => {
      // Convert $1 placeholders -- pg uses $1 natively
      let sql = ''
      strings.forEach((s, i) => {
        sql += s
        if (i < values.length) sql += `$${i + 1}`
      })
      const result = await pool.query(sql, values as unknown[])
      return (result.rows ?? []) as SqlRow[]
    }
    return _client
  }

  // -- Neon serverless (cloud / Vercel default) ------------------
  _driver = 'neon'
  const neonSql = neon(url) as NeonQueryFunction<false, false>
  _client = neonSql as unknown as SqlQuery
  return _client
}

// -- Reset client (useful for tests / hot-reload) --------------
export function resetDbClient() {
  _client = null
}
