-- migrations/029_cube_readiness.sql
-- Cube serving-readiness probe state, per source.
--
-- A verified semantic model is NECESSARY but not SUFFICIENT for a source to be
-- servable through Cube: the cube still has to compile and Cube still has to
-- connect to the source with its own driver and build the pre-aggregation (the
-- MySQL-8 auth-mode and SQL-Server `server`-vs-`host` failures are exactly this).
-- So "✓ Semantics" over-promised. These columns record the result of an actual
-- probe query against the generated cube, so the UI can distinguish
-- "verified, Cube-serving ✓" from "verified, Cube unreachable ⚠ (<reason>)".
-- All nullable → back-compatible; NULL means "not yet probed".
ALTER TABLE semantic_sources ADD COLUMN cube_serving TEXT;     -- 'serving' | 'unreachable' | NULL (not yet probed / N/A)
ALTER TABLE semantic_sources ADD COLUMN cube_reason TEXT;      -- when not serving: routing/compile/connect reason
ALTER TABLE semantic_sources ADD COLUMN cube_checked_at TEXT;  -- ISO timestamp of the last probe
