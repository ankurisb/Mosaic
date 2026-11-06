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

export async function snowflakeQuery(conn: SnowflakeConnRow, sql: string, maxRows: number): Promise<{ rows: Record<string, unknown>[]; fields: string[] }> {
  const mod = await import('snowflake-sdk')
  const snowflake = (mod as unknown as { default?: typeof mod }).default || mod
  const connection = (snowflake as unknown as { createConnection: (c: SnowflakeConfig) => SnowflakeConn }).createConnection(buildSnowflakeConfig(conn))

  await new Promise<void>((resolve, reject) => connection.connect((err) => (err ? reject(err) : resolve())))
  try {
    const rows = await new Promise<Record<string, unknown>[]>((resolve, reject) => {
      connection.execute({
        sqlText: sql,
        complete: (err: Error | undefined, _stmt: unknown, out: Record<string, unknown>[] | undefined) => (err ? reject(err) : resolve(out || [])),
      })
    })
    const capped = rows.length > maxRows ? rows.slice(0, maxRows) : rows
    return { rows: capped, fields: capped.length ? Object.keys(capped[0]) : [] }
  } finally {
    await new Promise<void>((resolve) => { try { connection.destroy(() => resolve()) } catch { resolve() } })
  }
}

interface SnowflakeConn {
  connect: (cb: (err: Error | undefined) => void) => void
  execute: (opts: { sqlText: string; complete: (err: Error | undefined, stmt: unknown, rows: Record<string, unknown>[] | undefined) => void }) => void
  destroy: (cb: () => void) => void
}
