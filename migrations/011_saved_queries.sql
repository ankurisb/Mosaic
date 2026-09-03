-- migrations/011_saved_queries.sql
-- The single source of truth for user-authored queries (v1.3.x).
--
-- Queries were previously scattered: the Query Builder saved to browser
-- localStorage, dashboards stored SQL on dashboard_charts, and rules/reports each
-- had their own free-text SQL. This table makes the Query Builder the ONE place a
-- query is authored and stored; dashboards and rules/alerts reference a saved query
-- by id instead of carrying their own SQL.
--
-- Statement-by-statement runner tolerates re-runs (CREATE IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS saved_queries (
  id                TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  owner_id          TEXT REFERENCES users(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  description       TEXT NOT NULL DEFAULT '',
  connection_id     TEXT,
  connection_label  TEXT NOT NULL DEFAULT '',
  connection_type   TEXT NOT NULL DEFAULT 'db',
  query             TEXT NOT NULL DEFAULT '',
  created_at        TEXT DEFAULT (datetime('now')),
  updated_at        TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_saved_queries_owner ON saved_queries(owner_id);
