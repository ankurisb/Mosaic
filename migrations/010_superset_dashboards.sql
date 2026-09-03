-- migrations/010_superset_dashboards.sql
-- Superset "build a dashboard from a query" persistence (v1.3.x).
--
-- Adds the metadata Mosaic records when it BUILDS a dashboard in Superset from a
-- query, plus the per-chart table for multi-chart dashboards. Existing installs may
-- already have some of these from the earlier setup.ts blob — the migration runner
-- executes each statement individually and skips "duplicate column"/"already exists"
-- errors, so this is safe to run on both fresh and existing databases.

-- Parent dashboard: which query/connection/chart built it, and the Superset ids.
-- (Nullable — only set for the build-in-Superset flow; native/embed dashboards leave
-- them empty.)
ALTER TABLE dashboards ADD COLUMN source_kind TEXT;
ALTER TABLE dashboards ADD COLUMN source_sql TEXT;
ALTER TABLE dashboards ADD COLUMN source_connection TEXT;
ALTER TABLE dashboards ADD COLUMN source_chart_spec TEXT;
ALTER TABLE dashboards ADD COLUMN superset_dashboard_id INTEGER;
ALTER TABLE dashboards ADD COLUMN superset_chart_id INTEGER;
ALTER TABLE dashboards ADD COLUMN superset_dataset_id INTEGER;

-- One row per (dashboard, chart) — a dashboard can hold many charts, each from its
-- own query.
CREATE TABLE IF NOT EXISTS dashboard_charts (
  id                    TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  dashboard_id          TEXT NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
  chart_name            TEXT NOT NULL DEFAULT '',
  source_sql            TEXT NOT NULL DEFAULT '',
  source_connection     TEXT NOT NULL DEFAULT '',
  source_chart_spec     TEXT NOT NULL DEFAULT '{}',
  superset_chart_id     INTEGER,
  superset_dataset_id   INTEGER,
  created_at            TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_dashboard_charts_dashboard ON dashboard_charts(dashboard_id);
