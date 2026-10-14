-- migrations/016_user_memory.sql
-- Cross-conversation memory: short, durable facts about a user (preferences,
-- terminology, project context) that Mosaic recalls in future chats. Per-user
-- (never shared across users); optional project tag. Written explicitly via the
-- save_memory tool or the Settings → Memory page. Additive; no existing
-- behaviour changes.
CREATE TABLE IF NOT EXISTS user_memory (
  id          TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  user_id     TEXT NOT NULL,
  project     TEXT,
  category    TEXT NOT NULL DEFAULT 'fact',   -- preference | fact | project
  content     TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'chat',   -- chat | settings | auto
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_user_memory_user ON user_memory(user_id);
