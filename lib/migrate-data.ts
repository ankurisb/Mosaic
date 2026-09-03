// lib/migrate-data.ts
// Data migrations that need application LOGIC (not just DDL), run at server boot
// after the schema migrations. Unlike lib/migrate.ts (pure .sql files) these create
// rows / transform data, so they live in code. Each must be idempotent — it only
// touches rows that haven't been migrated yet — and best-effort, so a hiccup logs
// and continues rather than crashing boot.
import { log } from './logger'

export async function runDataMigrations(sql: ReturnType<typeof import('./db').getDb>): Promise<void> {
  await migrateInlineAlertsToSavedQueries(sql)
  await migrateReportSectionsToSavedQueries(sql)
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

// Step 4: report templates store sections as JSON, each DB section carrying inline SQL
// (section.query). For each such section without a saved_query_id, create a saved
// query (owned by the template's creator) and set the section's saved_query_id.
// Idempotent — only sections still lacking a saved_query_id — and best-effort.
async function migrateReportSectionsToSavedQueries(sql: ReturnType<typeof import('./db').getDb>): Promise<void> {
  try {
    const templates = await sql`SELECT id, name, sections, created_by FROM report_templates` as unknown as { id: string; name: string; sections: unknown; created_by: string | null }[]
    let migratedSections = 0
    for (const tpl of templates) {
      let sections: Record<string, unknown>[]
      try { sections = typeof tpl.sections === 'string' ? JSON.parse(tpl.sections) : (tpl.sections as Record<string, unknown>[]) } catch { continue }
      if (!Array.isArray(sections)) continue

      let changed = false
      for (const s of sections) {
        const needsMigration = s.source_type === 'database' && s.query && typeof s.query === 'string'
          && (s.query as string).trim() && !s.saved_query_id
        if (!needsMigration) continue

        let connLabel = ''
        if (s.source_id) {
          const c = await sql`SELECT label FROM db_connections WHERE id = ${s.source_id as string} LIMIT 1` as unknown as { label: string }[]
          connLabel = c[0]?.label ?? ''
        }
        const inserted = await sql`
          INSERT INTO saved_queries (owner_id, name, description, connection_id, connection_label, connection_type, query)
          VALUES (${tpl.created_by ?? null}, ${`Report: ${tpl.name} — ${(s.title as string) || 'section'}`},
                  ${'Migrated from an inline report section'}, ${s.source_id ?? null}, ${connLabel}, ${'db'}, ${s.query as string})
          RETURNING id
        ` as unknown as { id: string }[]
        if (inserted[0]?.id) { s.saved_query_id = inserted[0].id; changed = true; migratedSections++ }
      }
      if (changed) {
        await sql`UPDATE report_templates SET sections = ${JSON.stringify(sections)} WHERE id = ${tpl.id}`
      }
    }
    if (migratedSections) log.info({ service: 'migrate-data', count: migratedSections }, 'migrated inline report sections to saved queries')
  } catch (e) {
    log.warn({ service: 'migrate-data', err: (e as Error).message }, 'report-section -> saved-query migration skipped')
  }
}
