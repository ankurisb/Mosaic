import { getSession } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { encrypt, decrypt } from '@/lib/encrypt'
import { syncToSuperset } from '@/lib/superset-sync'
import { Pool } from 'pg'
import { invalidateSchema, refreshSchemaInBackground } from '@/lib/tools'
export const runtime = 'nodejs'

export async function GET() {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  const sql = getDb()
  const rows = await sql`SELECT id,label,dialect,environment,host,port,database_name,username,schema_name,ssl_mode,pool_min,pool_max,connect_timeout_ms,query_timeout_ms,read_only,mcp_endpoint,created_at FROM db_connections ORDER BY created_at ASC`
  return Response.json({ connections: rows })
}

export async function POST(req: Request) {
  const session = await getSession()
  if (!session || session.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 })
  const sql = getDb()
  const body = await req.json()
  const { action } = body

  if (action === 'create' || action === 'update') {
    const { id, label, dialect, environment, host, port, database_name, username, password, connection_string, schema_name, ssl_mode, ssl_ca, pool_min, pool_max, connect_timeout_ms, query_timeout_ms, read_only, mcp_endpoint, mcp_token } = body
    const passwordEnc = password ? encrypt(password) : null
    const connStrEnc = connection_string ? encrypt(connection_string) : null
    const mcpTokenEnc = mcp_token ? encrypt(mcp_token) : null
    if (action === 'create') {
      const rows = await sql`
        INSERT INTO db_connections(label,dialect,environment,host,port,database_name,username,password_enc,connection_string,schema_name,ssl_mode,ssl_ca,pool_min,pool_max,connect_timeout_ms,query_timeout_ms,read_only,mcp_endpoint,mcp_token)
        VALUES(${label},${dialect||'postgres'},${environment||'development'},${host||null},${port||5432},${database_name||null},${username||null},${passwordEnc},${connStrEnc},${schema_name||'public'},${ssl_mode||'prefer'},${ssl_ca||null},${pool_min||1},${pool_max||5},${connect_timeout_ms||5000},${query_timeout_ms||30000},${read_only||false},${mcp_endpoint||null},${mcpTokenEnc})
        RETURNING id`
      syncToSuperset({
        id: (rows[0] as { id: string }).id,
        label,
        dialect: dialect || 'postgres',
        host: host || undefined,
        port: port ? Number(port) : undefined,
        database_name: database_name || undefined,
        username: username || undefined,
        password: password || undefined,
        connection_string: connection_string || undefined,
        ssl_mode: ssl_mode || undefined,
        schema_name: schema_name || undefined,
      }).catch(() => {})
      refreshSchemaInBackground((rows[0] as { id: string }).id)
      return Response.json({ id: (rows[0] as { id: string }).id })
    } else {
      await sql`
        UPDATE db_connections SET
          label              = ${label},
          dialect            = ${dialect},
          environment        = ${environment},
          host               = ${host || null},
          port               = ${port || 5432},
          database_name      = ${database_name || null},
          username           = ${username || null},
          password_enc       = COALESCE(${passwordEnc},  password_enc),
          connection_string  = COALESCE(${connStrEnc},   connection_string),
          mcp_token          = COALESCE(${mcpTokenEnc},  mcp_token),
          schema_name        = ${schema_name || 'public'},
          ssl_mode           = ${ssl_mode || 'prefer'},
          ssl_ca             = ${ssl_ca || null},
          pool_min           = ${pool_min || 1},
          pool_max           = ${pool_max || 5},
          connect_timeout_ms = ${connect_timeout_ms || 5000},
          query_timeout_ms   = ${query_timeout_ms || 30000},
          read_only          = ${read_only || false},
          mcp_endpoint       = ${mcp_endpoint || null}
        WHERE id = ${id}`
      invalidateSchema(id)
      refreshSchemaInBackground(id)
      return Response.json({ ok: true })
    }
  }

  if (action === 'delete') {
    await sql`DELETE FROM db_connections WHERE id=${body.id}`
    await invalidateSchema(body.id)
    return Response.json({ ok: true })
  }

  if (action === 'refresh_schema') {
    if (!body.id) return Response.json({ error: 'id required' }, { status: 400 })
    await invalidateSchema(body.id)
    refreshSchemaInBackground(body.id)
    return Response.json({ ok: true })
  }

  if (action === 'test') {
    const rows = await sql`SELECT * FROM db_connections WHERE id=${body.id}`
    if (!rows.length) return Response.json({ ok: false, message: 'Connection not found' })
    const conn = rows[0] as Record<string, unknown>
    const dialect = (conn.dialect as string) || 'postgres'
    const start = Date.now()

    try {
      if (dialect === 'postgres') {
        const connStr = conn.connection_string
          ? decrypt(conn.connection_string as string)
          : `postgresql://${conn.username}:${decrypt((conn.password_enc as string)||'')}@${conn.host}:${conn.port}/${conn.database_name}`
        const ssl = (conn.ssl_mode as string) === 'disable' ? false
          : (conn.ssl_mode as string) === 'verify-full' ? { rejectUnauthorized: true, ca: (conn.ssl_ca as string)||undefined }
          : { rejectUnauthorized: false }
        const pool = new Pool({ connectionString: connStr, max: 1, connectionTimeoutMillis: 5000, ssl })
        const client = await pool.connect()
        const result = await client.query('SELECT version()')
        client.release(); await pool.end()
        return Response.json({ ok: true, latencyMs: Date.now()-start, detail: (result.rows[0].version as string).split(' ').slice(0,2).join(' ') })
      }

      if (dialect === 'mysql') {
        const mysql = await import('mysql2/promise')
        const connStr = conn.connection_string
          ? decrypt(conn.connection_string as string)
          : `mysql://${conn.username}:${decrypt((conn.password_enc as string)||'')}@${conn.host}:${conn.port}/${conn.database_name}`
        const connection = await mysql.createConnection(connStr)
        const [rows2] = await connection.execute('SELECT VERSION() as v')
        await connection.end()
        const ver = (rows2 as Array<{v:string}>)[0]?.v || 'MySQL'
        return Response.json({ ok: true, latencyMs: Date.now()-start, detail: `MySQL ${ver}` })
      }

      if (dialect === 'mssql') {
        const mssql = await import('mssql')
        const pass = decrypt((conn.password_enc as string) || '')
        const config: Record<string, unknown> = {
          user: conn.username as string, password: pass,
          server: conn.host as string, port: (conn.port as number) || 1433,
          database: conn.database_name as string,
          options: { encrypt: (conn.ssl_mode as string) !== 'disable', trustServerCertificate: (conn.ssl_mode as string) !== 'verify-full' },
          connectionTimeout: 5000,
        }
        const pool = conn.connection_string
          ? await mssql.connect(decrypt(conn.connection_string as string))
          : await mssql.connect(config as any)
        const result = await pool.request().query('SELECT @@VERSION as v')
        await pool.close()
        const ver = ((result.recordset[0] as {v:string})?.v || 'SQL Server').split('\n')[0].slice(0,40)
        return Response.json({ ok: true, latencyMs: Date.now()-start, detail: ver })
      }

      if (dialect === 'sqlite') {
        const Database = (await import('better-sqlite3')).default
        const dbPath = (conn.connection_string ? decrypt(conn.connection_string as string) : conn.database_name) as string
        if (dbPath === '__sandbox__') {
          const db2 = new Database(':memory:')
          const row = db2.prepare('SELECT sqlite_version() as v').get() as {v:string}
          db2.close()
          return Response.json({ ok: true, latencyMs: Date.now()-start, detail: 'SQLite ' + row.v + ' (sandbox)' })
        }
        const db2 = new Database(dbPath, { readonly: true })
        const row = db2.prepare('SELECT sqlite_version() as v').get() as {v:string}
        db2.close()
        return Response.json({ ok: true, latencyMs: Date.now()-start, detail: 'SQLite ' + row.v })
      }

      if (dialect === 'mongodb') {
        const { MongoClient } = await import('mongodb')
        const connStr = conn.connection_string
          ? decrypt(conn.connection_string as string)
          : `mongodb://${conn.username}:${decrypt((conn.password_enc as string)||'')}@${conn.host}:${conn.port}/${conn.database_name}`
        const client = new MongoClient(connStr, { serverSelectionTimeoutMS: 5000 })
        await client.connect()
        const info = await client.db('admin').command({ serverStatus: 1, repl: 0, metrics: 0, locks: 0 }).catch(() =>
          client.db('admin').command({ buildInfo: 1 })
        )
        await client.close()
        return Response.json({ ok: true, latencyMs: Date.now()-start, detail: `MongoDB ${info.version || ''}` })
      }

      if (dialect === 'clickhouse') {
        const protocol = (conn.ssl_mode as string) === 'disable' ? 'http' : 'https'
        const base = conn.connection_string ? decrypt(conn.connection_string as string) : `${protocol}://${conn.host}:${conn.port || 8123}`
        const url = new URL('/', base)
        url.searchParams.set('query', 'SELECT version() as version')
        url.searchParams.set('default_format', 'JSONEachRow')
        const headers: Record<string,string> = {}
        if (conn.username) headers['Authorization'] = 'Basic ' + Buffer.from(`${conn.username}:${decrypt(conn.password_enc as string||'')}`).toString('base64')
        const res = await fetch(url.toString(), { headers, signal: AbortSignal.timeout(5000) })
        if (!res.ok) throw new Error(`ClickHouse HTTP ${res.status}: ${(await res.text()).slice(0,100)}`)
        const text = await res.text()
        const row = JSON.parse(text.trim().split('\n')[0] || '{}')
        return Response.json({ ok: true, latencyMs: Date.now()-start, detail: `ClickHouse ${row.version || ''}` })
      }

      if (dialect === 'influxdb') {
        const protocol = (conn.ssl_mode as string) === 'disable' ? 'http' : 'https'
        const base = conn.connection_string ? decrypt(conn.connection_string as string) : `${protocol}://${conn.host}:${conn.port || 8086}`
        const token = decrypt(conn.password_enc as string || '')
        const pingUrl = new URL('/ping', base)
        const res = await fetch(pingUrl.toString(), {
          headers: token ? { 'Authorization': `Token ${token}` } : {},
          signal: AbortSignal.timeout(5000),
        })
        const version = res.headers.get('x-influxdb-version') || res.headers.get('X-Influxdb-Version') || 'unknown'
        if (res.status === 204 || res.ok) return Response.json({ ok: true, latencyMs: Date.now()-start, detail: `InfluxDB ${version}` })
        throw new Error(`InfluxDB ping returned ${res.status}`)
      }

      return Response.json({ ok: false, message: `Unknown dialect: ${dialect}` })
    } catch (e) {
      return Response.json({ ok: false, message: (e instanceof Error ? e.message : 'Connection failed') })
    }
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 })
}
