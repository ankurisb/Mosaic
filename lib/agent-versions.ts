// lib/agent-versions.ts
// Append-only version history for agents. Every create / edit / rollback / accepted-AI
// proposal writes an immutable snapshot, so an agent's definition is auditable and
// reversible. The `agents` row always holds the current (latest) config; `agent_versions`
// is the history. Versioning is best-effort — a failure here never blocks the primary write.
import { getDb, nowExpr } from './db'

export type VersionSource = 'human' | 'ai-proposed-accepted' | 'rollback' | 'seed'

export interface AgentConfigSnapshot {
  goal: string
  tools: string            // JSON string
  trigger_type: string
  schedule: string | null
  event_condition: string | null
  outputs: string          // JSON string
  guardrails: string       // JSON string
  status: string
  sources: string          // JSON string
  learnings: string        // plain text
  execution: string        // 'single' | 'orchestrated'
  max_subagents: number
}

/** Build a config snapshot from an `agents` DB row (tolerates string or parsed columns). */
export function snapshotFromRow(r: Record<string, unknown>): AgentConfigSnapshot {
  const s = (v: unknown, d: string) => (typeof v === 'string' ? v : v == null ? d : JSON.stringify(v))
  return {
    goal: String(r.goal || ''),
    tools: s(r.tools, '[]'),
    trigger_type: String(r.trigger_type || 'manual'),
    schedule: (r.schedule as string | null) ?? null,
    event_condition: (r.event_condition as string | null) ?? null,
    outputs: s(r.outputs, '[]'),
    guardrails: s(r.guardrails, '{}'),
    status: String(r.status || 'active'),
    sources: s(r.sources, '[]'),
    learnings: String(r.learnings || ''),
    execution: r.execution === 'orchestrated' ? 'orchestrated' : 'single',
    max_subagents: Number.isFinite(Number(r.max_subagents)) ? Number(r.max_subagents) : 4,
  }
}

/** Append an immutable version snapshot for an agent. Returns the new version number. */
export async function snapshotVersion(
  agentId: string,
  cfg: AgentConfigSnapshot,
  meta: { source: VersionSource; note?: string; createdBy?: string | null },
): Promise<number | undefined> {
  try {
    const sql = getDb()
    const rows = await sql`SELECT COALESCE(MAX(version),0) AS v FROM agent_versions WHERE agent_id=${agentId}`.catch(() => [{ v: 0 }])
    const next = Number((rows as { v: number }[])[0]?.v || 0) + 1
    await sql`INSERT INTO agent_versions
      (agent_id, version, goal, tools, trigger_type, schedule, event_condition, outputs, guardrails, status, sources, learnings, execution, max_subagents, source, note, created_by, created_at)
      VALUES (${agentId}, ${next}, ${cfg.goal}, ${cfg.tools}, ${cfg.trigger_type}, ${cfg.schedule}, ${cfg.event_condition}, ${cfg.outputs}, ${cfg.guardrails}, ${cfg.status}, ${cfg.sources}, ${cfg.learnings}, ${cfg.execution}, ${cfg.max_subagents}, ${meta.source}, ${meta.note || ''}, ${meta.createdBy ?? null}, ${nowExpr()})`
    return next
  } catch {
    return undefined
  }
}
