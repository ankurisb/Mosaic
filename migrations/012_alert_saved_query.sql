-- migrations/012_alert_saved_query.sql
-- Step 3a of query unification: alerts can reference a saved query instead of
-- carrying inline SQL. Non-breaking — the legacy source_type/source_id/query columns
-- stay and existing alerts keep firing; a new saved_query_id, when set, takes
-- precedence and the scheduler resolves it to the query's SQL + connection at run
-- time. Step 3b later removes the inline-SQL form input and migrates old alerts.
--
-- Statement-by-statement runner tolerates the duplicate-column case on re-run.

ALTER TABLE integration_rules ADD COLUMN saved_query_id TEXT;
