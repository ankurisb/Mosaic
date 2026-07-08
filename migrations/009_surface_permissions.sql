-- 009_surface_permissions.sql
-- Per-user access grants for external interfaces (n8n, Superset, Airbyte, CISO).
-- Absence of a row = no access (default deny). Admins are granted all surfaces
-- in application code (lib/permissions.ts) and never require rows here.
-- Idempotent: safe to run on existing databases.

CREATE TABLE IF NOT EXISTS user_surface_permissions (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  surface    TEXT NOT NULL,             -- 'n8n' | 'superset' | 'airbyte' | 'ciso'
  allowed    INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, surface)
);

CREATE INDEX IF NOT EXISTS idx_surface_perms_user
  ON user_surface_permissions (user_id);
