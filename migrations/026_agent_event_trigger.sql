-- 026_agent_event_trigger.sql
-- Phase C: event-trigger engine. Agents with trigger_type='event' are evaluated every
-- scheduler tick against their event_condition (stored on the existing agents.event_condition
-- column). Firing is EDGE-TRIGGERED: the agent runs once on a false -> true transition, not
-- every tick the condition stays true. These two columns persist the edge state between ticks:
--   last_event_state  0 = condition was false (armed) | 1 = true (already fired / consumed)
--   last_event_at     ISO timestamp of the last actual fire (for cooldown anti-flap)
-- Additive + idempotent (duplicate-column errors are ignored by the migrator).
ALTER TABLE agents ADD COLUMN last_event_state INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agents ADD COLUMN last_event_at TEXT;
