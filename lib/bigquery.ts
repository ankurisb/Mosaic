// lib/bigquery.ts
// Google BigQuery source for Mosaic. Field mapping onto the shared db_connections row:
//   database_name = GCP projectId (billing/default project)
//   schema_name   = default dataset (optional; used for introspection)
//   password_enc  = service-account JSON key (encrypted) when auth_mode='service_account'
//   host          = apiEndpoint override (optional) — set this to a BigQuery emulator
//   auth_mode     = 'service_account' (default) | 'none' (emulator / no auth)
//
// Read-only is enforced by the statement allowlist (SELECT/WITH) + the SQL guard
// (blocks DML/DDL and EXPORT DATA, BigQuery's GCS-exfiltration path). BigQuery has
// no transaction-wrapped READ ONLY like Postgres, so the guard is the control.

import { decrypt } from './encrypt'
import { generateKeyPairSync } from 'crypto'

export interface BigQueryConnRow {
  database_name?: unknown
  schema_name?: unknown
  password_enc?: unknown
  host?: unknown
  auth_mode?: unknown
  connect_timeout_ms?: unknown
}

// A throwaway RSA key so the google-auth JWT signer has a valid PEM to sign with
// when talking to an emulator that ignores auth. Generated once per process; never
// a real credential. Only used when auth_mode='none'.
let _dummyKey: string | null = null
function dummyPrivateKey(): string {
  if (_dummyKey) return _dummyKey
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  })
  _dummyKey = privateKey as string
  return _dummyKey
}

export interface BigQueryClientConfig {
  projectId: string
  apiEndpoint?: string
  credentials: { client_email: string; private_key: string }
}

export function buildBigQueryConfig(conn: BigQueryConnRow): BigQueryClientConfig {
  const authMode = (conn.auth_mode as string) || 'service_account'
  const projectId = String(conn.database_name || '') || 'mosaic-local'

  if (authMode === 'none') {
    // Emulator: custom endpoint + a throwaway credential the emulator ignores.
    return {
      projectId,
      apiEndpoint: conn.host ? String(conn.host) : undefined,
      credentials: { client_email: 'emulator@mosaic.local', private_key: dummyPrivateKey() },
    }
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
  const bq = new BigQuery(buildBigQueryConfig(conn) as unknown as ConstructorParameters<typeof BigQuery>[0])
  const [raw] = await bq.query({ query: sql, maxResults: maxRows })
  const rows = (raw as Record<string, unknown>[]).map(flattenRow)
  const fields = rows.length ? Object.keys(rows[0]) : []
  return { rows, fields }
}
