import { describe, it, expect, vi } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { runAgent, toolsFor, WRITE_TOOLS, type AgentDef } from './agent-runner'

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
