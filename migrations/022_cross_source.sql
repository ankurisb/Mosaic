-- migrations/022_cross_source.sql
-- Phase 3: cross-source composition.
--
-- A CONFORMED DIMENSION is a logical entity (Asset, Line, Shift) that the same
-- physical thing is known by across sources. conformed_dimensions holds the entity
-- (+ an optional hierarchy as JSON levels, e.g. ["Plant","Line","Asset"]);
-- conformed_keys is the crosswalk — per source, the column that carries that entity's
-- key (machines.id in the DB, device_id in PRISM, /assets.id in the API).
--
-- cross_source_measures composes base measures (one per source) over a conformed
-- entity at a common grain via a formula (e.g. energy / units). Guarded by the
-- verification gate at run time: all base fields must be status='verified'.
CREATE TABLE IF NOT EXISTS conformed_dimensions (
  id          TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  entity      TEXT NOT NULL UNIQUE,     -- logical name, e.g. 'Asset'
  description TEXT DEFAULT '',
  levels      TEXT,                     -- JSON array hierarchy: ["Plant","Line","Asset"]
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS conformed_keys (
  entity      TEXT NOT NULL,            -- -> conformed_dimensions.entity
  source_type TEXT NOT NULL,            -- database | api | prism | file
  source_id   TEXT NOT NULL,
  key_column  TEXT NOT NULL,            -- the column carrying this entity's key in that source
  PRIMARY KEY (entity, source_type, source_id)
);

CREATE TABLE IF NOT EXISTS cross_source_measures (
  id         TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  name       TEXT NOT NULL,
  entity     TEXT NOT NULL,             -- conformed dimension to align on
  grain      TEXT,                      -- common time grain (NULL = no time alignment)
  formula    TEXT NOT NULL,             -- arithmetic over base aliases, e.g. 'energy / units'
  bases      TEXT NOT NULL,             -- JSON: {alias:{source_type,source_id,column,agg,value_role}}
  status     TEXT DEFAULT 'proposed',   -- proposed | verified | rejected
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cross_measures_entity ON cross_source_measures(entity);
