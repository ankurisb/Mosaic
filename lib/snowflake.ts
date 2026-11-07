// lib/snowflake.ts
// Snowflake source for Mosaic. snowflake-sdk is callback-based, so wrap it.
// Field mapping onto the shared db_connections row:
//   host          = Snowflake account identifier (e.g. xy12345.eu-west-1)
//   username      = user
//   password_enc  = password (auth_mode='password') | private key PEM (auth_mode='keypair')
//   database_name = database
//   schema_name   = schema
//   warehouse     = virtual warehouse (compute)
//   role          = role to assume
//   auth_mode     = 'password' (default) | 'keypair'
//
// Read-only is enforced by the statement allowlist (SELECT/WITH) + the SQL guard
// (blocks DML/DDL and COPY INTO <location> / GET / PUT — Snowflake's stage/S3
// exfiltration + file-transfer paths).

import { decrypt } from './encrypt'

export interface SnowflakeConnRow {
  host?: unknown
  username?: unknown
  password_enc?: unknown
  database_name?: unknown
  schema_name?: unknown
  warehouse?: unknown
  role?: unknown
  auth_mode?: unknown
  connect_timeout_ms?: unknown
}

export interface SnowflakeConfig {
  account: string
  username: string
  database?: string
  schema?: string
  warehouse?: string
  role?: string
  password?: string
  authenticator?: string
  privateKey?: string
}

export function buildSnowflakeConfig(conn: SnowflakeConnRow): SnowflakeConfig {
  const authMode = (conn.auth_mode as string) || 'password'
  const cfg: SnowflakeConfig = {
    account: String(conn.host || ''),
    username: String(conn.username || ''),
    database: conn.database_name ? String(conn.database_name) : undefined,
    schema: conn.schema_name ? String(conn.schema_name) : undefined,
    warehouse: conn.warehouse ? String(conn.warehouse) : undefined,
    role: conn.role ? String(conn.role) : undefined,
  }
  if (authMode === 'keypair') {
    cfg.authenticator = 'SNOWFLAKE_JWT'
    cfg.privateKey = decrypt((conn.password_enc as string) || '')
  } else {
    cfg.password = decrypt((conn.password_enc as string) || '')
  }
  return cfg
}

// --- result normalisation ---------------------------------------------------
// snowflake-sdk returns some types in shapes the UI/charting layer can't use directly:
//  - NUMBER is returned as a JS double, so a NUMBER(38,0) key/counter silently loses
//    precision (…e+37). We fetch numbers AS STRINGS to keep them exact, then convert back
//    to a JS number only when that is lossless (≤15 significant digits); bigger values stay
//    strings.
//  - VARIANT/OBJECT/ARRAY come back as parsed JS objects/arrays → would render as
//    "[object Object]". Serialise them to a single JSON string cell.
//  - BINARY comes back as a Node Buffer → emit a hex string.
function numMaybeString(s: unknown): unknown {
  if (typeof s !== 'string' || !/^-?\d+(\.\d+)?$/.test(s)) return s
  const sig = s.replace(/[-.]/g, '').replace(/^0+/, '')
  return sig.length > 15 ? s : Number(s)
}
interface SfColumn { getName?: () => string; getType?: () => string; isNumber?: () => boolean; isBinary?: () => boolean }
export function processSnowflakeRows(rows: Record<string, unknown>[], cols: SfColumn[] | undefined): Record<string, unknown>[] {
  if (!rows.length) return rows
  const kind: Record<string, 'number' | 'semi' | 'binary'> = {}
  try {
    for (const c of cols || []) {
      const name = c.getName ? c.getName() : ''
      if (!name) continue
      let t = ''
      try { t = String(c.getType ? c.getType() : '').toLowerCase() } catch { /* ignore */ }
      if (t === 'fixed' || t === 'real' || (c.isNumber && c.isNumber())) kind[name] = 'number'
      else if (t === 'variant' || t === 'object' || t === 'array') kind[name] = 'semi'
      else if (t === 'binary' || (c.isBinary && c.isBinary())) kind[name] = 'binary'
    }
  } catch { /* no metadata → fall back to value-shape handling below */ }
  const hex = (v: unknown) => { try { return Buffer.from(v as Buffer).toString('hex') } catch { return String(v) } }
  return rows.map(r => {
    const o: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(r)) {
      if (v === null || v === undefined) { o[k] = v; continue }
      const kd = kind[k]
      if (kd === 'number') o[k] = numMaybeString(v)
      else if (kd === 'binary' || Buffer.isBuffer(v)) o[k] = hex(v)
      else if (kd === 'semi' || (typeof v === 'object' && !(v instanceof Date))) o[k] = JSON.stringify(v)
      else o[k] = v
    }
    return o
  })
}

export async function snowflakeQuery(conn: SnowflakeConnRow, sql: string, maxRows: number): Promise<{ rows: Record<string, unknown>[]; fields: string[] }> {
  const mod = await import('snowflake-sdk')
  const snowflake = (mod as unknown as { default?: typeof mod }).default || mod
  const timeoutMs = Number(conn.connect_timeout_ms) || 15000
  const cfg = buildSnowflakeConfig(conn) as SnowflakeConfig & { timeout?: number }
  cfg.timeout = timeoutMs   // snowflake-sdk login timeout
  const connection = (snowflake as unknown as { createConnection: (c: SnowflakeConfig) => SnowflakeConn }).createConnection(cfg)

  // Bound the connect: snowflake-sdk retries an unreachable account for a long time,
  // so race it against an explicit timeout and tear the socket down on expiry.
  await new Promise<void>((resolve, reject) => {
    let done = false
    const timer = setTimeout(() => { if (!done) { done = true; try { connection.destroy(() => {}) } catch { /* noop */ } reject(new Error(`Snowflake connection timed out after ${timeoutMs}ms`)) } }, timeoutMs)
    connection.connect((err) => { if (done) return; done = true; clearTimeout(timer); err ? reject(err) : resolve() })
  })
  try {
    // STREAM the result and stop at maxRows instead of buffering the whole result set into
    // memory and slicing after — a `LIMIT 5` over a billion-row table must not pull a billion
    // rows first. streamResult: true makes snowflake-sdk page rows through a Readable; we push
    // up to maxRows then destroy the stream so no further pages are fetched.
    const { rows, cols } = await new Promise<{ rows: Record<string, unknown>[]; cols: SfColumn[] }>((resolve, reject) => {
      let settled = false
      const acc: Record<string, unknown>[] = []
      const done = (cols: SfColumn[]) => { if (!settled) { settled = true; resolve({ rows: acc, cols }) } }
      const fail = (e: Error) => { if (!settled) { settled = true; reject(e) } }
      connection.execute({
        sqlText: sql,
        fetchAsString: ['Number'],   // keep NUMBER exact (see processSnowflakeRows)
        streamResult: true,
        complete: (err: Error | undefined, stmt: unknown) => {
          if (err) return fail(err)
          const s = stmt as { streamRows?: () => NodeJS.ReadableStream & { destroy?: () => void }; getColumns?: () => SfColumn[] }
          let cols: SfColumn[] = []
          try { cols = s.getColumns?.() || [] } catch { /* no metadata */ }
          const stream = s.streamRows ? s.streamRows() : null
          if (!stream) return done(cols)
          stream.on('error', fail)
          stream.on('data', (row: Record<string, unknown>) => {
            if (acc.length < maxRows) acc.push(row)
            if (acc.length >= maxRows) { try { stream.destroy?.() } catch { /* noop */ } done(cols) }
          })
          stream.on('end', () => done(cols))
          stream.on('close', () => done(cols))
        },
      })
    })
    const processed = processSnowflakeRows(rows, cols)
    return { rows: processed, fields: processed.length ? Object.keys(processed[0]) : [] }
  } finally {
    await new Promise<void>((resolve) => { try { connection.destroy(() => resolve()) } catch { resolve() } })
  }
}

interface SnowflakeConn {
  connect: (cb: (err: Error | undefined) => void) => void
  execute: (opts: { sqlText: string; fetchAsString?: string[]; streamResult?: boolean; complete: (err: Error | undefined, stmt: unknown, rows: Record<string, unknown>[] | undefined) => void }) => void
  destroy: (cb: () => void) => void
}
