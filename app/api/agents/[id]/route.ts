// app/api/agents/[id] — get / update / delete one agent, and POST to run it now.
import { getSession } from '@/lib/auth'
import { getDb, nowExpr } from '@/lib/db'
import { setupDatabase } from '@/lib/setup'
import { runAgent, DEFAULT_GUARDRAILS, type AgentDef } from '@/lib/agent-runner'
import { snapshotVersion, snapshotFromRow } from '@/lib/agent-versions'
export const runtime = 'nodejs'
export const maxDuration = 300

type Row = Record<string, unknown>

/** Parse a DB agent row into the shape the runner expects. */
export function rowToAgent(r: Row): AgentDef {
  const parse = <T,>(v: unknown, d: T): T => { try { return (typeof v === 'string' ? JSON.parse(v) : (v ?? d)) as T } catch { return d } }
  return {
    id: String(r.id), name: String(r.name), goal: String(r.goal || ''),
    tools: parse<string[]>(r.tools, []),
    trigger_type: String(r.trigger_type || 'manual'),
    guardrails: { ...DEFAULT_GUARDRAILS, ...parse<object>(r.guardrails, {}) },
    outputs: parse<string[]>(r.outputs, []),
    sources: parse<string[]>(r.sources, []),
  }
}

async function load(id: string): Promise<Row | null> {
  const sql = getDb()
  const rows = await sql`SELECT * FROM agents WHERE id = ${id}`.catch(() => [])
  return (rows as Row[])[0] || null
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(); if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  const { id } = await params
  const agent = await load(id); if (!agent) return Response.json({ error: 'Not found' }, { status: 404 })
  return Response.json({ agent })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(); if (!session || session.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 })
  const { id } = await params
  const b = await req.json().catch(() => ({})) as Row
  const sql = getDb()
  const cur = await load(id); if (!cur) return Response.json({ error: 'Not found' }, { status: 404 })
  const name = b.name != null ? String(b.name).slice(0, 120) : String(cur.name)
  const goal = b.goal != null ? String(b.goal) : String(cur.goal)
  const tools = b.tools != null ? JSON.stringify(b.tools) : String(cur.tools)
  const guardrails = b.guardrails != null ? JSON.stringify({ ...DEFAULT_GUARDRAILS, ...(b.guardrails as object) }) : String(cur.guardrails)
  const status = b.status != null ? (b.status === 'paused' ? 'paused' : 'active') : String(cur.status)
  const trigger = b.trigger_type != null && ['manual', 'schedule', 'event'].includes(String(b.trigger_type)) ? String(b.trigger_type) : String(cur.trigger_type)
  const schedule = b.schedule !== undefined ? (b.schedule ? String(b.schedule) : null) : (cur.schedule as string | null)
  const sources = b.sources != null ? JSON.stringify(b.sources) : String(cur.sources ?? '[]')
  const rows = await sql`UPDATE agents SET name=${name}, goal=${goal}, tools=${tools}, guardrails=${guardrails}, status=${status}, trigger_type=${trigger}, schedule=${schedule}, sources=${sources}, updated_at=${nowExpr()} WHERE id=${id} RETURNING *`
  const agent = (rows as Record<string, unknown>[])[0]
  if (agent?.id) {
    const note = typeof b.note === 'string' && b.note.trim() ? String(b.note).slice(0, 300) : 'Edited'
    await snapshotVersion(String(agent.id), snapshotFromRow(agent), { source: 'human', note, createdBy: session.id })
  }
  return Response.json({ agent })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(); if (!session || session.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 })
  const { id } = await params
  await getDb()`DELETE FROM agents WHERE id = ${id}`.catch(() => {})
  return Response.json({ ok: true })
}

// Run the agent now (synchronous; bounded by its own guardrails). Returns the run.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(); if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  await setupDatabase().catch(() => {})
  const { id } = await params
  const row = await load(id); if (!row) return Response.json({ error: 'Not found' }, { status: 404 })
  if (String(row.status) === 'paused') return Response.json({ error: 'Agent is paused' }, { status: 409 })
  const run = await runAgent(rowToAgent(row), { triggerSource: 'manual', userId: session.id, userEmail: session.email, userRole: session.role })
  return Response.json({ run })
}
