-- migrations/018_semantic_descriptions.sql
-- Semantic schema dictionary (v1.3.76).
--
-- Plain-language descriptions for tables and columns, per data source. This is the
-- half of the semantic layer that metric_definitions (013) does NOT cover: that one
-- holds business metrics / entities / terms; this holds the data-dictionary — what a
-- cryptic column like `kWh_sf`, `v1n` or `mb_error` actually means. Both are woven
-- into the schema block the model sees (formatSchemaForPrompt), so NL->SQL stops
-- guessing at opaque industrial column names.
--
-- object_type: 'table' | 'column'
-- object_key : the table name for a table, or 'table.column' for a column
--              (stored exactly as formatSchemaForPrompt emits the name, so lookups match)
CREATE TABLE IF NOT EXISTS semantic_descriptions (
  id          TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  source_type TEXT NOT NULL DEFAULT 'database',  -- database | api | file | prism
  source_id   TEXT NOT NULL,
  object_type TEXT NOT NULL,                      -- 'table' | 'column'
  object_key  TEXT NOT NULL,                      -- 'orders' or 'orders.cycle_time_s'
  description TEXT NOT NULL DEFAULT '',
  created_by  TEXT,
  updated_at  TEXT DEFAULT (datetime('now'))
);

-- One description per (source, object). Upserts target this.
CREATE UNIQUE INDEX IF NOT EXISTS idx_semantic_desc_unique
  ON semantic_descriptions(source_type, source_id, object_key);

CREATE INDEX IF NOT EXISTS idx_semantic_desc_source
  ON semantic_descriptions(source_type, source_id);
