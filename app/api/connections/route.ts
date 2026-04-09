import { getSession } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { encrypt, decrypt } from '@/lib/encrypt'
import { Pool } from 'pg'
export const runtime = 'nodejs'

export async function GET() {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  const sql = getDb()
  const rows = await sql`SELECT id,label,dialect,environment,host,port,database_name,username,schema_name,ssl_mode,pool_min,pool_max,connect_timeout_ms,query_timeout_ms,read_only,created_at FROM db_connections ORDER BY created_at ASC`
  return Response.json({ connections: rows })
}

export async function POST(req: Request) {
  const session = await getSession()
  if (!session || session.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 })
  const sql = getDb()
  const body = await req.json()
  const { action } = body

  if (action === 'create' || action === 'update') {
    const { id, label, dialect, environment, host, port, database_name, username, password, connection_string, schema_name, ssl_mode, ssl_ca, pool_min, pool_max, connect_timeout_ms, query_timeout_ms, read_only } = body
    const passwordEnc = password ? encrypt(password) : null
    const connStrEnc = connection_string ? encrypt(connection_string) : null

    if (action === 'create') {
      const rows = await sql`
        INSERT INTO db_connections(label,dialect,environment,host,port,database_name,username,password_enc,connection_string,schema_name,ssl_mode,ssl_ca,pool_min,pool_max,connect_timeout_ms,query_timeout_ms,read_only)
        VALUES(${label},${dialect||'postgres'},${environment||'development'},${host||null},${port||5432},${database_name||null},${username||null},${passwordEnc},${connStrEnc},${schema_name||'public'},${ssl_mode||'prefer'},${ssl_ca||null},${pool_min||1},${pool_max||5},${connect_timeout_ms||5000},${query_timeout_ms||30000},${read_only||false})
        RETURNING id`
      return Response.json({ id: rows[0].id })
    } else {
      await sql`
        UPDATE db_connections SET label=${label},dialect=${dialect},environment=${environment},host=${host||null},port=${port||5432},database_name=${database_name||null},username=${username||null},${passwordEnc ? sql`password_enc=${passwordEnc},` : sql``}${connStrEnc ? sql`connection_string=${connStrEnc},` : sql``}schema_name=${schema_name||'public'},ssl_mode=${ssl_mode||'prefer'},ssl_ca=${ssl_ca||null},pool_min=${pool_min||1},pool_max=${pool_max||5},connect_timeout_ms=${connect_timeout_ms||5000},query_timeout_ms=${query_timeout_ms||30000},read_only=${read_only||false}
        WHERE id=${id}`
      return Response.json({ ok: true })
    }
  }

  if (action === 'delete') {
    await sql`DELETE FROM db_connections WHERE id=${body.id}`
    return Response.json({ ok: true })
  }

  if (action === 'test') {
    const rows = await sql`SELECT * FROM db_connections WHERE id=${body.id}`
    if (!rows.length) return Response.json({ ok: false, message: 'Connection not found' })
    const conn = rows[0]
    const connStr = conn.connection_string ? decrypt(conn.connection_string) :
      `postgresql://${conn.username}:${decrypt(conn.password_enc||'')}@${conn.host}:${conn.port}/${conn.database_name}`
    try {
      const start = Date.now()
      const pool = new Pool({ connectionString: connStr, max: 1, connectionTimeoutMillis: 5000,
        ssl: conn.ssl_mode === 'disable' ? false : conn.ssl_mode === 'require' ? { rejectUnauthorized: false } : undefined })
      const client = await pool.connect()
      await client.query('SELECT 1')
      client.release()
      await pool.end()
      return Response.json({ ok: true, latencyMs: Date.now() - start })
    } catch (e) {
      return Response.json({ ok: false, message: e instanceof Error ? e.message : 'Connection failed' })
    }
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 })
}
