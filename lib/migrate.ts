// lib/migrate.ts
// Lightweight migration runner for SQLite (Postgres path uses setup-pg.ts).
// Migrations live in /migrations/*.sql, named NNN_description.sql.
// Applied migrations are tracked in schema_migrations table.
// Runs automatically at startup before setupDatabase().
//
// Rules:
//   - Migrations are applied in filename order (001 before 002)
//   - Once applied, a migration is never re-run
//   - A failed migration stops the process (schema integrity is critical)
//   - The baseline (001) is idempotent — safe to run on existing DBs

import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { log } from './logger'

export async function runMigrations(db: import('better-sqlite3').Database): Promise<void> {
  // Ensure the tracking table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     TEXT PRIMARY KEY,
      filename    TEXT NOT NULL,
      applied_at  TEXT DEFAULT (datetime('now'))
    )
  `)

  const migrationsDir = join(process.cwd(), 'migrations')
  let files: string[]
  try {
    files = readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort()
  } catch {
    log.warn({ service: 'migrate' }, 'No migrations directory found — skipping')
    return
  }

  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: string }[])
      .map(r => r.version)
  )

  let ran = 0
  for (const filename of files) {
    const version = filename.split('_')[0] // e.g. "001" from "001_baseline.sql"
    if (applied.has(version)) continue

    const sql = readFileSync(join(migrationsDir, filename), 'utf8')
    log.info({ service: 'migrate', version, filename }, 'Applying migration')

    try {
      applyStatements(db, sql)
      db.prepare('INSERT INTO schema_migrations (version, filename) VALUES (?, ?)').run(version, filename)
      ran++
      log.info({ service: 'migrate', version }, 'Migration applied successfully')
    } catch (err) {
      log.error({ service: 'migrate', version, err }, 'Migration failed — aborting startup')
      throw err
    }
  }

  if (ran === 0) {
    log.info({ service: 'migrate' }, 'Schema up to date — no migrations to run')
  } else {
    log.info({ service: 'migrate', count: ran }, 'Migrations complete')
  }
}

// SQLite errors that are SAFE to ignore when a migration is additive and the DB
// already has the change (existing installs that got it via the old setup.ts blob,
// or a partially-applied re-run). Everything else is a real failure and re-thrown.
//   - "duplicate column name: X"        -> ALTER TABLE ADD COLUMN of an existing col
//   - "table X already exists"          -> CREATE TABLE without IF NOT EXISTS
//   - "index X already exists"          -> CREATE INDEX without IF NOT EXISTS
const IDEMPOTENT_ERR = /duplicate column name|already exists/i

// Execute a migration statement-by-statement rather than as one db.exec() blob, so
// an idempotent no-op (a column/table that already exists) doesn't abort the whole
// migration. This is what lets ADD COLUMN migrations run safely on installs that
// already have the column. Comments and blank lines are skipped; statements split on
// ';'. A statement that fails with a non-idempotent error still aborts (re-thrown).
function applyStatements(db: import('better-sqlite3').Database, sql: string): void {
  // Strip line comments, then split on semicolons. (Mosaic migrations are plain DDL
  // — no stored procedures / triggers with embedded semicolons — so this is safe.)
  const cleaned = sql
    .split('\n')
    .filter(line => !line.trim().startsWith('--'))
    .join('\n')
  const statements = cleaned.split(';').map(s => s.trim()).filter(Boolean)

  for (const stmt of statements) {
    try {
      db.exec(stmt)
    } catch (err) {
      const msg = (err as Error).message || ''
      if (IDEMPOTENT_ERR.test(msg)) {
        log.info({ service: 'migrate', stmt: stmt.slice(0, 60) }, 'skipping already-applied statement')
        continue
      }
      throw err
    }
  }
}
