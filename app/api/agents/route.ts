// app/api/agents — list + create agents.
import { getSession } from '@/lib/auth'
import { getDb, nowExpr } from '@/lib/db'
import { setupDatabase } from '@/lib/setup'
import { DEFAULT_GUARDRAILS } from '@/lib/agent-runner'
import { snapshotVersion, snapshotFromRow } from '@/lib/agent-versions'
export const runtime = 'nodejs'

export async function GET() {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  // Ensure the agents/agent_runs tables exist (and example agents are seeded) even
  // on a fresh deploy where no page has triggered setup yet. Idempotent + guarded.
  await setupDatabase().catch(() => {})
  const sql = getDb()
  const rows = await sql`SELECT id, name, goal, tools, trigger_type, schedule, event_condition, outputs, guardrails, status, last_scheduled_run, created_at, updated_at
    FROM agents ORDER BY created_at DESC`.catch(() => [])
  return Response.json({ agents: rows })
}

export async function POST(req: Request) {
  const session = await getSession()
  if (!session || session.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 })
  await setupDatabase().catch(() => {})
  const b = await req.json().catch(() => ({})) as Record<string, unknown>
  if (!b.name || typeof b.name !== 'string') return Response.json({ error: 'name is required' }, { status: 400 })
  const sql = getDb()
  const tools = JSON.stringify(Array.isArray(b.tools) ? b.tools : [])
  const outputs = JSON.stringify(Array.isArray(b.outputs) ? b.outputs : [])
  const guardrails = JSON.stringify({ ...DEFAULT_GUARDRAILS, ...(b.guardrails && typeof b.guardrails === 'object' ? b.guardrails : {}) })
  const trigger = ['manual', 'schedule', 'event'].includes(String(b.trigger_type)) ? String(b.trigger_type) : 'manual'
  const rows = await sql`INSERT INTO agents (name, goal, tools, trigger_type, schedule, event_condition, outputs, guardrails, status, created_by, updated_at)
    VALUES (${String(b.name).slice(0, 120)}, ${String(b.goal || '')}, ${tools}, ${trigger}, ${b.schedule ? String(b.schedule) : null}, ${b.event_condition ? String(b.event_condition) : null}, ${outputs}, ${guardrails}, ${b.status === 'paused' ? 'paused' : 'active'}, ${session.id}, ${nowExpr()})
    RETURNING *`
  const agent = (rows as Record<string, unknown>[])[0]
  if (agent?.id) await snapshotVersion(String(agent.id), snapshotFromRow(agent), { source: 'human', note: 'Created', createdBy: session.id })
  return Response.json({ agent })
}
