/**
 * GET /api/test-db
 * Returns a sandboxed in-memory SQLite database with sample manufacturing data.
 * Use this to verify the full chat  query_database  response flow without
 * needing a real external database.
 *
 * Steps:
 * 1. POST /api/connections { action:'create', label:'Sandbox DB', dialect:'sqlite',
 *      connection_string:'__sandbox__', database_name:'sandbox' }
 * 2. Ask Mosaic: "Show me the top 5 machines by OEE from the sandbox DB"
 */
import { getSession } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { encrypt } from '@/lib/encrypt'
import { TEST_HARNESS } from '@/lib/test-harness'
import { refreshSchemaInBackground } from '@/lib/tools'
import { syncDatasourceMap } from '@/lib/cube-sync'
import { syncToSuperset } from '@/lib/superset-sync'
export const runtime = 'nodejs'

export async function POST(req: Request) {
  const session = await getSession()
  if (!session || session.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const { action } = body

  // -- Create sandbox connection in DB --
  if (action === 'create_sandbox') {
    const sql = getDb()
    // Check if already exists
    const existing = await sql`SELECT id FROM db_connections WHERE label='Sandbox DB (built-in)'`
    if (existing.length) return Response.json({ ok: true, id: existing[0].id, already_existed: true })
    const connStrEnc = encrypt('__sandbox__')
    const rows = await sql`
      INSERT INTO db_connections(label,dialect,environment,host,port,database_name,username,password_enc,connection_string,schema_name,ssl_mode,pool_min,pool_max,connect_timeout_ms,query_timeout_ms,read_only)
      VALUES('Sandbox DB (built-in)','sqlite','development','localhost',0,'sandbox','','',${connStrEnc},'main','disable',1,1,5000,30000,true)
      RETURNING id`
    return Response.json({ ok: true, id: rows[0].id })
  }

  // -- Register the full test-data harness (6 databases + 2 file servers) --
  // Idempotent: sources already present (by label) are left untouched.
  // Hosts point at the `demo` compose profile's service names, so the
  // connections only go green once that profile is running on mosaic-net.
  if (action === 'create_harness') {
    const sql = getDb()
    const added: string[] = []
    const skipped: string[] = []

    for (const s of TEST_HARNESS) {
      if (s.kind === 'db') {
        const existing = await sql`SELECT id FROM db_connections WHERE label=${s.label}`
        if (existing.length) { skipped.push(s.label); continue }
        const passEnc = s.password ? encrypt(s.password) : null
        const rows = await sql`
          INSERT INTO db_connections(label,dialect,environment,host,port,database_name,username,password_enc,schema_name,ssl_mode,pool_min,pool_max,connect_timeout_ms,query_timeout_ms,read_only)
          VALUES(${s.label},${s.dialect},'development',${s.host},${s.port},${s.database_name},${s.username},${passEnc},${s.schema_name || 'public'},${s.ssl_mode || 'prefer'},1,5,5000,30000,true)
          RETURNING id`
        const id = (rows[0] as { id: string }).id
        // Best-effort downstream sync — harmless if the harness isn't up yet.
        syncToSuperset({
          id, label: s.label, dialect: s.dialect,
          host: s.host, port: s.port,
          database_name: s.database_name || undefined,
          username: s.username || undefined,
          password: s.password || undefined,
          ssl_mode: s.ssl_mode, schema_name: s.schema_name || undefined,
        }).catch(() => {})
        refreshSchemaInBackground(id)
        added.push(s.label)
      } else {
        const existing = await sql`SELECT id FROM file_servers WHERE label=${s.label}`
        if (existing.length) { skipped.push(s.label); continue }
        const passEnc = s.password ? encrypt(s.password) : null
        const secretEnc = s.secret_key ? encrypt(s.secret_key) : null
        await sql`
          INSERT INTO file_servers(label,transport,environment,host,port,sub_path,username,password_enc,bucket,endpoint_url,access_key_id,secret_key_enc)
          VALUES(${s.label},${s.transport},'development',${s.host || null},${s.port || null},${s.sub_path || null},${s.username || null},${passEnc},${s.bucket || null},${s.endpoint_url || null},${s.access_key_id || null},${secretEnc})`
        added.push(s.label)
      }
    }

    syncDatasourceMap().catch(() => {})
    return Response.json({ ok: true, added, skipped, already_existed: added.length === 0 })
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 })
}

export async function GET() {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })

  // Return schema + sample queries so users know what to ask Claude
  return Response.json({
    description: 'Built-in sandbox database with sample manufacturing data',
    tables: {
      machines: 'id, name, type, line, status',
      production_logs: 'id, machine_id, shift_date, shift, units_produced, units_target, cycle_time_s, oee_pct',
      downtime_events: 'id, machine_id, started_at, duration_min, reason, category',
      quality_checks: 'id, machine_id, check_date, defect_rate_pct, inspector',
    },
    sample_queries: [
      'Show the top 5 machines by OEE from last week',
      'What are the most common downtime reasons?',
      'Which machines have defect rates above 2%?',
      'Compare production vs target for each shift today',
    ],
  })
}
