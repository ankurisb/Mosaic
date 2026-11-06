// lib/mssql-config.ts
// One place that builds the `mssql`/tedious connection config for the SQL Server
// family — on-prem SQL Server, Azure SQL Database, Azure Synapse (dedicated pool)
// and Microsoft Fabric's Warehouse/Lakehouse SQL analytics endpoint. All four
// speak TDS, so they share one driver; they differ only in authentication:
//   - 'sql'      : classic SQL login (user + password)
//   - 'entra_sp' : Microsoft Entra ID service principal (client credentials).
//                  tedious performs the OAuth2 client-credentials token exchange
//                  itself when given this authentication block — no manual token
//                  dance. Azure SQL / Synapse / Fabric all accept Entra tokens.
//
// For 'entra_sp' the shared connection fields are reused: username = clientId,
// password_enc = clientSecret, tenant_id = directory (tenant) id. TLS is forced on
// (Azure and Fabric require an encrypted channel).
//
// Pure + unit-tested: pass the raw db_connections row; returns a tedious config.

import { decrypt } from './encrypt'

export interface MssqlConnRow {
  host?: unknown
  port?: unknown
  database_name?: unknown
  username?: unknown
  password_enc?: unknown
  ssl_mode?: unknown
  connect_timeout_ms?: unknown
  query_timeout_ms?: unknown
  auth_mode?: unknown
  tenant_id?: unknown
}

export interface MssqlConfig {
  server: string
  port: number
  database?: string
  options: { encrypt: boolean; trustServerCertificate: boolean }
  connectionTimeout: number
  requestTimeout: number
  user?: string
  password?: string
  authentication?: {
    type: 'azure-active-directory-service-principal-secret'
    options: { clientId: string; clientSecret: string; tenantId: string }
  }
}

export function buildMssqlConfig(conn: MssqlConnRow): MssqlConfig {
  const authMode = (conn.auth_mode as string) || 'sql'
  const sslMode = (conn.ssl_mode as string) || 'prefer'
  const isEntra = authMode === 'entra_sp'

  const cfg: MssqlConfig = {
    server: String(conn.host || ''),
    port: Number(conn.port) || 1433,
    database: conn.database_name ? String(conn.database_name) : undefined,
    options: {
      // Entra (Azure SQL / Synapse / Fabric) requires an encrypted channel.
      encrypt: isEntra ? true : sslMode !== 'disable',
      // With Entra we validate the server cert (public Azure CA); with on-prem
      // SQL login we keep the prior permissive default unless verify-full.
      trustServerCertificate: isEntra ? false : sslMode !== 'verify-full',
    },
    connectionTimeout: Number(conn.connect_timeout_ms) || 5000,
    requestTimeout: Number(conn.query_timeout_ms) || 30000,
  }

  if (isEntra) {
    cfg.authentication = {
      type: 'azure-active-directory-service-principal-secret',
      options: {
        clientId: String(conn.username || ''),
        clientSecret: decrypt((conn.password_enc as string) || ''),
        tenantId: String(conn.tenant_id || ''),
      },
    }
  } else {
    cfg.user = String(conn.username || '')
    cfg.password = decrypt((conn.password_enc as string) || '')
  }

  return cfg
}
