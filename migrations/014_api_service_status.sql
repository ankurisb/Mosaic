-- 014: API source lifecycle status.
--
-- Adds `status` to api_services so a custom API source can be saved as a 'draft'
-- (hidden from chat) and 'published' (live). Existing rows default to 'published'
-- so nothing changes on upgrade.
--
-- The runner applies statements one at a time and tolerates "duplicate column
-- name", so this is a safe no-op on installs that already have the column
-- (e.g. a box where it was added manually, or the Postgres path in setup-pg.ts).
ALTER TABLE api_services ADD COLUMN status TEXT DEFAULT 'published';
