// app/api/agents/[id]/evals/run — run the agent's eval suite and score it.
//
// Runs each saved case against the agent (or an optional `override` config, so a proposed
// evolution can be regression-tested BEFORE it is published), scores the result
// deterministically (lib/agent-eval), persists each case's last pass/fail, and returns the
// per-case breakdown plus a suite score. Runs are safe: persist:false (no agent_runs rows),
// read_only + approve_writes forced on (a check never mutates anything).
import { getSession } from '@/lib/auth'
import { getDb, nowExpr } from '@/lib/db'
import { setupDatabase } from '@/lib/setup'
import { runAgent, DEFAULT_GUARDRAILS, type AgentDef } from '@/lib/agent-runner'
import { scoreCase, suiteScore, type CaseScore } from '@/lib/agent-eval'
import { rowToAgent } from '../../route'

export const runtime = 'nodejs'
export const maxDuration = 300

type Row = Record<string, unknown>

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(); if (!session || session.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 })
  await setupDatabase().catch(() => {})
  const { id } = await params
  const sql = getDb()

  const arows = await sql`SELECT * FROM agents WHERE id=${id}`.catch(() => [])
  const agentRow = (arows as Row[])[0]
  if (!agentRow) return Response.json({ error: 'Not found' }, { status: 404 })

  const evals = await sql`SELECT * FROM agent_evals WHERE agent_id=${id} ORDER BY created_at ASC`.catch(() => []) as Row[]
  if (evals.length === 0) return Response.json({ error: 'No eval cases yet — add a check first.' }, { status: 409 })

  // Base agent config, or an optional proposed override (regression-test a change pre-publish).
  const base = rowToAgent(agentRow)
  const body = await req.json().catch(() => ({})) as { override?: Record<string, unknown> }
  const ov = body.override && typeof body.override === 'object' ? body.override : null
  const agent: AgentDef = ov ? {
    ...base,
    goal: typeof ov.goal === 'string' ? ov.goal : base.goal,
    tools: Array.isArray(ov.tools) ? (ov.tools as unknown[]).map(String) : base.tools,
    guardrails: { ...base.guardrails, ...(ov.guardrails && typeof ov.guardrails === 'object' ? ov.guardrails as object : {}) },
    sources: Array.isArray(ov.sources) ? (ov.sources as unknown[]).map(String) : base.sources,
    learnings: typeof ov.learnings === 'string' ? ov.learnings : base.learnings,
    execution: ov.execution === 'orchestrated' ? 'orchestrated' : (ov.execution === 'single' ? 'single' : base.execution),
  } : base
  // A check never mutates: force read-only + approval, keep the agent's other caps.
  agent.guardrails = { ...DEFAULT_GUARDRAILS, ...agent.guardrails, read_only: true, approve_writes: true }

  const cases: { id: string; name: string; score: CaseScore }[] = []
  const scores: CaseScore[] = []
  for (const ev of evals) {
    const expected = (() => { try { return typeof ev.expected_contains === 'string' ? JSON.parse(ev.expected_contains as string) : (ev.expected_contains || []) } catch { return [] } })() as string[]
    const expectStatus = ev.expect_status === 'any' ? 'any' as const : 'succeeded' as const
    const input = typeof ev.input === 'string' && ev.input ? ev.input : undefined
    let result = '', status = 'failed'
    try {
      const run = await runAgent(agent, { triggerSource: 'eval', persist: false, userId: session.id, userEmail: session.email, userRole: session.role, prompt: input })
      result = run.result || ''; status = run.status
    } catch (e) { result = e instanceof Error ? e.message : String(e); status = 'failed' }
    const sc = scoreCase(result, status, { expected_contains: expected, expect_status: expectStatus })
    scores.push(sc)
    cases.push({ id: String(ev.id), name: String(ev.name), score: sc })
    await sql`UPDATE agent_evals SET last_passed=${sc.passed ? 1 : 0}, last_run_at=${nowExpr()} WHERE id=${String(ev.id)}`.catch(() => {})
  }

  return Response.json({ suite: suiteScore(scores), cases, override: !!ov })
}
