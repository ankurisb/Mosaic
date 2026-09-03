// lib/migrate-data.ts
// Data migrations that need application LOGIC (not just DDL), run at server boot
// after the schema migrations. Unlike lib/migrate.ts (pure .sql files) these create
// rows / transform data, so they live in code. Each must be idempotent — it only
// touches rows that haven't been migrated yet — and best-effort, so a hiccup logs
// and continues rather than crashing boot.
import { log } from './logger'

export async function runDataMigrations(sql: ReturnType<typeof import('./db').getDb>): Promise<void> {
  await migrateInlineAlertsToSavedQueries(sql)
}

// Step 3b: legacy alerts stored inline SQL (integration_rules.query). Move each to a
// saved query (owned by the alert's creator) and repoint the alert via
// saved_query_id, so alerts reference the single query store like everything else.
async function migrateInlineAlertsToSavedQueries(sql: ReturnType<typeof import('./db').getDb>): Promise<void> {
  try {
    const legacy = await sql`
      SELECT id, name, source_id, query, created_by
      FROM integration_rules
      WHERE query IS NOT NULL AND query != ''
        AND (saved_query_id IS NULL OR saved_query_id = '')
        AND source_type IN ('database', 'query')
    ` as unknown as { id: string; name: string; source_id: string | null; query: string; created_by: string | null }[]

    for (const r of legacy) {
      let connLabel = ''
      if (r.source_id) {
        const c = await sql`SELECT label FROM db_connections WHERE id = ${r.source_id} LIMIT 1` as unknown as { label: string }[]
        connLabel = c[0]?.label ?? ''
      }
      const inserted = await sql`
        INSERT INTO saved_queries (owner_id, name, description, connection_id, connection_label, connection_type, query)
        VALUES (${r.created_by ?? null}, ${`Alert: ${r.name}`}, ${'Migrated from an inline alert query'},
                ${r.source_id ?? null}, ${connLabel}, ${'db'}, ${r.query})
        RETURNING id
      ` as unknown as { id: string }[]
      const sqId = inserted[0]?.id
      if (sqId) await sql`UPDATE integration_rules SET saved_query_id = ${sqId} WHERE id = ${r.id}`
    }
    if (legacy.length) log.info({ service: 'migrate-data', count: legacy.length }, 'migrated legacy inline-SQL alerts to saved queries')
  } catch (e) {
    log.warn({ service: 'migrate-data', err: (e as Error).message }, 'inline-alert -> saved-query migration skipped')
  }
}
