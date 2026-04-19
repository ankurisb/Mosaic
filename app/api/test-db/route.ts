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
