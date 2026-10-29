-- 027_agent_evals.sql
-- Phase D: eval harness. A saved eval CASE is a checkable expectation on an agent run — the
-- result should contain certain substrings and (optionally) the run should have succeeded.
-- Running the suite scores each case deterministically so an agent change or an AI-proposed
-- evolution is measured against known-good expectations, not accepted on vibes.
--   input             optional prompt override for this case (NULL = use the agent's goal)
--   expected_contains JSON array of substrings the result should contain (case-insensitive)
--   expect_status     'succeeded' (default) | 'any'
--   last_score        0..1 from the most recent suite run that included this case
CREATE TABLE IF NOT EXISTS agent_evals (
  id                TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  agent_id          TEXT REFERENCES agents(id) ON DELETE CASCADE,
  name              TEXT NOT NULL DEFAULT '',
  input             TEXT,
  expected_contains TEXT NOT NULL DEFAULT '[]',
  expect_status     TEXT NOT NULL DEFAULT 'succeeded',
  last_passed       INTEGER,
  last_run_at       TEXT,
  created_by        TEXT,
  created_at        TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agent_evals_agent ON agent_evals(agent_id);
