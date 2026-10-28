// lib/agent-runner.ts
// Headless agent runner. An "agent" is a saved goal + a scoped tool allow-list +
// guardrails; this executes it against Mosaic's live data layer with NO browser or
// chat session attached, exactly like a scheduled report. It reuses the same
// machinery the chat loop uses — getAiClient() for the model, TOOLS + runTool for
// execution — and layers the safe-stop guardrails on top so a run can never loop
// forever or act without authority.
//
// Safe-stop model (every run is bounded on ALL of these; first to trip wins):
//   max_steps        hard cap on model/tool turns
//   max_tool_calls   total connector calls
//   max_minutes      wall-clock
//   max_cost_usd     model spend (priced via lib/models)
//   no_progress      halt if the same tool+args repeats with no new result
//   read_only        write tools are removed from the agent entirely
//   approve_writes   when a write tool is called, pause (don't execute) and wait
//
// Persistence to agent_runs is best-effort and wrapped in try/catch, so the pure
// loop is unit-testable with an injected client + exec and no database.

import type Anthropic from '@anthropic-ai/sdk'
import { getDb, nowExpr } from './db'
import { getAiClient, getDefaultModelId, getModelPricing } from './models'
import { TOOLS, runTool } from './tools'
import { log } from './logger'

// Side-effecting tools. Excluded entirely when read_only; gated behind approval
// (when approve_writes) otherwise. Keep in sync with lib/tools.ts.
export const WRITE_TOOLS = new Set(['create_alert', 'apply_api_fix', 'build_dashboard', 'save_memory', 'forget_memory'])

export interface Guardrails {
  max_steps: number
  max_tool_calls: number
  max_minutes: number
  max_cost_usd: number
  no_progress: boolean
  read_only: boolean
  approve_writes: boolean
}
export const DEFAULT_GUARDRAILS: Guardrails = {
  max_steps: 20, max_tool_calls: 40, max_minutes: 10, max_cost_usd: 1.0,
  no_progress: true, read_only: true, approve_writes: true,
}

// Goal-only default toolset: a tight, read-only data set so a plain-English goal "just
// works" — the agent discovers its own source via check_data_sources and queries it. Used
// when an agent/preview is created with no explicit tools. Deliberately excludes write and
// side-effect tools (call_api/run_code/fetch_url); those are opt-in.
export const DEFAULT_AGENT_TOOLS = ['check_data_sources', 'query_database', 'run_statistical_analysis', 'render_chart']

export interface AgentDef {
  id: string
  name: string
  goal: string
  tools: string[]
  trigger_type?: string
  guardrails?: Partial<Guardrails>
  outputs?: string[]
  sources?: string[]   // optional pin/scope: if set, the agent may only touch these data-source ids
}

export type RunStatus = 'succeeded' | 'failed' | 'stopped' | 'paused_for_approval'
export interface AgentStep { type: 'reason' | 'tool' | 'result' | 'error' | 'approval'; tool?: string; input?: unknown; result?: string; at: string }
export interface RunResult {
  status: RunStatus
  stop_reason: string
  result: string
  steps: AgentStep[]
  steps_used: number
  tool_calls: number
  cost_usd: number
  input_tokens: number
  output_tokens: number
  pending_tool?: { name: string; input: unknown } | null
  run_id?: string
}

interface RunDeps { client?: Anthropic; exec?: typeof runTool; now?: () => number }
interface RunOpts { triggerSource?: string; prompt?: string; userId?: string; userEmail?: string; userRole?: string; persist?: boolean }

const iso = () => new Date().toISOString()

/** Anthropic tool list the agent may use: its allow-list, with write tools removed
 *  when read_only. An unknown tool name in the allow-list is simply ignored. */
export function toolsFor(agent: AgentDef): Anthropic.Tool[] {
  const g = { ...DEFAULT_GUARDRAILS, ...(agent.guardrails || {}) }
  const allow = new Set(agent.tools || [])
  return TOOLS.filter(t => allow.has(t.name) && (!g.read_only || !WRITE_TOOLS.has(t.name)))
}

function systemFor(agent: AgentDef): string {
  return `You are "${agent.name}", an autonomous Mosaic agent running headless (no human is watching live). ` +
    `Your task:\n${agent.goal}\n\n` +
    `Work in steps: use the available tools to gather what you need against the live data layer, reason over the results, then produce a concise final answer. ` +
    `Use ONLY the tools provided. When a data tool needs a source, target an explicit configured source. ` +
    `Do not speculate beyond the evidence. When you have the answer, state it plainly and stop — do not keep calling tools once you can conclude.`
}

async function persistRun(runId: string | undefined, fields: Record<string, unknown>): Promise<string | undefined> {
  try {
    const sql = getDb()
    if (!runId) {
      const rows = await sql`INSERT INTO agent_runs (agent_id, status, trigger_source, steps, started_at)
        VALUES (${String(fields.agent_id)}, ${'running'}, ${String(fields.trigger_source || 'manual')}, ${'[]'}, ${nowExpr()})
        RETURNING id`
      return (rows as { id: string }[])[0]?.id
    }
    await sql`UPDATE agent_runs SET
        status = ${String(fields.status)},
        steps = ${String(fields.steps)},
        input_tokens = ${Number(fields.input_tokens || 0)},
        output_tokens = ${Number(fields.output_tokens || 0)},
        cost_usd = ${Number(fields.cost_usd || 0)},
        stop_reason = ${String(fields.stop_reason || '')},
        result = ${String(fields.result || '')},
        ended_at = ${fields.ended ? nowExpr() : null}
      WHERE id = ${runId}`
    return runId
  } catch (e) {
    // Offline / no DB (tests) — the loop runs fine without persistence.
    return runId
  }
}

/**
 * Run an agent to completion (or to a safe stop / approval pause).
 * Inject deps.client and deps.exec in tests; leave them out in production.
 */
export async function runAgent(agent: AgentDef, opts: RunOpts = {}, deps: RunDeps = {}): Promise<RunResult> {
  const g = { ...DEFAULT_GUARDRAILS, ...(agent.guardrails || {}) }
  const persist = opts.persist !== false
  const client = deps.client ?? (await getAiClient())
  const exec = deps.exec ?? runTool
  const nowMs = deps.now ?? (() => Date.now())
  const model = await getDefaultModelId()
  let pricing: { input: number; output: number }
  try { pricing = await getModelPricing(model) } catch { pricing = { input: 3 / 1e6, output: 15 / 1e6 } }

  const tools = toolsFor(agent)
  // If the agent is pinned/scoped to specific sources, enforce it: source-touching tools
  // may only target those ids (strictSources also rejects a sourceless call). Empty = auto.
  const scoped = Array.isArray(agent.sources) && agent.sources.length > 0
  const guardCtx = {
    userId: opts.userId || 'agent',
    userEmail: opts.userEmail || 'agent@mosaic',
    userRole: opts.userRole || 'admin',
    ...(scoped ? { allowedSources: agent.sources, strictSources: true } : {}),
  }
  const start = nowMs()
  const deadline = start + g.max_minutes * 60_000

  const steps: AgentStep[] = []
  const messages: Anthropic.MessageParam[] = [{
    role: 'user',
    content: opts.prompt || `Run now (${opts.triggerSource || 'manual'} trigger). Carry out your task against the available data and report the result.`,
  }]
  let inTok = 0, outTok = 0, toolCalls = 0, stepN = 0
  let lastSig = '', repeat = 0
  let finalText = '', stopReason = '', status: RunStatus = 'succeeded'
  let pending: { name: string; input: unknown } | null = null

  let runId = persist ? await persistRun(undefined, { agent_id: agent.id, trigger_source: opts.triggerSource }) : undefined
  const cost = () => inTok * pricing.input + outTok * pricing.output
  const flush = async (st: RunStatus, ended: boolean) => {
    if (persist) await persistRun(runId, { status: st, steps: JSON.stringify(steps.slice(-200)), input_tokens: inTok, output_tokens: outTok, cost_usd: cost(), stop_reason: stopReason, result: finalText, ended })
  }

  try {
    while (true) {
      if (stepN >= g.max_steps) { stopReason = 'step_limit'; status = 'stopped'; break }
      if (nowMs() > deadline) { stopReason = 'time_limit'; status = 'stopped'; break }
      if (cost() > g.max_cost_usd) { stopReason = 'cost_limit'; status = 'stopped'; break }

      stepN++
      const resp = await client.messages.create({ model, max_tokens: 4096, system: systemFor(agent), tools, messages })
      inTok += resp.usage?.input_tokens || 0
      outTok += resp.usage?.output_tokens || 0
      const blocks = resp.content || []
      const text = blocks.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('').trim()
      if (text) { finalText = text; steps.push({ type: 'reason', result: text, at: iso() }) }
      const toolUses = blocks.filter(b => b.type === 'tool_use') as Anthropic.ToolUseBlock[]

      if (resp.stop_reason !== 'tool_use' || toolUses.length === 0) { stopReason = stopReason || 'completed'; status = 'succeeded'; break }

      messages.push({ role: 'assistant', content: blocks })
      const toolResults: Anthropic.ToolResultBlockParam[] = []
      let paused = false, hitCallLimit = false, looped = false
      for (const tu of toolUses) {
        if (toolCalls >= g.max_tool_calls) { hitCallLimit = true; break }
        // Approval gate: a write tool, with approvals on, pauses the run.
        if (!g.read_only && g.approve_writes && WRITE_TOOLS.has(tu.name)) {
          pending = { name: tu.name, input: tu.input }
          steps.push({ type: 'approval', tool: tu.name, input: tu.input, at: iso() })
          paused = true
          break
        }
        // No-progress detection.
        const sig = tu.name + '::' + JSON.stringify(tu.input)
        if (g.no_progress && sig === lastSig) { repeat++; if (repeat >= 2) { looped = true; break } } else { repeat = 0; lastSig = sig }

        toolCalls++
        steps.push({ type: 'tool', tool: tu.name, input: tu.input, at: iso() })
        let out: unknown
        try { out = await exec(tu.name, tu.input as Record<string, unknown>, guardCtx) }
        catch (e) { out = { error: e instanceof Error ? e.message : String(e) } }
        const rStr = typeof out === 'string' ? out : JSON.stringify(out)
        steps.push({ type: 'result', tool: tu.name, result: rStr.slice(0, 4000), at: iso() })
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: rStr.slice(0, 12000) })
      }

      if (paused) { stopReason = 'awaiting_approval'; status = 'paused_for_approval'; break }
      if (hitCallLimit) { stopReason = 'tool_call_limit'; status = 'stopped'; break }
      if (looped) { stopReason = 'no_progress'; status = 'stopped'; break }
      if (toolResults.length === 0) { stopReason = 'completed'; status = 'succeeded'; break }
      messages.push({ role: 'user', content: toolResults })
    }
  } catch (e) {
    stopReason = 'error: ' + (e instanceof Error ? e.message : String(e))
    status = 'failed'
    log.error({ service: 'agent-runner', agent: agent.id, err: stopReason }, 'Agent run failed')
  }

  if (!finalText) {
    finalText = status === 'paused_for_approval'
      ? `Paused for approval before "${pending?.name}". No action was taken.`
      : status === 'stopped' ? `Run stopped: ${stopReason}. Partial progress saved.`
      : status === 'failed' ? `Run failed: ${stopReason}.`
      : 'No output produced.'
  }
  await flush(status, status !== 'paused_for_approval' ? true : false)

  return { status, stop_reason: stopReason, result: finalText, steps, steps_used: stepN, tool_calls: toolCalls, cost_usd: cost(), input_tokens: inTok, output_tokens: outTok, pending_tool: pending, run_id: runId }
}
