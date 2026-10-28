// app/api/agents/runs/[id] — one run (full step log), plus approve / stop actions.
import { getSession } from '@/lib/auth'
import { getDb, nowExpr } from '@/lib/db'
import { runAgent } from '@/lib/agent-runner'
import { rowToAgent } from '../../[id]/route'
export const runtime = 'nodejs'
export const maxDuration = 300

type Row = Record<string, unknown>

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(); if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  const { id } = await params
  const rows = await getDb()`SELECT * FROM agent_runs WHERE id = ${id}`.catch(() => [])
  const run = (rows as Row[])[0]; if (!run) return Response.json({ error: 'Not found' }, { status: 404 })
  return Response.json({ run })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(); if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  const { id } = await params
  const { action } = await req.json().catch(() => ({})) as { action?: string }
  const sql = getDb()
  const rows = await sql`SELECT * FROM agent_runs WHERE id = ${id}`.catch(() => [])
  const run = (rows as Row[])[0]; if (!run) return Response.json({ error: 'Not found' }, { status: 404 })

  if (action === 'stop') {
    await sql`UPDATE agent_runs SET status='stopped', stop_reason='stopped_by_user', ended_at=${nowExpr()} WHERE id=${id}`.catch(() => {})
    return Response.json({ ok: true, status: 'stopped' })
  }

  if (action === 'approve') {
    if (String(run.status) !== 'paused_for_approval') return Response.json({ error: 'Run is not awaiting approval' }, { status: 409 })
    // Pragmatic resume: re-run the agent with write approval granted for this run,
    // so the previously-held action is carried out. (A true step-level continuation
    // from the paused message state is a follow-up — see the test report.)
    const arows = await sql`SELECT * FROM agents WHERE id = ${run.agent_id}`.catch(() => [])
    const agentRow = (arows as Row[])[0]; if (!agentRow) return Response.json({ error: 'Agent gone' }, { status: 404 })
    const def = rowToAgent(agentRow)
    def.guardrails = { ...def.guardrails!, approve_writes: false }
    await sql`UPDATE agent_runs SET status='stopped', stop_reason='approved_rerun', ended_at=${nowExpr()} WHERE id=${id}`.catch(() => {})
    const re = await runAgent(def, { triggerSource: 'approval', userId: session.id, userEmail: session.email, userRole: session.role })
    return Response.json({ ok: true, run: re })
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 })
}
