-- 023_dashboard_entity_config.sql
-- Phase 9: dashboard-level entity/device filter binding. JSON describing which source the
-- filter is bound to and how to resolve its entities, plus the default selection:
--   { "source_type":"prism"|"database"|"api", "source_id":"…",
--     "kind":"prism"|"sql"|"api", "key_field":"device_id"|"entity_id",
--     "label_field":"name"|null, "table":"production"|null, "default":["id1",...] }
-- NULL on a dashboard with no entity-scoped panels (the filter control stays hidden).
ALTER TABLE dashboards ADD COLUMN entity_config TEXT;
