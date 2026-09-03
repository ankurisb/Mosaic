// instrumentation.ts
// Next.js runs register() ONCE when the server process boots, before any route,
// page, or API handler is served. This is where DB migrations belong: an existing
// install that upgrades and hits ANY endpoint first gets a migrated schema, because
// the server won't serve a request until migrations have run. (Previously migrations
// only ran when the home page happened to be rendered, so an API-first request could
// hit a not-yet-migrated DB and fail with "no such table".)
export async function register() {
  // Only in the Node.js server runtime — never Edge or during the build, where
  // better-sqlite3 / the DB aren't available.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const { log } = await import('@/lib/logger')
  try {
    const dbUrl = process.env.DATABASE_URL || ''
    const isPostgres = /^postgres(ql)?:\/\//i.test(dbUrl)

    if (isPostgres) {
      // Postgres schema is owned by setup-pg.ts (idempotent CREATE/ALTER IF NOT
      // EXISTS). Run it at boot so upgrades apply before serving.
      const { setupDatabasePostgres } = await import('@/lib/setup-pg')
      await setupDatabasePostgres()
      log.info({ service: 'instrumentation' }, 'Postgres schema ensured at startup')
    } else {
      // SQLite: run the file-based migration runner against the DB file.
      const file = dbUrl.replace(/^sqlite:\/\//, '').replace(/^sqlite:/, '')
      if (!file) {
        log.warn({ service: 'instrumentation' }, 'No sqlite DATABASE_URL — skipping migrations')
        return
      }
      const Database = (await import('better-sqlite3')).default
      const { runMigrations } = await import('@/lib/migrate')
      const db = new Database(file)
      try {
        await runMigrations(db)
        log.info({ service: 'instrumentation' }, 'SQLite migrations ensured at startup')
      } finally {
        db.close()
      }
    }

    // Data migrations (application logic, not DDL) run after the schema is in place,
    // for both SQLite and Postgres, via the app's DB interface.
    const { getDb } = await import('@/lib/db')
    const { runDataMigrations } = await import('@/lib/migrate-data')
    await runDataMigrations(getDb())
    log.info({ service: 'instrumentation' }, 'Data migrations ensured at startup')
  } catch (err) {
    // A migration failure means the schema is not in a known-good state. Fail LOUD
    // rather than serve requests against a broken/partial schema — a crash at boot
    // is a clear signal, whereas serving would produce confusing per-request errors.
    log.error({ service: 'instrumentation', err }, 'Startup migrations FAILED — refusing to start')
    throw err
  }
}
