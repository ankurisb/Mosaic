-- migrations/004_audit_retention.sql
-- Adds retention policy settings and a chain integrity log table.
--
-- audit_settings: stores retention_days (default 365) and integrity check metadata
-- The cleanup job (run nightly via the built-in scheduler) deletes events older
-- than retention_days, then re-signs the chain from genesis so it stays valid.

CREATE TABLE IF NOT EXISTS audit_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Defaults
INSERT OR IGNORE INTO audit_settings (key, value) VALUES
  ('retention_days',        '365'),
  ('chain_verify_enabled',  'true'),
  ('last_chain_verify_at',  ''),
  ('last_chain_verify_ok',  ''),
  ('last_purge_at',         ''),
  ('last_purge_count',      '0');
