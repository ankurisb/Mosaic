// app/api/agents/[id]/versions — append-only version history + rollback.
//   GET  → list every version of this agent (newest first), for audit + diff + rollback UI.
//   POST { version } → roll the agent back to that version: the agents row is set to that
//          version's config and a NEW version is appended (source 'rollback') so history
//          stays append-only and the rollback itself is auditable.
import { getSession } from '@/lib/auth'
import { getDb, nowExpr } from '@/lib/db'
import { setupDatabase } from '@/lib/setup'
import { snapshotVersion } from '@/lib/agent-versions'

export const runtime = 'nodejs'

type Row = Record<string, unknown>

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(); if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  await setupDatabase().catch(() => {})
  const { id } = await params
  const versions = await getDb()`SELECT id, agent_id, version, goal, tools, trigger_type, schedule, event_condition, outputs, guardrails, status, sources, learnings, source, note, created_by, created_at
    FROM agent_versions WHERE agent_id=${id} ORDER BY version DESC`.catch(() => [])
  return Response.json({ versions })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(); if (!session || session.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 })
  await setupDatabase().catch(() => {})
  const { id } = await params
  const b = await req.json().catch(() => ({})) as Row
  const target = Number(b.version)
  if (!Number.isInteger(target) || target < 1) return Response.json({ error: 'version (integer) is required' }, { status: 400 })

  const sql = getDb()
  const vrows = await sql`SELECT * FROM agent_versions WHERE agent_id=${id} AND version=${target}`.catch(() => [])
  const v = (vrows as Row[])[0]
  if (!v) return Response.json({ error: 'Version not found' }, { status: 404 })

  // The SQLite driver auto-parses JSON-looking TEXT columns, so v.tools/outputs/guardrails/
  // sources may come back as objects/arrays — coerce back to a JSON string (never String()
  // an array/object, which would mangle it to "a,b" / "[object Object]").
  const jstr = (x: unknown, d: string) => (x == null ? d : typeof x === 'string' ? x : JSON.stringify(x))
  const cfg = {
    goal: String(v.goal || ''),
    tools: jstr(v.tools, '[]'),
    trigger_type: String(v.trigger_type || 'manual'),
    schedule: (typeof v.schedule === 'string' ? v.schedule : null),
    event_condition: (typeof v.event_condition === 'string' ? v.event_condition : null),
    outputs: jstr(v.outputs, '[]'),
    guardrails: jstr(v.guardrails, '{}'),
    status: String(v.status || 'active'),
    sources: jstr(v.sources, '[]'),
    learnings: String(v.learnings || ''),
  }

  const rows = await sql`UPDATE agents SET
      goal=${cfg.goal}, tools=${cfg.tools}, trigger_type=${cfg.trigger_type},
      schedule=${cfg.schedule}, event_condition=${cfg.event_condition},
      outputs=${cfg.outputs}, guardrails=${cfg.guardrails}, status=${cfg.status},
      sources=${cfg.sources}, learnings=${cfg.learnings}, updated_at=${nowExpr()}
    WHERE id=${id} RETURNING *`
  const agent = (rows as Row[])[0]
  if (!agent) return Response.json({ error: 'Agent not found' }, { status: 404 })

  const newVersion = await snapshotVersion(String(id), cfg, { source: 'rollback', note: `Rolled back to v${target}`, createdBy: session.id })

  return Response.json({ agent, rolled_back_to: target, new_version: newVersion })
}
