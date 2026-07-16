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

// -- Raw SQL fragments ----------------------------------------
// Tagged-template interpolations normally become bound parameters ($1, ?).
// Sometimes we need to inline a raw SQL expression instead (e.g. NOW() vs
// datetime('now')). Wrap such a value in raw() and both client paths will
// splice it into the SQL string rather than parameterising it.
// SECURITY: only ever pass CONSTANT, code-controlled strings to raw() — never
// user input. It bypasses parameterisation by design.
class RawSql {
  constructor(public readonly sql: string) {}
}
export function raw(sql: string): RawSql {
  return new RawSql(sql)
}

/** The current dialect's "now" expression, as a raw SQL fragment, producing a
 *  canonical ISO-8601 UTC string (YYYY-MM-DDTHH:MM:SS.sssZ) to match the
 *  toISOString() format used elsewhere. Postgres emits T-format via to_char;
 *  SQLite keeps its native space-format for backward-compat with existing local
 *  data (SQLite installs never mix with Postgres, so they stay internally
 *  consistent; the SQLite->Postgres data migration normalises to T-format).
 *  Use in INSERT/UPDATE value positions: sql`... SET updated_at=${nowExpr()} ...` */
export function nowExpr(): RawSql {
  return raw(isPostgres()
    ? `to_char(NOW() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`
    : "datetime('now')")
}

/** A raw SQL fragment for "N units ago", in the same canonical format as
 *  nowExpr() for the current dialect, so range comparisons stay consistent.
 *  unit/amount are code-controlled only (never user input). */
export function intervalAgo(amount: number, unit: 'days' | 'hours' | 'minutes' | 'months'): RawSql {
  const n = Math.abs(Math.trunc(amount))
  // Timestamps stored as TEXT. Postgres emits T-format ISO text to match
  // nowExpr()/toISOString(); SQLite compares as strings in its native format.
  if (isPostgres()) return raw(`to_char((NOW() - INTERVAL '${n} ${unit}') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`)
  return raw(`datetime('now','-${n} ${unit}')`)
}

// Columns that store free-form user text that may coincidentally look like
// JSON (e.g. pasted objects in chat). Skip auto-parse to preserve string type.
const SKIP_AUTO_PARSE = new Set([
  'content',          // messages.content — chat message bodies
  'message_template', // rule_groups / integration_rules — notification templates
])

let _client: SqlQuery | null = null
let _driver: 'sqlite' | 'postgres' | 'neon' = 'sqlite'
let _rawDb: import('better-sqlite3').Database | null = null

/** Returns the raw better-sqlite3 Database instance, or null on Postgres/Neon.
 *  Use for dynamic queries that can't be expressed as tagged-template literals
 *  (e.g. variable WHERE clauses with arbitrary filter combinations). */
export function getRawDb(): import('better-sqlite3').Database | null {
  if (_rawDb) return _rawDb
  // Trigger getDb() to initialise _rawDb as a side-effect if not done yet
  getDb()
  return _rawDb
}

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
    // Durability + restart-safety hardening. WAL alone survives clean crashes,
    // but an abrupt SIGKILL mid-checkpoint (e.g. Docker Desktop bouncing during
    // a resource change) can still corrupt. synchronous=NORMAL is the correct,
    // durable pairing with WAL; busy_timeout makes writers wait on a lock rather
    // than fail; wal_autocheckpoint keeps the WAL bounded so restarts have less
    // uncommitted state to reconcile.
    db.pragma('synchronous = NORMAL')
    db.pragma('busy_timeout = 5000')
    db.pragma('wal_autocheckpoint = 1000')
    db.pragma('foreign_keys = ON')

    // Graceful shutdown: on SIGTERM/SIGINT, checkpoint the WAL into the main DB
    // and close cleanly, so a container stop/restart never cuts a write or a
    // checkpoint mid-flight. This is the key fix for restart-induced corruption.
    const shutdown = () => {
      try {
        db.pragma('wal_checkpoint(TRUNCATE)')
        db.close()
      } catch { /* already closing */ }
      process.exit(0)
    }
    process.once('SIGTERM', shutdown)
    process.once('SIGINT', shutdown)
    _rawDb = db

    // Wrap in a tagged-template function matching Neon's interface
    _client = async (strings: TemplateStringsArray, ...values: unknown[]): Promise<SqlRow[]> => {
      // Build parameterised query  ($1, $2  ?, ?)
      let sql = ''
      const params: unknown[] = []
      strings.forEach((s, i) => {
        sql += s
        if (i < values.length) {
          const v = values[i]
          if (v instanceof RawSql) {
            sql += v.sql            // raw fragment — inline, don't parameterise
          } else {
            params.push(typeof v === 'boolean' ? (v ? 1 : 0) : v)
            sql += '?'
          }
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

    // Expose a direct pool-query fn for the queryRaw() dynamic escape hatch.
    _pgQuery = async (text: string, params: unknown[]) => {
      const r = await pool.query(text, params)
      return (r.rows ?? []) as Record<string, unknown>[]
    }

    _client = async (strings: TemplateStringsArray, ...values: unknown[]): Promise<SqlRow[]> => {
      // Convert to $1 placeholders. RawSql fragments are inlined and do NOT
      // consume a placeholder slot, so we track the param index separately.
      let sql = ''
      const params: unknown[] = []
      strings.forEach((s, i) => {
        sql += s
        if (i < values.length) {
          const v = values[i]
          if (v instanceof RawSql) {
            sql += v.sql            // raw fragment — inline
          } else {
            params.push(v)
            sql += `$${params.length}`
          }
        }
      })
      const result = await pool.query(sql, params)
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

// -- Dynamic query escape hatch -------------------------------
// For queries that can't be expressed as a fixed tagged template — e.g. a
// WHERE clause built from a variable number of optional filters. Takes a SQL
// string using `?` positional placeholders and a params array, and runs it on
// whichever driver is active (converting `?` -> `$N` for Postgres/Neon).
// This replaces the old getRawDb().prepare() pattern, which only worked on
// SQLite. The SQL string itself must be code-controlled; only the params array
// may carry user input (it is always parameterised, never interpolated).
export async function queryRaw(sqlText: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  const client = getDb()
  if (_driver === 'sqlite') {
    const db = _rawDb!
    // Booleans -> 1/0 to match the tagged-template client's behaviour.
    const p = params.map(v => (typeof v === 'boolean' ? (v ? 1 : 0) : v))
    const stmt = db.prepare(sqlText)
    if (/^\s*(select|pragma|with)/i.test(sqlText) || /\breturning\b/i.test(sqlText)) {
      return stmt.all(...p) as Record<string, unknown>[]
    }
    stmt.run(...p)
    return []
  }
  // Postgres / Neon: convert ? -> $1, $2, ... (ignoring ? inside string literals
  // is out of scope — our dynamic SQL never contains literal ? in strings).
  let n = 0
  const converted = sqlText.replace(/\?/g, () => `$${++n}`)
  if (_driver === 'postgres') {
    // reuse the pool via the tagged client is awkward; call getDb-created client
    // through a direct pool query by re-parsing. Simplest: use the tagged client
    // by constructing a template. Instead we keep a dedicated path:
    return await pgQuery(converted, params)
  }
  // Neon
  const neonClient = client as unknown as (q: string, p: unknown[]) => Promise<Record<string, unknown>[]>
  return await neonClient(converted, params)
}

// Holds the pg pool query fn when on Postgres, set during getDb() init.
let _pgQuery: ((text: string, params: unknown[]) => Promise<Record<string, unknown>[]>) | null = null
async function pgQuery(text: string, params: unknown[]): Promise<Record<string, unknown>[]> {
  if (!_pgQuery) throw new Error('Postgres pool not initialised')
  return _pgQuery(text, params)
}
