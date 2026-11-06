// lib/bigquery.ts
// Google BigQuery source for Mosaic. Field mapping onto the shared db_connections row:
//   database_name = GCP projectId (billing/default project — where query jobs run)
//   schema_name   = default dataset (optional; used for introspection). May be a bare
//                   `dataset` in the billing project, OR a cross-project `dataProject.dataset`
//                   when the data lives in another project (the enterprise data/compute split).
//                   In the cross-project case introspection emits 3-part
//                   `dataProject.dataset.table` keys so Cube references them correctly; jobs
//                   still bill to database_name and the SA just needs read access on the data.
//   password_enc  = service-account JSON key (encrypted) when auth_mode='service_account'
//   host          = apiEndpoint override (optional) — set this to a BigQuery emulator
//   auth_mode     = 'service_account' (default) | 'none' (emulator / no auth)
//
// Read-only is enforced by the statement allowlist (SELECT/WITH) + the SQL guard
// (blocks DML/DDL and EXPORT DATA, BigQuery's GCS-exfiltration path). BigQuery has
// no transaction-wrapped READ ONLY like Postgres, so the guard is the control.

import { decrypt } from './encrypt'

export interface BigQueryConnRow {
  database_name?: unknown
  schema_name?: unknown
  password_enc?: unknown
  host?: unknown
  auth_mode?: unknown
  connect_timeout_ms?: unknown
}

export interface BigQueryClientConfig {
  projectId: string
  apiEndpoint?: string
  // For auth_mode='none' (emulator) there are NO credentials — bigQueryQuery
  // attaches a no-network stub auth client instead (see below).
  credentials?: { client_email: string; private_key: string }
  emulator?: boolean
}

export function buildBigQueryConfig(conn: BigQueryConnRow): BigQueryClientConfig {
  const authMode = (conn.auth_mode as string) || 'service_account'
  const projectId = String(conn.database_name || '') || 'mosaic-local'

  if (authMode === 'none') {
    // Emulator: custom endpoint, no real credentials. The google-auth library
    // would otherwise do a real OAuth2 token exchange with Google even against a
    // custom apiEndpoint, so bigQueryQuery injects a stub auth client.
    return { projectId, apiEndpoint: conn.host ? String(conn.host) : undefined, emulator: true }
  }

  // Service-account JSON key, stored (encrypted) in password_enc.
  let sa: { client_email?: string; private_key?: string; project_id?: string } = {}
  try { sa = JSON.parse(decrypt((conn.password_enc as string) || '') || '{}') } catch { /* leave empty → clear error on connect */ }
  const cfg: BigQueryClientConfig = {
    projectId: projectId !== 'mosaic-local' ? projectId : (sa.project_id || projectId),
    credentials: { client_email: String(sa.client_email || ''), private_key: String(sa.private_key || '') },
  }
  if (conn.host) cfg.apiEndpoint = String(conn.host) // optional custom endpoint (private endpoints)
  return cfg
}

// BigQuery returns typed scalars (DATE/TIMESTAMP/NUMERIC) as wrapper objects with a
// `.value`; flatten those so rows are plain JSON for the UI/charting.
function flattenRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    if (v && typeof v === 'object' && 'value' in (v as Record<string, unknown>)) out[k] = (v as { value: unknown }).value
    else out[k] = v
  }
  return out
}

export async function bigQueryQuery(conn: BigQueryConnRow, sql: string, maxRows: number): Promise<{ rows: Record<string, unknown>[]; fields: string[] }> {
  const { BigQuery } = await import('@google-cloud/bigquery')
  const cfg = buildBigQueryConfig(conn)
  const opts: Record<string, unknown> = { projectId: cfg.projectId }
  if (cfg.apiEndpoint) opts.apiEndpoint = cfg.apiEndpoint
  if (cfg.emulator) {
    // No-network stub auth client so the emulator (which ignores auth) is reached
    // without a real Google token exchange.
    const { OAuth2Client } = await import('google-auth-library')
    const stub = new OAuth2Client() as unknown as Record<string, unknown>
    stub.getAccessToken = async () => ({ token: 'emulator', res: null })
    stub.getRequestHeaders = async () => ({ Authorization: 'Bearer emulator' })
    stub.request = async (o: { url?: string }) => { const r = await fetch(String(o.url), {}); return { data: await r.json(), status: r.status } }
    opts.authClient = stub
  } else if (cfg.credentials) {
    opts.credentials = cfg.credentials
  }
  const bq = new BigQuery(opts as unknown as ConstructorParameters<typeof BigQuery>[0])
  const [raw] = await bq.query({ query: sql, maxResults: maxRows })
  const rows = (raw as Record<string, unknown>[]).map(flattenRow)
  const fields = rows.length ? Object.keys(rows[0]) : []
  return { rows, fields }
}
