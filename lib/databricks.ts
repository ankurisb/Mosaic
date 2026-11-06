// lib/databricks.ts
// Databricks SQL warehouse source for Mosaic, via @databricks/sql (Thrift/Arrow).
// Field mapping onto the shared db_connections row:
//   host          = workspace hostname (e.g. abc.cloud.databricks.com; scheme stripped)
//   http_path     = SQL warehouse HTTP path (e.g. /sql/1.0/warehouses/abc123)
//   password_enc  = personal access token (PAT)
//   database_name = catalog (optional, Unity Catalog)
//   schema_name   = schema (optional)
//
// Read-only is enforced by the statement allowlist (SELECT/WITH) + the SQL guard
// (blocks DML/DDL, COPY INTO, and INSERT OVERWRITE DIRECTORY — Spark's exfiltration
// path). The connect is bounded by an explicit timeout.

import { decrypt } from './encrypt'

export interface DatabricksConnRow {
  host?: unknown
  http_path?: unknown
  password_enc?: unknown
  database_name?: unknown
  schema_name?: unknown
  connect_timeout_ms?: unknown
}

export interface DatabricksConfig {
  host: string
  path: string
  token: string
  catalog?: string
  schema?: string
}

export function buildDatabricksConfig(conn: DatabricksConnRow): DatabricksConfig {
  return {
    host: String(conn.host || '').replace(/^https?:\/\//, '').replace(/\/+$/, ''),
    path: String(conn.http_path || ''),
    token: decrypt((conn.password_enc as string) || ''),
    catalog: conn.database_name ? String(conn.database_name) : undefined,
    schema: conn.schema_name ? String(conn.schema_name) : undefined,
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Databricks ${label} timed out after ${ms}ms`)), ms)),
  ])
}

export async function databricksQuery(conn: DatabricksConnRow, sql: string, maxRows: number): Promise<{ rows: Record<string, unknown>[]; fields: string[] }> {
  const mod = await import('@databricks/sql')
  const DBSQLClient = (mod as unknown as { DBSQLClient: new () => DBClient }).DBSQLClient
  const cfg = buildDatabricksConfig(conn)
  const timeoutMs = Number(conn.connect_timeout_ms) || 15000
  const client = new DBSQLClient()
  await withTimeout(client.connect({ host: cfg.host, path: cfg.path, token: cfg.token }), timeoutMs, 'connect')
  try {
    const session = await client.openSession(
      cfg.catalog || cfg.schema ? { initialCatalog: cfg.catalog, initialSchema: cfg.schema } : undefined,
    )
    try {
      const op = await session.executeStatement(sql, { runAsync: true, maxRows })
      const rows = (await op.fetchAll()) as Record<string, unknown>[]
      await op.close()
      const capped = rows.length > maxRows ? rows.slice(0, maxRows) : rows
      return { rows: capped, fields: capped.length ? Object.keys(capped[0]) : [] }
    } finally {
      await session.close().catch(() => {})
    }
  } finally {
    await client.close().catch(() => {})
  }
}

interface DBOperation { fetchAll: () => Promise<unknown[]>; close: () => Promise<void> }
interface DBSession {
  executeStatement: (sql: string, opts: { runAsync: boolean; maxRows: number }) => Promise<DBOperation>
  close: () => Promise<void>
}
interface DBClient {
  connect: (o: { host: string; path: string; token: string }) => Promise<DBClient>
  openSession: (o?: { initialCatalog?: string; initialSchema?: string }) => Promise<DBSession>
  close: () => Promise<void>
}
