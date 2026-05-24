-- 008_transparency_log.sql
-- AI Transparency Ledger — one row per assistant response.
-- Records what data the AI accessed, how many tokens were used,
-- and a human-readable summary for each response.
-- Designed for security-apprehensive industrial buyers who need
-- to answer "why did the system say that?"

CREATE TABLE IF NOT EXISTS transparency_log (
  id               TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  -- Links
  message_id       TEXT,                        -- messages.id of the assistant response
  conversation_id  TEXT,                        -- conversations.id
  user_id          TEXT,                        -- who asked
  user_email       TEXT,
  -- The question and answer (truncated for quick display)
  question         TEXT NOT NULL DEFAULT '',    -- first 300 chars of user message
  answer_summary   TEXT NOT NULL DEFAULT '',    -- first 300 chars of assistant response
  -- What the AI did
  tool_calls_count INTEGER NOT NULL DEFAULT 0,
  tools_used       TEXT DEFAULT '[]',           -- JSON array of tool names used
  sources_queried  TEXT DEFAULT '[]',           -- JSON array of {type, label} objects
  rows_read        INTEGER DEFAULT 0,           -- total rows returned across all queries
  web_search_used  INTEGER NOT NULL DEFAULT 0,
  -- Token economics
  input_tokens     INTEGER NOT NULL DEFAULT 0,
  output_tokens    INTEGER NOT NULL DEFAULT 0,
  cost_usd         REAL NOT NULL DEFAULT 0,
  latency_ms       INTEGER NOT NULL DEFAULT 0,
  model            TEXT NOT NULL DEFAULT '',
  -- Was this an RCA?
  is_rca           INTEGER NOT NULL DEFAULT 0,
  -- Timestamp
  created_at       TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_transparency_conv    ON transparency_log(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transparency_user    ON transparency_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transparency_created ON transparency_log(created_at DESC);
