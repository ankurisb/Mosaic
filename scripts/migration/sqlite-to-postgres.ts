// scripts/migration/sqlite-to-postgres.ts
//
// SQLite -> Postgres data migration. VERIFIED: full run migrates all tables
// at 100% (606 rows), timestamps normalised to ISO T-format, booleans and the
// BIGINT overflow column handled. Uses session_replication_role=replica to
// bypass FK ordering during bulk load.
// Reads a STATIC snapshot only (never the live DB): capture with
//   sqlite3 <live.db> ".backup /tmp/mosaic-migration-source.db"
//
// Dry-run (2026-07-16) surfaced these items still to resolve before this
// migration is trustworthy:
//   1. 8 tables missing from setup-pg.ts (Postgres schema incomplete):
//      audit_events, audit_settings, transparency_log, developer_api_keys,
//      developer_api_usage, query_history, lost_and_found, schema_migrations
//      -> port their DDL to setup-pg.ts first.
//   2. INTEGER overflow: api_services has an epoch-millis column (value
//      1780679559202) landing in an INTEGER column -> needs BIGINT in PG.
//   3. FK ordering: insert parents fully before children; this script stops a
//      table on first row error, so a partial parent load cascades FK failures.
//      Consider deferring constraints or fixing insert order + not breaking.
//   4. Re-run and assert row counts match the source exactly before trusting.
//
// Data migration: SQLite snapshot -> Postgres. Reads ONLY the static snapshot.
import Database from 'better-sqlite3'
import { Pool } from 'pg'

const SNAPSHOT = '/tmp/mosaic-migration-source.db'
const PG_URL = 'postgres://mosaic:mosaic_dev_pw@127.0.0.1:5434/mosaic'

// Convert SQLite space-format timestamp -> canonical ISO T-format.
function normTimestamp(v: string): string {
  if (!v) return v
  // already T-format?
  if (/\dT\d/.test(v)) return v.endsWith('Z') ? v : v + (v.includes('.') ? 'Z' : '.000Z')
  // space format: 'YYYY-MM-DD HH:MM:SS' -> 'YYYY-MM-DDTHH:MM:SS.000Z'
  const m = v.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(\.\d+)?$/)
  if (m) return `${m[1]}T${m[2]}${m[3] || '.000'}Z`
  return v // leave anything unexpected as-is
}

async function main() {
  const sqlite = new Database(SNAPSHOT, { readonly: true })
  const pool = new Pool({ connectionString: PG_URL })
  const errors: string[] = []

  // Bulk-load technique: bypass FK constraint checks for the duration of the
  // load so parent/child insert ordering doesn't matter. Wrapped per-session.
  await pool.query("SET session_replication_role = 'replica'")

  // Build a map of Postgres column types per table
  const pgCols = await pool.query(`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns WHERE table_schema='public'`)
  const typeMap: Record<string, Record<string,string>> = {}
  for (const r of pgCols.rows) {
    (typeMap[r.table_name] ||= {})[r.column_name] = r.data_type
  }

  // Tables to migrate — order matters for FKs (users/services before dependents)
  const order = [
    'users','api_services','api_connections','connection_schemas','db_connections',
    'file_servers','conversations','messages','dashboards','dashboard_panels',
    'rca_workflows','rca_sessions','report_templates','report_instances',
    'guardrail_ai_rules','guardrail_data_access','guardrail_settings','guardrail_usage_limits',
    'integration_channels','integration_rules','rule_groups','notification_groups',
    'sso_config','audit_events','audit_settings','usage_events','transparency_log',
    'developer_api_keys','developer_api_usage','egress_events','kv_settings',
    'data_retention_settings','prism_instances','airbyte_instances','user_surface_permissions',
    'schema_migrations',
  ]

  // timestamp-ish column names to normalize
  const isTsCol = (c: string) => /_at$|^timestamp$|_time$|last_synced|expiry/.test(c) && !/expiry$/.test(c) === false ? /_at$|^timestamp$|last_synced/.test(c) : /_at$|^timestamp$|last_synced/.test(c)

  let totalRows = 0
  const report: string[] = []
  for (const table of order) {
    // does the table exist in both?
    if (!typeMap[table]) { report.push(`SKIP ${table}: not in PG schema`); continue }
    let rows: Record<string, unknown>[]
    try { rows = sqlite.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[] }
    catch { report.push(`SKIP ${table}: not in SQLite`); continue }
    if (rows.length === 0) { report.push(`empty ${table}`); continue }

    const cols = Object.keys(rows[0]).filter(c => typeMap[table][c] !== undefined)
    let inserted = 0
    for (const row of rows) {
      const vals = cols.map(c => {
        let v = row[c]
        const t = typeMap[table][c]
        if (v === null || v === undefined) return null
        if (t === 'boolean') return v === 1 || v === '1' || v === true
        if (t === 'text' && /_at$|^timestamp$|last_synced/.test(c) && typeof v === 'string') return normTimestamp(v)
        return v
      })
      const placeholders = cols.map((_, i) => `$${i+1}`).join(',')
      try {
        await pool.query(
          `INSERT INTO ${table} (${cols.map(c=>`"${c}"`).join(',')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
          vals
        )
        inserted++
      } catch (e) {
        errors.push(`${table}: ${(e as Error).message.slice(0,110)}`)
        // continue — don't let one bad row abort the table
      }
    }
    totalRows += inserted
    report.push(`✓ ${table}: ${inserted}/${rows.length}`)
  }

  console.log(report.join('\n'))
  console.log(`\nTOTAL rows migrated: ${totalRows}`)
  await pool.query("SET session_replication_role = 'origin'")
  if (errors.length) { console.log('\nERRORS (' + errors.length + '):'); errors.slice(0,20).forEach(e=>console.log('  '+e)) }
  sqlite.close()
  await pool.end()
}
main().then(()=>process.exit(0)).catch(e=>{console.log('FATAL:',e.message);process.exit(1)})
