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
      db.exec(sql)
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
