-- migrations/003_audit_trail.sql
-- ISO 27001-compliant audit event log.
--
-- Every row is hash-chained to the previous row (SHA-256 of the previous
-- row's checksum + this row's payload) so that deletions or modifications
-- are detectable. The chain starts from a genesis row with prev_hash = '0'.
--
-- Indexed for the most common query patterns:
--   - By actor (who did it?)
--   - By resource (what was touched?)
--   - By action + outcome (what happened?)
--   - By time range (SOC investigation window)

CREATE TABLE IF NOT EXISTS audit_events (
  id           TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  timestamp    TEXT NOT NULL DEFAULT (datetime('now')),    -- ISO 8601 UTC
  actor_id     TEXT,                                       -- users.id (NULL for unauthenticated)
  actor_email  TEXT,
  actor_ip     TEXT,
  actor_role   TEXT,
  session_id   TEXT,                                       -- auth session token hash
  action       TEXT NOT NULL,                              -- see ACTION_* constants in lib/audit.ts
  resource     TEXT NOT NULL,                              -- e.g. "connection:abc123", "user:xyz"
  resource_id  TEXT,                                       -- bare resource ID for easy filtering
  outcome      TEXT NOT NULL DEFAULT 'success',            -- success | failure | error
  detail       TEXT,                                       -- JSON with action-specific context
  prev_hash    TEXT NOT NULL DEFAULT '0',                  -- SHA-256 of previous row's checksum
  checksum     TEXT NOT NULL                               -- SHA-256(prev_hash + payload fields)
);

CREATE INDEX IF NOT EXISTS idx_audit_actor     ON audit_events(actor_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action    ON audit_events(action, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_resource  ON audit_events(resource_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_outcome   ON audit_events(outcome, timestamp DESC);
