-- migrations/015_generated_files.sql
-- Files produced by the code sandbox (run_code) — spreadsheets, reports, plots,
-- etc. The bytes live on disk under MOSAIC_FILE_DIR (default /data/generated-files);
-- this table holds metadata + ownership so the download endpoint can enforce access
-- and prune expired files. Additive; no existing behaviour changes.
CREATE TABLE IF NOT EXISTS generated_files (
  id              TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  conversation_id TEXT,
  user_id         TEXT,
  name            TEXT NOT NULL,
  mime            TEXT NOT NULL DEFAULT 'application/octet-stream',
  size            INTEGER NOT NULL DEFAULT 0,
  path            TEXT NOT NULL,
  created_at      TEXT DEFAULT (datetime('now')),
  expires_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_generated_files_user ON generated_files(user_id);
CREATE INDEX IF NOT EXISTS idx_generated_files_conv ON generated_files(conversation_id);
