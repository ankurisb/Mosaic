import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { decrypt } from '@/lib/encrypt'
import { parseAuthConfig, applyAuth } from '@/lib/api-auth'
import * as aws4 from 'aws4'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { connectionId, connectionType, query, limit = 500 } = await req.json()
  if (!connectionId) return NextResponse.json({ error: 'connectionId is required' }, { status: 400 })
  const db = getDb()
  const startMs = Date.now()

  // Resolve connection label for history
  async function resolveLabel(): Promise<{ label: string; dialect: string }> {
    try {
      if (connectionType === 'api') {
        const [r] = await db`SELECT c.label, s.label AS svc FROM api_connections c JOIN api_services s ON s.id = c.service_id WHERE c.id = ${connectionId} LIMIT 1`
        return { label: r ? `${String(r.svc)} / ${String(r.label)}` : connectionId, dialect: 'api' }
      }
      if (connectionType === 'fileserver') {
        const [r] = await db`SELECT label FROM file_servers WHERE id = ${connectionId} LIMIT 1`
        return { label: String(r?.label ?? connectionId), dialect: 'file' }
      }
      const [r] = await db`SELECT label, dialect FROM db_connections WHERE id = ${connectionId} LIMIT 1`
      return { label: String(r?.label ?? connectionId), dialect: String(r?.dialect ?? '') }
    } catch { return { label: connectionId, dialect: '' } }
  }

  async function writeHistory(label: string, dialect: string, rowCount: number | null, durationMs: number, status: string, error?: string) {
    try {
      await db`INSERT INTO query_history (user_id, user_email, connection_id, connection_label, connection_type, dialect, query, row_count, duration_ms, status, error)
        VALUES (${session.id}, ${session.email}, ${connectionId}, ${label}, ${connectionType}, ${dialect}, ${query?.trim() ?? ''}, ${rowCount}, ${durationMs}, ${status}, ${error ?? null})`
    } catch { /* non-blocking */ }
  }

  try {
    const { label, dialect } = await resolveLabel()
    let response: NextResponse
    switch (connectionType) {
      case 'api':        response = await runApiQuery(db, connectionId, startMs); break
      case 'fileserver': response = await runFileQuery(db, connectionId, query?.trim() || '', startMs); break
      default:           response = await runDbQuery(db, connectionId, query?.trim() || '', Math.min(Number(limit), 2000), startMs); break
    }
    const data = await response.json()
    const durationMs = Date.now() - startMs
    if (data.error) {
      await writeHistory(label, dialect, null, durationMs, 'error', data.error)
    } else {
      await writeHistory(label, dialect, data.rowCount ?? null, durationMs, 'success')
    }
    return NextResponse.json(data, { status: response.status })
  } catch (err: any) {
    const durationMs = Date.now() - startMs
    const { label, dialect } = await resolveLabel().catch(() => ({ label: connectionId, dialect: '' }))
    await writeHistory(label, dialect, null, durationMs, 'error', err?.message)
    return NextResponse.json({ error: err?.message ?? 'Query failed', durationMs }, { status: 400 })
  }
}

function injectLimit(q: string, limit: number, dialect = 'ansi'): string {
  const t = q.trim().replace(/;$/, ''), u = t.toUpperCase()
  if (!u.startsWith('SELECT') && !u.startsWith('SHOW') && !u.startsWith('WITH')) return t
  if (u.includes('LIMIT ') || u.includes(' TOP ')) return t
  if (dialect === 'mssql') return t.replace(/^SELECT /i, `SELECT TOP ${limit} `)
  return `${t} LIMIT ${limit}`
}

function ok(columns: string[], rows: any[], extra: Record<string, any>): NextResponse {
  return NextResponse.json({ columns, rows, rowCount: rows.length, ...extra })
}

// ── DB query ──────────────────────────────────────────────────────────────────

async function runDbQuery(db: any, connectionId: string, query: string, limit: number, startMs: number) {
  if (!query) return NextResponse.json({ error: 'query is required for database connections' }, { status: 400 })
  const [conn] = await db`SELECT * FROM db_connections WHERE id = ${connectionId} LIMIT 1`
  if (!conn) return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
  if (conn.read_only) {
    const u = query.toUpperCase()
    const kw = ['INSERT ', 'UPDATE ', 'DELETE ', 'DROP ', 'TRUNCATE ', 'ALTER ', 'CREATE ', 'REPLACE '].find(k => u.startsWith(k))
    if (kw) return NextResponse.json({ error: `Connection is read-only — ${kw.trim()} statements are blocked.` }, { status: 403 })
  }
  const pwd = conn.password_enc ? decrypt(conn.password_enc) : ''
  const cs = conn.connection_string ? decrypt(conn.connection_string) : null
  const meta = { durationMs: 0, dialect: conn.dialect, label: conn.label }
  let rows: any[] = [], columns: string[] = []

  if (conn.dialect === 'postgres') {
    const { Client } = await import('pg')
    const c = new Client(cs ?? { host: conn.host, port: conn.port, database: conn.database_name, user: conn.username, password: pwd, ssl: conn.ssl_mode && conn.ssl_mode !== 'disable' ? { rejectUnauthorized: false } : false, connectionTimeoutMillis: conn.connect_timeout_ms ?? 5000, query_timeout: conn.query_timeout_ms ?? 30000 })
    await c.connect()
    try { const r = await c.query(injectLimit(query, limit)); rows = r.rows; columns = r.fields.map((f: any) => f.name) } finally { await c.end() }
  }
  else if (conn.dialect === 'mysql') {
    const mysql = await import('mysql2/promise')
    const cfg: any = cs ?? { host: conn.host, port: conn.port, database: conn.database_name, user: conn.username, password: pwd, connectTimeout: conn.connect_timeout_ms ?? 5000 }
    const c = await mysql.createConnection(cfg)
    try { const [r, f] = await c.execute(injectLimit(query, limit)) as any; rows = r; columns = f?.map((x: any) => x.name) ?? Object.keys(r[0] ?? {}) } finally { await c.end() }
  }
  else if (conn.dialect === 'mssql') {
    const sql = await import('mssql')
    const pool = await sql.connect(cs ?? { server: conn.host, port: conn.port, database: conn.database_name, user: conn.username, password: pwd, options: { trustServerCertificate: true }, connectionTimeout: conn.connect_timeout_ms ?? 5000, requestTimeout: conn.query_timeout_ms ?? 30000 })
    try { const r = await pool.request().query(injectLimit(query, limit, 'mssql')); rows = r.recordset; columns = Object.keys(rows[0] ?? {}) } finally { await pool.close() }
  }
  else if (conn.dialect === 'sqlite') {
    const Database = (await import('better-sqlite3')).default
    const rawPath = (cs ?? conn.database_name) as string
    const sqliteDb = rawPath === '__sandbox__' ? (() => {
      const d = new Database(':memory:')
      d.exec(`CREATE TABLE machines(id INTEGER PRIMARY KEY,name TEXT,type TEXT,line TEXT,status TEXT);CREATE TABLE production_logs(id INTEGER PRIMARY KEY,machine_id INTEGER,shift_date TEXT,shift TEXT,units_produced INTEGER,units_target INTEGER,cycle_time_s REAL,oee_pct REAL);CREATE TABLE downtime_events(id INTEGER PRIMARY KEY,machine_id INTEGER,started_at TEXT,duration_min INTEGER,reason TEXT,category TEXT);CREATE TABLE quality_checks(id INTEGER PRIMARY KEY,machine_id INTEGER,check_date TEXT,defect_rate_pct REAL,inspector TEXT);INSERT INTO machines VALUES(1,'CNC-01','CNC','Line A','active'),(2,'CNC-02','CNC','Line A','active'),(3,'LATHE-01','Lathe','Line B','active'),(4,'PRESS-01','Press','Line B','maintenance'),(5,'MILL-01','Milling','Line C','active');INSERT INTO production_logs VALUES(1,1,'2026-04-12','Shift 1',58,64,36.4,82.1),(2,1,'2026-04-12','Shift 2',48,64,41.1,71.2),(3,1,'2026-04-12','Shift 3',36,48,37.2,81.9),(4,2,'2026-04-12','Shift 1',61,64,35.1,88.4),(5,2,'2026-04-12','Shift 2',59,64,36.0,85.2),(6,2,'2026-04-12','Shift 3',44,48,37.5,84.1),(7,3,'2026-04-12','Shift 1',42,48,52.1,79.4),(8,3,'2026-04-12','Shift 2',38,48,57.3,71.8),(9,3,'2026-04-12','Shift 3',31,40,54.2,72.1),(10,5,'2026-04-12','Shift 1',78,80,28.4,91.2),(11,5,'2026-04-12','Shift 2',74,80,29.1,88.6),(12,5,'2026-04-12','Shift 3',60,64,30.2,87.4);INSERT INTO downtime_events VALUES(1,1,'2026-04-12 09:14',42,'Tool change','Planned'),(2,1,'2026-04-12 14:30',28,'Material shortage','Unplanned'),(3,2,'2026-04-12 10:00',15,'Preventive maintenance','Planned'),(4,3,'2026-04-12 08:45',35,'Conveyor jam','Unplanned'),(5,3,'2026-04-12 15:20',20,'Tool breakage','Unplanned'),(6,4,'2026-04-12 07:00',480,'Scheduled maintenance','Planned');INSERT INTO quality_checks VALUES(1,1,'2026-04-12',1.8,'Ravi Kumar'),(2,2,'2026-04-12',0.9,'Ravi Kumar'),(3,3,'2026-04-12',2.4,'Priya Singh'),(4,5,'2026-04-12',0.6,'Priya Singh');`)
      return d
    })() : new Database(rawPath, { readonly: true })
    try { const r = sqliteDb.prepare(injectLimit(query, limit)).all() as any[]; rows = r; columns = r.length > 0 ? Object.keys(r[0]) : [] } finally { sqliteDb.close() }
  }
  else if (conn.dialect === 'mongodb') {
    let p: any; try { p = JSON.parse(query) } catch { return NextResponse.json({ error: 'MongoDB queries must be JSON: { "collection": "name", "filter": {} }' }, { status: 400 }) }
    const { MongoClient } = await import('mongodb')
    const uri = cs ?? `mongodb://${conn.username}:${pwd}@${conn.host}:${conn.port}/${conn.database_name}`
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: conn.connect_timeout_ms ?? 5000 })
    await client.connect()
    try { const col = client.db(conn.database_name).collection(p.collection); rows = (await col.find(p.filter ?? {}, { projection: p.projection }).limit(Math.min(p.limit ?? limit, limit)).toArray()).map(({ _id, ...r }) => r); columns = rows.length > 0 ? Object.keys(rows[0]) : [] } finally { await client.close() }
  }
  else if (conn.dialect === 'clickhouse') {
    const url = cs ?? `http://${conn.host}:${conn.port}`
    const res = await fetch(`${url}/?query=${encodeURIComponent(injectLimit(query, limit) + ' FORMAT JSON')}`, { headers: conn.username ? { Authorization: 'Basic ' + Buffer.from(`${conn.username}:${pwd}`).toString('base64') } : {} })
    if (!res.ok) return NextResponse.json({ error: await res.text() }, { status: 400 })
    const d = await res.json(); rows = d.data ?? []; columns = d.meta?.map((m: any) => m.name) ?? Object.keys(rows[0] ?? {})
  }
  else if (conn.dialect === 'influxdb') {
    const base = cs ?? `http://${conn.host}:${conn.port}`
    const res = await fetch(`${base}/query?db=${encodeURIComponent(conn.database_name)}&q=${encodeURIComponent(query)}`, { headers: conn.username ? { Authorization: 'Basic ' + Buffer.from(`${conn.username}:${pwd}`).toString('base64') } : {} })
    if (!res.ok) return NextResponse.json({ error: await res.text() }, { status: 400 })
    const d = await res.json(); const series = d.results?.[0]?.series?.[0]
    if (!series) return ok([], [], { ...meta, durationMs: Date.now() - startMs })
    columns = series.columns ?? []; rows = (series.values ?? []).map((v: any[]) => Object.fromEntries(columns.map((c: string, i: number) => [c, v[i]])))
  }
  else if (conn.dialect === 'elasticsearch') {
    const base = cs ?? `${conn.ssl_mode === 'disable' ? 'http' : 'https'}://${conn.host}:${conn.port ?? 9200}`
    const hdrs: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' }
    if (conn.username === '__apikey__') hdrs['Authorization'] = `ApiKey ${pwd}`
    else if (conn.username) hdrs['Authorization'] = 'Basic ' + Buffer.from(`${conn.username}:${pwd}`).toString('base64')
    if (query.toUpperCase().startsWith('GET ')) {
      const path = query.slice(4).trim()
      const res = await fetch(`${base}${path.startsWith('/') ? '' : '/'}${path}`, { headers: hdrs })
      if (!res.ok) return NextResponse.json({ error: await res.text() }, { status: 400 })
      const d = await res.json(); rows = Array.isArray(d) ? d : [d]; columns = rows.length > 0 ? Object.keys(rows[0]) : []
    } else {
      let body: any; try { body = JSON.parse(query) } catch { return NextResponse.json({ error: 'Elasticsearch: use JSON Query DSL or GET /_cat/indices for discovery' }, { status: 400 }) }
      const res = await fetch(`${base}/${conn.database_name || '_all'}/_search`, { method: 'POST', headers: hdrs, body: JSON.stringify({ size: limit, ...body }) })
      if (!res.ok) return NextResponse.json({ error: await res.text() }, { status: 400 })
      const d = await res.json()
      if (d.aggregations) { rows = [{ aggregations: d.aggregations, took_ms: d.took, total: d.hits?.total?.value }]; columns = ['aggregations', 'took_ms', 'total'] }
      else { rows = (d.hits?.hits ?? []).map((h: any) => ({ _id: h._id, _score: h._score, ...h._source })); columns = rows.length > 0 ? Object.keys(rows[0]) : [] }
    }
  }
  else { return NextResponse.json({ error: `Unsupported dialect: ${conn.dialect}` }, { status: 400 }) }

  meta.durationMs = Date.now() - startMs
  return ok(columns, rows, meta)
}


// ── API endpoint query ─────────────────────────────────────────────────────────

async function runApiQuery(db: any, connectionId: string, startMs: number) {
  const rows_q = await db`SELECT c.*, s.base_url, s.auth_type, s.auth_config, s.default_headers, s.api_version, s.version_header, s.request_timeout_ms, s.label AS service_label FROM api_connections c JOIN api_services s ON s.id = c.service_id WHERE c.id = ${connectionId} LIMIT 1`
  const conn = rows_q[0] as any
  if (!conn) return NextResponse.json({ error: 'API endpoint not found' }, { status: 404 })
  const base = (conn.base_url as string).replace(/\/$/, '')
  const basePath = (conn.base_path as string || '')
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  try { Object.assign(headers, JSON.parse(conn.default_headers || '{}')) } catch {}
  const authResult = await applyAuth(conn.service_id, conn.auth_type || '', parseAuthConfig(conn.auth_config), headers)
  if (!authResult.ok) return NextResponse.json({ error: (authResult as any).error }, { status: 401 })
  if (conn.api_version && conn.version_header) headers[conn.version_header] = conn.api_version
  const url = `${base}${basePath.startsWith('/') ? '' : '/'}${basePath}`
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(conn.request_timeout_ms ?? 30000) })
  if (!res.ok) return NextResponse.json({ error: `${res.status} ${res.statusText}: ${(await res.text()).slice(0, 300)}` }, { status: 400 })
  const data = await res.json()
  // Find the data array — try common envelope keys first, then auto-detect the first array-valued key
  let arr: any[]
  if (Array.isArray(data)) {
    arr = data
  } else {
    const knownKey = ['value', 'data', 'results', 'items', 'records', 'rows'].find(k => Array.isArray(data[k]))
    if (knownKey) {
      arr = data[knownKey]
    } else {
      // Auto-detect: find the first key whose value is a non-empty array of objects
      const autoKey = Object.keys(data).find(k => Array.isArray(data[k]) && data[k].length > 0 && typeof data[k][0] === 'object')
      arr = autoKey ? data[autoKey] : [data]
    }
  }
  const rows = arr.slice(0, 500)
  const columns = rows.length > 0 ? Object.keys(rows[0]) : []
  return NextResponse.json({ columns, rows, rowCount: rows.length, durationMs: Date.now() - startMs, dialect: 'api', label: `${conn.service_label} / ${conn.label}` })
}

// ── File server query ─────────────────────────────────────────────────────────

async function runFileQuery(db: any, serverId: string, hint: string, startMs: number) {
  const [server] = await db`SELECT * FROM file_servers WHERE id = ${serverId} LIMIT 1`
  if (!server) return NextResponse.json({ error: 'File server not found' }, { status: 404 })
  const transport = server.transport as string
  const fileTypes = ((server.file_types as string) || 'csv,xlsx,pdf,json,xml').split(',').map((s: string) => s.trim())
  const hintLow = (hint || '').toLowerCase()

  if (transport === 's3') {
    const secretKey = server.secret_key_enc ? decrypt(server.secret_key_enc) : ''
    const accessKeyId = server.access_key_id || ''
    const endpoint = (server.endpoint_url || 'https://s3.amazonaws.com').replace(/\/$/, '')
    const bucket = server.bucket || ''
    const prefix = server.sub_path || ''
    const listUrl = `${endpoint}/${bucket}?list-type=2${prefix ? `&prefix=${encodeURIComponent(prefix)}` : ''}&max-keys=100`
    const lu = new URL(listUrl)
    const lo: any = { host: lu.host, method: 'GET', path: lu.pathname + lu.search, service: 's3', region: 'us-east-1' }
    aws4.sign(lo, { accessKeyId, secretAccessKey: secretKey })
    const lr = await fetch(listUrl, { headers: lo.headers })
    if (!lr.ok) return NextResponse.json({ error: `S3 list failed: ${await lr.text()}` }, { status: 400 })
    const keys = [...(await lr.text()).matchAll(/<Key>([^<]+)<\/Key>/g)].map(m => m[1]).filter(k => fileTypes.some((t: string) => k.toLowerCase().endsWith('.' + t)))
    if (!keys.length) return NextResponse.json({ error: `No matching files in s3://${bucket}` }, { status: 404 })
    const best = keys.find(k => k.toLowerCase().includes(hintLow)) ?? keys[0]
    const getUrl = `${endpoint}/${bucket}/${best}`
    const gu = new URL(getUrl)
    const go: any = { host: gu.host, method: 'GET', path: gu.pathname, service: 's3', region: 'us-east-1' }
    aws4.sign(go, { accessKeyId, secretAccessKey: secretKey })
    const gr = await fetch(getUrl, { headers: go.headers })
    if (!gr.ok) return NextResponse.json({ error: `S3 get failed: ${await gr.text()}` }, { status: 400 })
    return parseAndRespond(Buffer.from(await gr.arrayBuffer()), best.split('/').pop() ?? best, server.label, { size: 0, modified: '' }, startMs)
  }

  if (transport === 'sftp') {
    return new Promise<NextResponse>(async (resolve) => {
      const { Client } = await import('ssh2')
      const conn = new Client()
      const pwd = server.password_enc ? decrypt(server.password_enc) : ''
      const pk = server.ssh_key_enc ? decrypt(server.ssh_key_enc) : undefined
      const rPath = [server.share_path, server.sub_path].filter(Boolean).join('/') || '/'
      conn.on('ready', () => conn.sftp((err: any, sftp: any) => {
        if (err) { conn.end(); return resolve(NextResponse.json({ error: err.message }, { status: 400 })) }
        sftp.readdir(rPath, (err: any, list: any[]) => {
          if (err) { conn.end(); return resolve(NextResponse.json({ error: err.message }, { status: 400 })) }
          const matching = (list || []).filter((f: any) => fileTypes.some((t: string) => f.filename.toLowerCase().endsWith('.' + t))).sort((a: any, b: any) => (b.attrs.mtime ?? 0) - (a.attrs.mtime ?? 0))
          if (!matching.length) { conn.end(); return resolve(NextResponse.json({ error: `No files on SFTP at ${rPath}` }, { status: 404 })) }
          const best = matching.find((f: any) => f.filename.toLowerCase().includes(hintLow)) ?? matching[0]
          const chunks: Buffer[] = []
          sftp.createReadStream(`${rPath}/${best.filename}`).on('data', (c: Buffer) => chunks.push(c)).on('end', async () => { conn.end(); resolve(await parseAndRespond(Buffer.concat(chunks), best.filename, server.label, { size: best.attrs.size, modified: new Date((best.attrs.mtime ?? 0) * 1000).toISOString() }, startMs)) }).on('error', (e: any) => { conn.end(); resolve(NextResponse.json({ error: e.message }, { status: 400 })) })
        })
      })).on('error', (e: any) => resolve(NextResponse.json({ error: e.message }, { status: 400 }))).connect({ host: server.host, port: server.port ?? 22, username: server.username, password: pk ? undefined : pwd, privateKey: pk ?? undefined })
    })
  }

  if (transport === 'local') {
    const fs = await import('fs/promises'); const path = await import('path')
    const base = path.join(server.share_path || '/', server.sub_path || '')
    const entries = await fs.readdir(base, { withFileTypes: true })
    const stats = await Promise.all(entries.filter(e => e.isFile() && fileTypes.some((t: string) => e.name.toLowerCase().endsWith('.' + t))).map(async e => { const s = await fs.stat(path.join(base, e.name)); return { name: e.name, path: path.join(base, e.name), size: s.size, modified: s.mtime.toISOString() } }))
    const sorted = stats.sort((a, b) => b.modified.localeCompare(a.modified))
    if (!sorted.length) return NextResponse.json({ error: `No matching files at ${base}` }, { status: 404 })
    const best = sorted.find(f => f.name.toLowerCase().includes(hintLow)) ?? sorted[0]
    return parseAndRespond(await fs.readFile(best.path), best.name, server.label, best, startMs)
  }

  return NextResponse.json({ error: `Transport "${transport}" not yet supported in Query Runner (s3, sftp, local supported)` }, { status: 400 })
}


// ── File parsing ──────────────────────────────────────────────────────────────

async function parseAndRespond(buf: Buffer, filename: string, label: string, meta: any, startMs: number): Promise<NextResponse> {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  const base = { durationMs: Date.now() - startMs, dialect: 'file', label, file: filename, modified: meta.modified }

  if (ext === 'csv') {
    const lines = buf.toString('utf-8').split('\n').filter(Boolean)
    const headers = lines[0]?.split(',').map((h: string) => h.trim().replace(/^"|"$/g, '')) ?? []
    const rows = lines.slice(1, 501).map(line => Object.fromEntries(headers.map((h: string, i: number) => [h, line.split(',')[i]?.trim().replace(/^"|"$/g, '') ?? ''])))
    return NextResponse.json({ columns: headers, rows, rowCount: rows.length, ...base })
  }
  if (ext === 'json') {
    const data = JSON.parse(buf.toString('utf-8'))
    const arr = Array.isArray(data) ? data : data.data ?? data.results ?? data.items ?? [data]
    const rows = arr.slice(0, 500); const columns = rows.length > 0 ? Object.keys(rows[0]) : []
    return NextResponse.json({ columns, rows, rowCount: rows.length, ...base })
  }
  if (ext === 'xlsx' || ext === 'xls') {
    const XLSX = await import('xlsx')
    const wb = XLSX.read(buf, { type: 'buffer' }); const ws = wb.Sheets[wb.SheetNames[0]]
    const data: any[] = XLSX.utils.sheet_to_json(ws, { defval: null })
    const rows = data.slice(0, 500); const columns = rows.length > 0 ? Object.keys(rows[0]) : []
    return NextResponse.json({ columns, rows, rowCount: rows.length, ...base })
  }
  if (ext === 'xml') {
    return NextResponse.json({ columns: ['content'], rows: [{ content: buf.toString('utf-8').slice(0, 5000) }], rowCount: 1, ...base, note: 'XML returned as raw text' })
  }
  return NextResponse.json({ columns: ['file', 'size_bytes', 'modified'], rows: [{ file: filename, size_bytes: meta.size, modified: meta.modified }], rowCount: 1, ...base, note: `${ext.toUpperCase()} — add parsing library for content extraction` })
}
