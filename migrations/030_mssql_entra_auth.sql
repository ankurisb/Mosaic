-- migrations/030_mssql_entra_auth.sql
-- Microsoft Entra ID (Azure AD) auth for the SQL Server family (Azure SQL /
-- Synapse / Microsoft Fabric), which all speak TDS and reuse the mssql driver.
--
-- auth_mode: 'sql' (classic SQL login, default) | 'entra_sp' (Entra service
--            principal — client credentials). For 'entra_sp' the shared fields are
--            reused: username = clientId, password_enc = clientSecret, and
--            tenant_id below = directory (tenant) id.
-- Both nullable / defaulted → back-compatible with existing connections.
ALTER TABLE db_connections ADD COLUMN auth_mode TEXT DEFAULT 'sql';
ALTER TABLE db_connections ADD COLUMN tenant_id TEXT;
