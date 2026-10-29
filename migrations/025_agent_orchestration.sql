-- 025_agent_orchestration.sql
-- Phase A: multi-agent orchestration. An agent can run as a LEAD that decomposes its
-- goal into independent sub-tasks, runs them as read-only sub-agents in parallel, and
-- synthesises one answer. Two config columns on agents (the live config) and on
-- agent_versions (the append-only history, so rollback + AI-proposed evolution carry them):
--   execution      'single' (one tool loop) | 'orchestrated' (lead → fan-out → synthesis)
--   max_subagents  cap on parallel sub-tasks when orchestrated (1..8; default 4)
-- Additive + idempotent: a duplicate-column error is ignored by the migrator, so installs
-- that already got these via the setup.ts fallback apply this as a no-op.
ALTER TABLE agents ADD COLUMN execution TEXT NOT NULL DEFAULT 'single';
ALTER TABLE agents ADD COLUMN max_subagents INTEGER NOT NULL DEFAULT 4;
ALTER TABLE agent_versions ADD COLUMN execution TEXT NOT NULL DEFAULT 'single';
ALTER TABLE agent_versions ADD COLUMN max_subagents INTEGER NOT NULL DEFAULT 4;
