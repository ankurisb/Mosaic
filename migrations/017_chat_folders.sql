-- 017_chat_folders.sql
-- Folders to organise chats in the sidebar. Folders are per-user; a
-- conversation belongs to at most one folder (folder_id NULL = ungrouped).
-- folder_id is a plain column (no FK) so the ALTER works on SQLite; the API
-- clears conversations.folder_id when a folder is deleted.
CREATE TABLE IF NOT EXISTS chat_folders (
  id         TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL DEFAULT 'New folder',
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

ALTER TABLE conversations ADD COLUMN folder_id TEXT;

CREATE INDEX IF NOT EXISTS idx_conversations_folder ON conversations(folder_id);
CREATE INDEX IF NOT EXISTS idx_chat_folders_user ON chat_folders(user_id);
