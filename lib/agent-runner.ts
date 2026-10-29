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

// Orchestration (execution:'orchestrated') — the agent acts as a LEAD that decomposes its
// goal into independent sub-tasks, runs them in parallel as read-only sub-agents, and
// synthesises one answer. All sub-agents share the SAME fleet budget (the agent's guardrails
// are the ceiling for the whole fleet, never per sub-agent) and inherit the creator identity
// and source scoping. Orchestrated runs are read-only by construction: sub-agents never get
// write tools, so an orchestrated run never pauses for write approval.
export type Emit = (event: Record<string, unknown>) => void
export interface OrchestrationConfig { max_subagents: number; concurrency: number; subagent_tool_budget: number }
export const DEFAULT_ORCHESTRATION: OrchestrationConfig = { max_subagents: 4, concurrency: 3, subagent_tool_budget: 6 }
export const MAX_SUBAGENTS_CEILING = 8

export interface AgentDef {
  id: string
  name: string
  goal: string
  tools: string[]
  trigger_type?: string
  guardrails?: Partial<Guardrails>
  outputs?: string[]
  sources?: string[]   // optional pin/scope: if set, the agent may only touch these data-source ids
  learnings?: string   // accumulated, human-approved learnings injected into the system prompt
  execution?: 'single' | 'orchestrated'  // default 'single'
  max_subagents?: number                 // orchestrated: cap on parallel sub-tasks (<= MAX_SUBAGENTS_CEILING)
}

export type RunStatus = 'succeeded' | 'failed' | 'stopped' | 'paused_for_approval'
export interface AgentStep { type: 'reason' | 'tool' | 'result' | 'error' | 'approval' | 'plan' | 'synthesis'; tool?: string; input?: unknown; result?: string; at: string; sub?: string }
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
  execution?: 'single' | 'orchestrated'
  subagents?: Array<{ id: string; title: string; summary: string; tool_calls: number; error?: string }>
}

interface RunDeps { client?: Anthropic; exec?: typeof runTool; now?: () => number }
interface RunOpts { triggerSource?: string; prompt?: string; userId?: string; userEmail?: string; userRole?: string; persist?: boolean; emit?: Emit }

const iso = () => new Date().toISOString()

/** Anthropic tool list the agent may use: its allow-list, with write tools removed
 *  when read_only. An unknown tool name in the allow-list is simply ignored. */
export function toolsFor(agent: AgentDef): Anthropic.Tool[] {
  const g = { ...DEFAULT_GUARDRAILS, ...(agent.guardrails || {}) }
  const allow = new Set(agent.tools || [])
  return TOOLS.filter(t => allow.has(t.name) && (!g.read_only || !WRITE_TOOLS.has(t.name)))
}

function systemFor(agent: AgentDef): string {
  const learnings = (agent.learnings || '').trim()
  const learningsBlock = learnings
    ? `\n\nLearnings from past runs (human-approved — use them to work faster and more accurately, but re-verify against current data):\n${learnings}\n`
    : ''
  return `You are "${agent.name}", an autonomous Mosaic agent running headless (no human is watching live). ` +
    `Your task:\n${agent.goal}\n${learningsBlock}\n` +
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

  // Orchestrated execution: delegate to the lead/fan-out/synthesis path, which shares all
  // the setup above (same guardrails ceiling, same guardCtx = run-as-creator + source scope).
  if ((agent.execution || 'single') === 'orchestrated') {
    return runOrchestrated(agent, opts, { client, exec, nowMs, model, pricing, g, guardCtx, persist })
  }

  const emit: Emit = opts.emit || (() => {})
  const start = nowMs()
  const deadline = start + g.max_minutes * 60_000

  const steps: AgentStep[] = []
  emit({ type: 'run_started', execution: 'single', goal: agent.goal })
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
      if (text) { finalText = text; steps.push({ type: 'reason', result: text, at: iso() }); emit({ type: 'reason', text }) }
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
        emit({ type: 'tool', tool: tu.name })
        let out: unknown
        try { out = await exec(tu.name, tu.input as Record<string, unknown>, guardCtx) }
        catch (e) { out = { error: e instanceof Error ? e.message : String(e) } }
        const rStr = typeof out === 'string' ? out : JSON.stringify(out)
        steps.push({ type: 'result', tool: tu.name, result: rStr.slice(0, 4000), at: iso() })
        emit({ type: 'result', tool: tu.name })
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
  emit({ type: 'run_done', status, stop_reason: stopReason, tool_calls: toolCalls, cost_usd: cost() })

  return { status, stop_reason: stopReason, result: finalText, steps, steps_used: stepN, tool_calls: toolCalls, cost_usd: cost(), input_tokens: inTok, output_tokens: outTok, pending_tool: pending, run_id: runId, execution: 'single' }
}

// ───────────────────────── Orchestrated execution ─────────────────────────
// The agent runs as a LEAD: decompose the goal → fan out read-only sub-agents in
// parallel → synthesise one answer. The whole fleet shares ONE budget derived from
// the agent's guardrails (NOT per sub-agent), reserved atomically so parallel
// sub-agents can never collectively overshoot the tool-call cap.

interface OrchCtx {
  client: Anthropic
  exec: typeof runTool
  nowMs: () => number
  model: string
  pricing: { input: number; output: number }
  g: Guardrails
  guardCtx: { userId: string; userEmail: string; userRole: string; conversationId?: string; allowedSources?: string[]; strictSources?: boolean }
  persist: boolean
}
interface SubTask { id: string; title: string; brief: string }
interface SubResult { id: string; title: string; summary: string; toolCalls: number; steps: AgentStep[]; error?: string }

// Mirrors lib/research.mapLimit — bounded-concurrency map. Kept local so the runner's
// import graph and hermetic unit tests stay unchanged.
async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  async function worker() { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i) } }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
  return out
}

function textOf(resp: Anthropic.Message): string {
  return (resp.content || []).filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('').trim()
}

async function runOrchestrated(agent: AgentDef, opts: RunOpts, ctx: OrchCtx): Promise<RunResult> {
  const { client, exec, nowMs, model, pricing, g, guardCtx, persist } = ctx
  const emit: Emit = opts.emit || (() => {})
  const oc = DEFAULT_ORCHESTRATION
  const cap = Math.max(1, Math.min(agent.max_subagents ?? oc.max_subagents, MAX_SUBAGENTS_CEILING))
  const start = nowMs()
  const deadline = start + g.max_minutes * 60_000

  // Sub-agents are read-only: strip write tools regardless of the read_only flag. The lead
  // and synthesis do no tool calls. If the agent somehow has no usable read tool, fall back
  // to the safe default read set so a goal still runs.
  const allow = new Set(agent.tools || [])
  let subTools = TOOLS.filter(t => allow.has(t.name) && !WRITE_TOOLS.has(t.name))
  if (subTools.length === 0) subTools = TOOLS.filter(t => DEFAULT_AGENT_TOOLS.includes(t.name) && !WRITE_TOOLS.has(t.name))

  // Shared fleet budget. stepN counts every model call (lead plan + each sub-agent round +
  // synthesis); toolCalls is reserved atomically (check-then-increment with no await between).
  const budget = { stepN: 0, toolCalls: 0, inTok: 0, outTok: 0 }
  const cost = () => budget.inTok * pricing.input + budget.outTok * pricing.output
  const fleetTrip = (): string => {
    if (budget.stepN >= g.max_steps) return 'step_limit'
    if (nowMs() > deadline) return 'time_limit'
    if (cost() > g.max_cost_usd) return 'cost_limit'
    if (budget.toolCalls >= g.max_tool_calls) return 'tool_call_limit'
    return ''
  }
  const reserveTool = (): boolean => { if (budget.toolCalls >= g.max_tool_calls) return false; budget.toolCalls++; return true }
  const account = (resp: Anthropic.Message) => { budget.inTok += resp.usage?.input_tokens || 0; budget.outTok += resp.usage?.output_tokens || 0 }

  const steps: AgentStep[] = []
  let trip = ''
  let runId = persist ? await persistRun(undefined, { agent_id: agent.id, trigger_source: opts.triggerSource }) : undefined

  const learnings = (agent.learnings || '').trim()
  const learnBlock = learnings ? `\n\nHuman-approved learnings (use them, but re-verify against current data):\n${learnings}\n` : ''

  emit({ type: 'run_started', execution: 'orchestrated', goal: agent.goal })

  // ── 1. Lead: decompose the goal into independent sub-tasks ──
  let tasks: SubTask[] = []
  try {
    budget.stepN++
    const planSys = `You are the LEAD of an autonomous Mosaic agent team. The agent's goal:\n${agent.goal}\n${learnBlock}\n` +
      `Break this into 2-${cap} INDEPENDENT, non-overlapping sub-tasks that can be worked in parallel against the live data layer. ` +
      `Each needs a short title and a one-sentence brief telling the sub-agent exactly what to find or check. ` +
      `Prefer fewer, well-scoped sub-tasks. Reply with ONLY a JSON array: [{"title":"...","brief":"..."}]. No prose.`
    const resp = await client.messages.create({ model, max_tokens: 1200, system: planSys, messages: [{ role: 'user', content: `Decompose the goal into parallel sub-tasks.` }] })
    account(resp)
    const txt = textOf(resp)
    let arr: Array<{ title?: string; brief?: string }> = []
    try { arr = JSON.parse(txt.slice(txt.indexOf('['), txt.lastIndexOf(']') + 1)) } catch { arr = [] }
    tasks = arr.filter(t => t && t.title).slice(0, cap).map((t, i) => ({ id: `s${i + 1}`, title: String(t.title).slice(0, 120), brief: String(t.brief || t.title).slice(0, 400) }))
  } catch (e) {
    steps.push({ type: 'error', result: 'plan failed: ' + (e instanceof Error ? e.message : String(e)), at: iso() })
  }
  if (tasks.length === 0) tasks = [{ id: 's1', title: 'Carry out the goal', brief: agent.goal.slice(0, 400) }]
  steps.push({ type: 'plan', result: JSON.stringify(tasks.map(t => ({ title: t.title, brief: t.brief }))), at: iso() })
  emit({ type: 'plan', subtasks: tasks.map(t => ({ id: t.id, title: t.title, brief: t.brief })) })
  for (const t of tasks) emit({ type: 'subagent_status', id: t.id, status: 'queued', title: t.title })

  // ── 2. Fan out: each sub-task is a bounded, read-only agentic loop sharing the fleet budget ──
  const subSys = (task: SubTask) => `You are a focused sub-agent of the Mosaic agent "${agent.name}". Work ONLY this sub-task:\n${task.brief}\n${learnBlock}\n` +
    `Use ONLY the provided tools against the live data layer (read-only — you cannot take actions). When a data tool needs a source, target an explicit configured source. ` +
    `Do not speculate beyond what the tools return. When you have the facts, give a concise findings summary (key numbers, names, specifics) and stop.`

  const results = await mapLimit(tasks, oc.concurrency, async (task): Promise<SubResult> => {
    const sub: AgentStep[] = []
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: `Investigate and report. Be efficient — at most ${oc.subagent_tool_budget} tool calls.` }]
    let summary = '', err: string | undefined, localCalls = 0
    try {
      for (let round = 0; round < oc.subagent_tool_budget; round++) {
        const t = fleetTrip(); if (t) { trip = trip || t; err = err || t; break }
        budget.stepN++
        const forceFinish = round === oc.subagent_tool_budget - 1
        const resp = await client.messages.create({ model, max_tokens: 2000, system: subSys(task), tools: subTools, messages, ...(forceFinish ? { tool_choice: { type: 'none' as const } } : {}) })
        account(resp)
        const blocks = resp.content || []
        const txt = textOf(resp)
        if (txt) { summary = txt; sub.push({ type: 'reason', result: txt, at: iso(), sub: task.id }) }
        const toolUses = blocks.filter(b => b.type === 'tool_use') as Anthropic.ToolUseBlock[]
        if (resp.stop_reason !== 'tool_use' || toolUses.length === 0) break
        messages.push({ role: 'assistant', content: blocks })
        const toolResults: Anthropic.ToolResultBlockParam[] = []
        let stop = false
        for (const tu of toolUses) {
          if (!reserveTool()) { trip = trip || 'tool_call_limit'; err = err || 'tool_call_limit'; stop = true; break }
          localCalls++
          emit({ type: 'subagent_status', id: task.id, status: 'running', tool: tu.name })
          sub.push({ type: 'tool', tool: tu.name, input: tu.input, at: iso(), sub: task.id })
          let out: unknown
          try { out = await exec(tu.name, tu.input as Record<string, unknown>, guardCtx) }
          catch (e) { out = { error: e instanceof Error ? e.message : String(e) } }
          const rStr = typeof out === 'string' ? out : JSON.stringify(out)
          sub.push({ type: 'result', tool: tu.name, result: rStr.slice(0, 4000), at: iso(), sub: task.id })
          toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: rStr.slice(0, 12000) })
        }
        if (stop || toolResults.length === 0) break
        messages.push({ role: 'user', content: toolResults })
      }
    } catch (e) { err = e instanceof Error ? e.message : String(e); sub.push({ type: 'error', result: err, at: iso(), sub: task.id }) }
    if (!summary) summary = err ? `(no findings — ${err})` : '(no findings)'
    emit({ type: 'subagent_result', id: task.id, status: 'done', title: task.title, summary, toolCalls: localCalls, error: err })
    return { id: task.id, title: task.title, summary, toolCalls: localCalls, steps: sub, error: err }
  })

  for (const r of results) steps.push(...r.steps)

  // ── 3. Lead synthesis: one answer from the sub-agents' findings (best-effort even if tripped) ──
  // Honour the step/time/cost ceiling: if the fleet is already exhausted, don't spend another
  // model call — fall back to surfacing the partial findings so nothing that ran is lost.
  let finalText = ''
  emit({ type: 'synthesizing' })
  const partialFindings = () => results.map(r => `• ${r.title}: ${r.summary}`).join('\n')
  const preSynthTrip = fleetTrip()
  if (preSynthTrip && preSynthTrip !== 'tool_call_limit') {
    trip = trip || preSynthTrip
    finalText = `Run stopped (${preSynthTrip}) before synthesis. Partial findings:\n\n${partialFindings()}`
  } else {
    try {
      budget.stepN++
      const synSys = `You are the LEAD of the Mosaic agent "${agent.name}" writing the final result for this goal:\n${agent.goal}\n\n` +
        `Write a clear, concise answer using ONLY the evidence in your sub-agents' findings — do not invent. Lead with the key conclusion, then the supporting detail. If the evidence is incomplete, say so plainly.`
      const findings = results.map(r => `### ${r.title}\n${r.summary}`).join('\n\n')
      const resp = await client.messages.create({ model, max_tokens: 4000, system: synSys, messages: [{ role: 'user', content: `Sub-agent findings:\n${findings}` }] })
      account(resp)
      finalText = textOf(resp)
      if (finalText) steps.push({ type: 'synthesis', result: finalText, at: iso() })
    } catch (e) {
      // Synthesis failing must not lose the sub-agent findings that already ran.
      finalText = `Synthesis could not complete (${e instanceof Error ? e.message : String(e)}). Sub-agent findings:\n\n${partialFindings()}`
    }
  }

  const status: RunStatus = trip ? 'stopped' : 'succeeded'
  const stopReason = trip || 'completed'
  if (!finalText) finalText = trip ? `Run stopped: ${trip}. Partial findings saved.` : 'No output produced.'

  emit({ type: 'run_done', status, stop_reason: stopReason, subagents: results.length, tool_calls: budget.toolCalls, cost_usd: cost() })

  if (persist) await persistRun(runId, {
    status, steps: JSON.stringify(steps.slice(-300)), input_tokens: budget.inTok, output_tokens: budget.outTok,
    cost_usd: cost(), stop_reason: stopReason, result: finalText, ended: true,
  })

  return {
    status, stop_reason: stopReason, result: finalText, steps,
    steps_used: budget.stepN, tool_calls: budget.toolCalls, cost_usd: cost(),
    input_tokens: budget.inTok, output_tokens: budget.outTok, pending_tool: null, run_id: runId,
    execution: 'orchestrated',
    subagents: results.map(r => ({ id: r.id, title: r.title, summary: r.summary, tool_calls: r.toolCalls, error: r.error })),
  }
}
