-- migrations/005_keycloak.sql
-- Adds Keycloak/OIDC columns to sso_config.
-- Uses CREATE TABLE + INSERT ... SELECT pattern since SQLite
-- does not support ADD COLUMN IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS sso_config_new (
  id             TEXT PRIMARY KEY,
  provider       TEXT NOT NULL,
  client_id      TEXT NOT NULL,
  client_secret  TEXT,
  tenant_id      TEXT,
  enabled        INTEGER DEFAULT 1,
  realm          TEXT,   -- Keycloak realm name
  server_url     TEXT,   -- Keycloak server base URL e.g. https://auth.company.com
  discovery_url  TEXT    -- Generic OIDC: full /.well-known/openid-configuration URL
);

INSERT OR IGNORE INTO sso_config_new (id, provider, client_id, client_secret, tenant_id, enabled)
  SELECT id, provider, client_id, client_secret, tenant_id, enabled FROM sso_config;

DROP TABLE IF EXISTS sso_config;
ALTER TABLE sso_config_new RENAME TO sso_config;
