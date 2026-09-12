-- migrations/013_metric_definitions.sql
-- Metrics & definitions layer: customer-defined business terms (how THEY compute OEE,
-- what a 'defect' is, which machines make up 'Line A'). These are injected into the AI
-- context so every answer uses the plant's own definitions consistently ("fix the
-- context, not the model"). Additive; no existing behaviour changes.
CREATE TABLE IF NOT EXISTS metric_definitions (
  id          TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'metric',
  definition  TEXT NOT NULL DEFAULT '',
  formula     TEXT,
  applies_to  TEXT,
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);
