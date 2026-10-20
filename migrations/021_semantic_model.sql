-- migrations/021_semantic_model.sql
-- Phase 1 of the semantic & reliability architecture
-- (claude/mosaic-dashboard-semantic-architecture.md).
--
-- Upgrades the semantic dictionary from "descriptions the AI reads" to a STRUCTURED
-- field model the EXECUTOR acts on: role, unit, aggregation, accumulation (so a
-- cumulative counter is delta'd deterministically), time grain — plus AI-proposal
-- provenance (status/confidence/evidence) so an auto-labelled field is verifiable,
-- not silently trusted. All columns nullable → fully back-compatible with the
-- description-only rows written by 018.
ALTER TABLE semantic_descriptions ADD COLUMN role TEXT;                 -- measure|dimension|time|identifier|attribute
ALTER TABLE semantic_descriptions ADD COLUMN data_type TEXT;           -- number|string|timestamp|boolean|json
ALTER TABLE semantic_descriptions ADD COLUMN unit TEXT;                -- e.g. s, %, kWh, units, min, count
ALTER TABLE semantic_descriptions ADD COLUMN default_aggregation TEXT; -- sum|avg|min|max|last|count|count_distinct|none
ALTER TABLE semantic_descriptions ADD COLUMN additivity TEXT;          -- additive|semi_additive|non_additive
ALTER TABLE semantic_descriptions ADD COLUMN accumulation TEXT;        -- raw|cumulative_counter|rate
ALTER TABLE semantic_descriptions ADD COLUMN time_grain TEXT;          -- raw|1m|5m|1h|1d (native resolution of a time field)
ALTER TABLE semantic_descriptions ADD COLUMN status TEXT;              -- proposed|verified|rejected (NULL = legacy description-only)
ALTER TABLE semantic_descriptions ADD COLUMN confidence REAL;          -- 0..1, AI self-report + heuristics
ALTER TABLE semantic_descriptions ADD COLUMN evidence TEXT;            -- JSON: {basis, sample_values, ...} for audit/review

-- Per-source model state: a schema fingerprint for drift detection (Phase 2) and a
-- model version. Created now so the lifecycle machinery has a home from the start.
CREATE TABLE IF NOT EXISTS semantic_sources (
  source_type          TEXT NOT NULL,
  source_id            TEXT NOT NULL,
  schema_fingerprint   TEXT,
  model_version        INTEGER NOT NULL DEFAULT 1,
  last_introspected_at TEXT,
  updated_at           TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (source_type, source_id)
);
