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
  query_timeout_ms?: unknown
}

// A connection's Schema may name SEVERAL schemas to introspect, comma/semicolon/newline separated,
// each a bare `schema` in the default catalog (database_name) or a `catalog.schema` elsewhere.
// Parsed into de-duplicated targets, each labelled with the fully-qualified Unity Catalog form
// `catalog.schema` so the generated cube's sql_table resolves as `catalog.schema.table`.
export interface DbxSchemaTarget { catalog: string; schema: string; label: string }
export function parseDatabricksSchemas(schemaName: unknown, defaultCatalog: string): DbxSchemaTarget[] {
  const clean = (s: string) => s.replace(/[`"';]/g, '').trim()
  const specs = String(schemaName ?? '').split(/[,;\n]+/).map(clean).filter(Boolean)
  const list = specs.map(spec => {
    const dot = spec.indexOf('.')
    const catalog = dot === -1 ? defaultCatalog : spec.slice(0, dot)
    const schema = dot === -1 ? spec : spec.slice(dot + 1)
    const label = catalog ? `${catalog}.${schema}` : schema
    return { catalog, schema, label }
  })
  const seen = new Set<string>()
  return list.filter(t => { const k = `${t.catalog}\u0000${t.schema}`; if (seen.has(k)) return false; seen.add(k); return true })
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
      // Bound query EXECUTION (not just the connect): a runaway/heavy statement must not hang the
      // request. Race execute+fetch against query_timeout_ms (default 120s); on expiry cancel the
      // operation server-side so Databricks stops computing, then reject cleanly.
      const queryTimeoutMs = Number(conn.query_timeout_ms) || 120000
      const op = await session.executeStatement(sql, { runAsync: true, maxRows })
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const rows = (await Promise.race([
          op.fetchAll(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              try { op.cancel?.() } catch { /* noop */ }
              reject(new Error(`Databricks query timed out after ${queryTimeoutMs}ms`))
            }, queryTimeoutMs)
          }),
        ])) as Record<string, unknown>[]
        const capped = rows.length > maxRows ? rows.slice(0, maxRows) : rows
        return { rows: capped, fields: capped.length ? Object.keys(capped[0]) : [] }
      } finally {
        if (timer) clearTimeout(timer)
        await op.close().catch(() => {})
      }
    } finally {
      await session.close().catch(() => {})
    }
  } finally {
    await client.close().catch(() => {})
  }
}

interface DBOperation { fetchAll: () => Promise<unknown[]>; close: () => Promise<void>; cancel?: () => Promise<void> }
interface DBSession {
  executeStatement: (sql: string, opts: { runAsync: boolean; maxRows: number }) => Promise<DBOperation>
  close: () => Promise<void>
}
interface DBClient {
  connect: (o: { host: string; path: string; token: string }) => Promise<DBClient>
  openSession: (o?: { initialCatalog?: string; initialSchema?: string }) => Promise<DBSession>
  close: () => Promise<void>
}
