import { describe, it, expect, vi } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { runAgent, toolsFor, WRITE_TOOLS, DEFAULT_ORCHESTRATION, type AgentDef } from './agent-runner'

// ── fakes ────────────────────────────────────────────────────────────────────
// A scripted Anthropic client: returns script[i], repeating the last entry so a
// "never stops" script drives the step/no-progress/limit guardrails.
function fakeClient(script: Array<Record<string, unknown>>) {
  let i = 0
  return { messages: { create: async () => script[Math.min(i++, script.length - 1)] } } as unknown as Anthropic
}
let tid = 0
const toolUse = (name: string, input: unknown, usage?: { input_tokens: number; output_tokens: number }) => ({
  content: [{ type: 'tool_use', id: 't' + (tid++), name, input }],
  stop_reason: 'tool_use', usage: usage || { input_tokens: 10, output_tokens: 10 },
})
const finalMsg = (text: string) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 5 } })

const agent = (over: Partial<AgentDef> = {}): AgentDef => ({
  id: 'a1', name: 'Test Agent', goal: 'Do the thing.', tools: ['query_database'],
  guardrails: { max_steps: 20, max_tool_calls: 40, max_minutes: 10, max_cost_usd: 1, no_progress: true, read_only: true, approve_writes: true },
  ...over,
})
const noPersist = { persist: false }

describe('agent runner — guardrails & safe stop', () => {
  it('happy path: runs a tool then produces a final answer', async () => {
    const exec = vi.fn().mockResolvedValue({ rows: [{ oee: 82 }] })
    const r = await runAgent(agent(), noPersist, { client: fakeClient([toolUse('query_database', { sql: 'SELECT 1' }), finalMsg('OEE is 82%.')]), exec })
    expect(r.status).toBe('succeeded')
    expect(r.result).toBe('OEE is 82%.')
    expect(r.tool_calls).toBe(1)
    expect(exec).toHaveBeenCalledOnce()
  })

  it('stops at the step limit', async () => {
    const exec = vi.fn().mockResolvedValue({ ok: true })
    // every response is a (varying) tool_use so it never concludes on its own
    const r = await runAgent(agent({ guardrails: { max_steps: 3, max_tool_calls: 99, max_minutes: 10, max_cost_usd: 99, no_progress: false, read_only: true, approve_writes: true } }),
      noPersist, { client: fakeClient([toolUse('query_database', { sql: 'a' }), toolUse('query_database', { sql: 'b' }), toolUse('query_database', { sql: 'c' }), toolUse('query_database', { sql: 'd' })]), exec })
    expect(r.status).toBe('stopped')
    expect(r.stop_reason).toBe('step_limit')
    expect(r.steps_used).toBe(3)
  })

  it('stops on no progress (same tool + args repeated)', async () => {
    const exec = vi.fn().mockResolvedValue({ ok: true })
    const r = await runAgent(agent(), noPersist, { client: fakeClient([toolUse('query_database', { sql: 'SAME' })]), exec })
    expect(r.status).toBe('stopped')
    expect(r.stop_reason).toBe('no_progress')
    // executed twice, then the third identical call was blocked before running
    expect(exec).toHaveBeenCalledTimes(2)
  })

  it('pauses for approval before a write tool and does NOT execute it', async () => {
    const exec = vi.fn().mockResolvedValue({ ok: true })
    const a = agent({ tools: ['query_database', 'create_alert'], guardrails: { max_steps: 20, max_tool_calls: 40, max_minutes: 10, max_cost_usd: 1, no_progress: true, read_only: false, approve_writes: true } })
    const r = await runAgent(a, noPersist, { client: fakeClient([toolUse('create_alert', { title: 'x' })]), exec })
    expect(r.status).toBe('paused_for_approval')
    expect(r.stop_reason).toBe('awaiting_approval')
    expect(r.pending_tool?.name).toBe('create_alert')
    expect(exec).not.toHaveBeenCalled()
  })

  it('read_only removes write tools from the agent entirely', () => {
    const ro = toolsFor(agent({ tools: ['query_database', 'create_alert', 'build_dashboard'], guardrails: { read_only: true } as never }))
    const names = ro.map(t => t.name)
    expect(names).toContain('query_database')
    expect(names).not.toContain('create_alert')
    expect(names).not.toContain('build_dashboard')
    // every excluded one is a known write tool
    expect([...WRITE_TOOLS].every(w => !names.includes(w))).toBe(true)
    // with read_only off, writes are available
    const rw = toolsFor(agent({ tools: ['query_database', 'create_alert'], guardrails: { read_only: false } as never }))
    expect(rw.map(t => t.name)).toContain('create_alert')
  })

  it('stops at the cost cap', async () => {
    const exec = vi.fn().mockResolvedValue({ ok: true })
    const r = await runAgent(agent({ guardrails: { max_steps: 20, max_tool_calls: 40, max_minutes: 10, max_cost_usd: 0.00001, no_progress: false, read_only: true, approve_writes: true } }),
      noPersist, { client: fakeClient([toolUse('query_database', { sql: 'a' }, { input_tokens: 1_000_000, output_tokens: 1_000_000 }), toolUse('query_database', { sql: 'b' })]), exec })
    expect(r.status).toBe('stopped')
    expect(r.stop_reason).toBe('cost_limit')
    expect(r.cost_usd).toBeGreaterThan(0.00001)
  })

  it('stops at the tool-call cap', async () => {
    const exec = vi.fn().mockResolvedValue({ ok: true })
    const r = await runAgent(agent({ guardrails: { max_steps: 20, max_tool_calls: 2, max_minutes: 10, max_cost_usd: 99, no_progress: false, read_only: true, approve_writes: true } }),
      noPersist, { client: fakeClient([toolUse('query_database', { sql: 'a' }), toolUse('query_database', { sql: 'b' }), toolUse('query_database', { sql: 'c' })]), exec })
    expect(r.status).toBe('stopped')
    expect(r.stop_reason).toBe('tool_call_limit')
    expect(r.tool_calls).toBe(2)
  })

  it('stops at the wall-clock limit', async () => {
    const exec = vi.fn().mockResolvedValue({ ok: true })
    let t = 0
    const r = await runAgent(agent({ guardrails: { max_steps: 99, max_tool_calls: 99, max_minutes: 1, max_cost_usd: 99, no_progress: false, read_only: true, approve_writes: true } }),
      noPersist, { client: fakeClient([toolUse('query_database', { sql: 'a' })]), exec, now: () => { t += 40_000; return t } })
    expect(r.status).toBe('stopped')
    expect(r.stop_reason).toBe('time_limit')
  })

  it('records a tool error without crashing the run', async () => {
    const exec = vi.fn().mockRejectedValueOnce(new Error('connection refused')).mockResolvedValue({ ok: true })
    const r = await runAgent(agent(), noPersist, { client: fakeClient([toolUse('query_database', { sql: 'x' }), finalMsg('Could not reach the source.')]), exec })
    expect(r.status).toBe('succeeded')
    expect(JSON.stringify(r.steps)).toContain('connection refused')
  })
})

// ── orchestrated execution ─────────────────────────────────────────────────
// A content-aware fake: it answers by the role of the system prompt (lead plan /
// sub-agent / synthesis), so interleaved parallel sub-agent calls stay deterministic.
function orchClient(opts: { plan?: number; subUsage?: { input_tokens: number; output_tokens: number }; subToolCall?: boolean } = {}) {
  const calls: Array<{ kind: 'plan' | 'sub' | 'syn'; tools?: string[]; toolChoice?: unknown }> = []
  const nPlan = opts.plan ?? 2
  const subToolCall = opts.subToolCall ?? true
  const client = {
    messages: {
      create: async (req: Record<string, unknown>) => {
        const sys = String(req.system || '')
        const msgs = (req.messages as Array<{ role: string }>) || []
        if (sys.includes('Break this into')) {
          calls.push({ kind: 'plan' })
          const arr = Array.from({ length: nPlan }, (_, i) => ({ title: `Task ${i + 1}`, brief: `brief ${i + 1}` }))
          return { content: [{ type: 'text', text: JSON.stringify(arr) }], stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 5 } }
        }
        if (sys.includes('focused sub-agent')) {
          calls.push({ kind: 'sub', tools: ((req.tools as Array<{ name: string }>) || []).map(t => t.name), toolChoice: req.tool_choice })
          const firstRound = msgs.length === 1
          if (subToolCall && firstRound && !req.tool_choice) {
            return { content: [{ type: 'tool_use', id: 't' + (tid++), name: 'query_database', input: { sql: 'SELECT 1' } }], stop_reason: 'tool_use', usage: opts.subUsage || { input_tokens: 10, output_tokens: 10 } }
          }
          return { content: [{ type: 'text', text: 'finding' }], stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 5 } }
        }
        if (sys.includes('writing the final result')) {
          calls.push({ kind: 'syn' })
          return { content: [{ type: 'text', text: 'SYNTHESIS: combined answer.' }], stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 5 } }
        }
        // Any other system prompt (e.g. single-mode runner) — just conclude, don't record.
        return { content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 5 } }
      },
    },
  } as unknown as Anthropic
  return { client, calls }
}
const orch = (over: Partial<AgentDef> = {}): AgentDef => agent({ execution: 'orchestrated', tools: ['query_database'], ...over })

describe('agent runner — orchestrated execution', () => {
  it('happy path: plans, fans out read-only sub-agents in parallel, synthesises one answer', async () => {
    const exec = vi.fn().mockResolvedValue({ rows: [{ x: 1 }] })
    const { client, calls } = orchClient({ plan: 3 })
    const r = await runAgent(orch({ max_subagents: 3 }), noPersist, { client, exec })
    expect(r.status).toBe('succeeded')
    expect(r.execution).toBe('orchestrated')
    expect(r.result).toContain('SYNTHESIS')
    expect(r.subagents).toHaveLength(3)          // three sub-tasks ran
    expect(r.tool_calls).toBe(3)                 // one tool call each
    expect(calls.filter(c => c.kind === 'plan')).toHaveLength(1)
    expect(calls.filter(c => c.kind === 'syn')).toHaveLength(1)
    expect(exec).toHaveBeenCalledTimes(3)
  })

  it('max_subagents caps the fan-out', async () => {
    const exec = vi.fn().mockResolvedValue({ ok: true })
    const { client } = orchClient({ plan: 6 })   // lead proposes 6
    const r = await runAgent(orch({ max_subagents: 2 }), noPersist, { client, exec })
    expect(r.subagents).toHaveLength(2)          // clamped to 2
  })

  it('sub-agents are read-only: write tools are stripped even with read_only off', async () => {
    const exec = vi.fn().mockResolvedValue({ ok: true })
    const { client, calls } = orchClient({ plan: 1 })
    await runAgent(orch({ tools: ['query_database', 'create_alert', 'build_dashboard'], guardrails: { ...agent().guardrails!, read_only: false, approve_writes: false } }),
      noPersist, { client, exec })
    const subToolSets = calls.filter(c => c.kind === 'sub').map(c => c.tools || [])
    expect(subToolSets.length).toBeGreaterThan(0)
    for (const ts of subToolSets) {
      expect(ts).toContain('query_database')
      expect(ts).not.toContain('create_alert')
      expect(ts).not.toContain('build_dashboard')
    }
  })

  it('fleet tool-call cap is shared across all sub-agents (atomic reserve, no overshoot)', async () => {
    const exec = vi.fn().mockResolvedValue({ ok: true })
    const { client } = orchClient({ plan: 4 })
    // 4 sub-agents each want one tool call, but the FLEET cap is 2 → only 2 execs total.
    const r = await runAgent(orch({ max_subagents: 4, guardrails: { ...agent().guardrails!, max_tool_calls: 2 } }),
      noPersist, { client, exec })
    expect(r.tool_calls).toBe(2)
    expect(exec).toHaveBeenCalledTimes(2)
    expect(r.stop_reason).toBe('tool_call_limit')
    expect(r.status).toBe('stopped')
    expect(r.result).toContain('SYNTHESIS')      // still synthesises from the partials
  })

  it('fleet step cap trips across lead + sub-agents', async () => {
    const exec = vi.fn().mockResolvedValue({ ok: true })
    const { client, calls } = orchClient({ plan: 3 })
    // plan is step 1; max_steps 1 means no sub-agent round and no synthesis call fire.
    const r = await runAgent(orch({ max_subagents: 3, guardrails: { ...agent().guardrails!, max_steps: 1 } }),
      noPersist, { client, exec })
    expect(r.stop_reason).toBe('step_limit')
    expect(r.status).toBe('stopped')
    expect(exec).not.toHaveBeenCalled()
    expect(calls.filter(c => c.kind === 'syn')).toHaveLength(0)  // synthesis skipped under the cap
  })

  it('fleet cost cap trips across sub-agents', async () => {
    const exec = vi.fn().mockResolvedValue({ ok: true })
    const { client } = orchClient({ plan: 2, subUsage: { input_tokens: 1_000_000, output_tokens: 1_000_000 } })
    const r = await runAgent(orch({ max_subagents: 2, guardrails: { ...agent().guardrails!, max_cost_usd: 0.00001 } }),
      noPersist, { client, exec })
    expect(r.status).toBe('stopped')
    expect(r.stop_reason).toBe('cost_limit')
    expect(r.cost_usd).toBeGreaterThan(0.00001)
  })

  it('every sub-agent inherits run-as-creator identity AND source scoping', async () => {
    const seen: Array<Record<string, unknown>> = []
    const exec = vi.fn().mockImplementation(async (_n: string, _i: unknown, ctx: Record<string, unknown>) => { seen.push(ctx); return { ok: true } })
    const { client } = orchClient({ plan: 3 })
    await runAgent(orch({ max_subagents: 3, sources: ['src-A'] }),
      { persist: false, userId: 'u1', userEmail: 'creator@ugx.ai', userRole: 'admin' }, { client, exec })
    expect(seen.length).toBe(3)
    for (const ctx of seen) {
      expect(ctx.userId).toBe('u1')
      expect(ctx.userEmail).toBe('creator@ugx.ai')
      expect(ctx.allowedSources).toEqual(['src-A'])
      expect(ctx.strictSources).toBe(true)
    }
  })

  it('never pauses for approval (orchestrated runs are read-only by construction)', async () => {
    const exec = vi.fn().mockResolvedValue({ ok: true })
    const { client } = orchClient({ plan: 2 })
    const r = await runAgent(orch({ tools: ['query_database', 'create_alert'], guardrails: { ...agent().guardrails!, read_only: false, approve_writes: true } }),
      noPersist, { client, exec })
    expect(r.status).not.toBe('paused_for_approval')
    expect(r.pending_tool).toBeNull()
  })

  it('single mode is unchanged (no plan/synthesis calls)', async () => {
    const exec = vi.fn().mockResolvedValue({ rows: [] })
    const { client, calls } = orchClient()
    const r = await runAgent(agent(), noPersist, { client, exec })  // execution defaults to single
    expect(r.execution).toBe('single')
    expect(calls.filter(c => c.kind === 'plan' || c.kind === 'syn')).toHaveLength(0)
  })

  it('default sub-agent concurrency is bounded', () => {
    expect(DEFAULT_ORCHESTRATION.concurrency).toBeGreaterThanOrEqual(1)
    expect(DEFAULT_ORCHESTRATION.concurrency).toBeLessThanOrEqual(DEFAULT_ORCHESTRATION.max_subagents)
  })

  it('emits a live event stream: run_started → plan → subagent_status/result → synthesizing → run_done', async () => {
    const exec = vi.fn().mockResolvedValue({ ok: true })
    const { client } = orchClient({ plan: 2 })
    const events: Record<string, unknown>[] = []
    await runAgent(orch({ max_subagents: 2 }), { ...noPersist, emit: (e) => events.push(e) }, { client, exec })
    const types = events.map(e => e.type)
    expect(types[0]).toBe('run_started')
    expect(types).toContain('plan')
    expect(types.filter(t => t === 'subagent_status').length).toBeGreaterThanOrEqual(2) // queued + running per sub
    expect(types.filter(t => t === 'subagent_result').length).toBe(2)
    expect(types).toContain('synthesizing')
    expect(types[types.length - 1]).toBe('run_done')
    const plan = events.find(e => e.type === 'plan') as { subtasks?: unknown[] }
    expect(Array.isArray(plan.subtasks) && plan.subtasks!.length).toBe(2)
  })

  it('single mode also emits a live stream (run_started → tool/result → run_done)', async () => {
    const exec = vi.fn().mockResolvedValue({ rows: [{ x: 1 }] })
    const events: Record<string, unknown>[] = []
    await runAgent(agent(), { ...noPersist, emit: (e) => events.push(e) }, { client: fakeClient([toolUse('query_database', { sql: 'SELECT 1' }), finalMsg('done.')]), exec })
    const types = events.map(e => e.type)
    expect(types[0]).toBe('run_started')
    expect(types).toContain('tool')
    expect(types).toContain('result')
    expect(types[types.length - 1]).toBe('run_done')
  })
})
