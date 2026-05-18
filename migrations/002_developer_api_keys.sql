-- migrations/002_developer_api_keys.sql
-- Developer API key table for machine-to-machine access to /api/v1/*

CREATE TABLE IF NOT EXISTS developer_api_keys (
  id           TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  name         TEXT NOT NULL,
  key_hash     TEXT NOT NULL UNIQUE,   -- SHA-256 hash of the key (never store plaintext)
  key_preview  TEXT NOT NULL,          -- first 8 chars for display (e.g. "mk_live_a")
  scopes       TEXT NOT NULL DEFAULT '["read"]',  -- JSON array: read | write | admin
  rate_limit   INTEGER NOT NULL DEFAULT 100,      -- requests per hour
  created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  last_used_at TEXT,
  expires_at   TEXT,                   -- NULL = never expires
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS developer_api_usage (
  id           TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  key_id       TEXT NOT NULL REFERENCES developer_api_keys(id) ON DELETE CASCADE,
  endpoint     TEXT NOT NULL,
  method       TEXT NOT NULL,
  status_code  INTEGER,
  latency_ms   INTEGER,
  created_at   TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_dev_api_usage_key  ON developer_api_usage(key_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dev_api_keys_active ON developer_api_keys(active, created_at DESC);
