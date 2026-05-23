-- 006_query_history.sql
-- Tracks every query executed via the Query Builder

CREATE TABLE IF NOT EXISTS query_history (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  user_id       TEXT REFERENCES users(id),
  user_email    TEXT,
  connection_id TEXT NOT NULL,
  connection_label TEXT NOT NULL,
  connection_type  TEXT NOT NULL,  -- 'db' | 'api' | 'fileserver'
  dialect       TEXT,
  query         TEXT,
  row_count     INTEGER,
  duration_ms   INTEGER,
  status        TEXT NOT NULL DEFAULT 'success',  -- 'success' | 'error'
  error         TEXT,
  executed_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_query_history_user    ON query_history(user_id);
CREATE INDEX IF NOT EXISTS idx_query_history_executed ON query_history(executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_query_history_conn    ON query_history(connection_id);
