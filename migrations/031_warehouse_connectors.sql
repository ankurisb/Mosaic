-- migrations/031_warehouse_connectors.sql
-- Extra connection fields for the cloud data-warehouse connectors.
--   warehouse  : Snowflake virtual warehouse (compute) to run queries on.
--   role       : Snowflake role to assume.
--   http_path  : Databricks SQL warehouse HTTP path (e.g. /sql/1.0/warehouses/abc).
-- All nullable → back-compatible with existing connections.
ALTER TABLE db_connections ADD COLUMN warehouse TEXT;
ALTER TABLE db_connections ADD COLUMN role TEXT;
ALTER TABLE db_connections ADD COLUMN http_path TEXT;
