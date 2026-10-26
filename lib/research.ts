// lib/research.ts
// Deep-research orchestrator (Phase 3). A lead pass decomposes the question into
// focused sub-tasks; each sub-task runs its own bounded, read-only agentic loop
// (a "sub-agent") in parallel; a final pass synthesises a cited briefing. Progress
// is streamed to the client via the `emit` callback so the Research Workspace
// panel can show agents spinning out live.
import Anthropic from '@anthropic-ai/sdk'
import { getKey } from '@/lib/keys'
import { getAiClient } from '@/lib/models'
import { TOOLS, runTool } from '@/lib/tools'
import { audit, AUDIT } from '@/lib/audit'

export type Emit = (event: Record<string, unknown>) => void
export interface ResearchCtx { userId: string; userEmail: string; userRole: string; conversationId?: string; allowedSources?: string[]; model: string }

// Sub-agents get read-only research tools only — never write actions or run_code.
export const SUBAGENT_TOOL_NAMES = new Set(['web_search', 'fetch_url', 'query_database', 'query_prism', 'call_api', 'read_file_server', 'query_airbyte', 'query_mcp', 'combine_sources', 'run_statistical_analysis'])
const MIN_SUBAGENTS = 2, MAX_SUBAGENTS = 6
export const SUBAGENT_TOOL_BUDGET = 6
export const CONCURRENCY = 3

// Dependency injection point for tests: swap the Anthropic client and the tool
// executor with scripted fakes to exercise the orchestration deterministically.
export interface ResearchDeps { client?: Anthropic; exec?: typeof runTool }

interface SubTask { id: string; title: string; brief: string }
interface Source { title: string; url: string }
interface SubResult extends SubTask { summary: string; headline?: string; bullets?: string[]; sources: Source[]; toolCalls: number; error?: string }

// A serialisable snapshot of the finished workspace, persisted on the assistant
// message so the Research/Diagnosis panel can be reopened later (and after a
// reload) instead of being lost when it's closed. Shape mirrors the client's
// ResearchState so the panel can render it directly.
export interface WorkspaceSubtask {
  id: string; title: string; status: 'done'
  summary?: string; headline?: string; bullets?: string[]
  links?: Source[]; sources?: number; toolCalls?: number; error?: string
  verdict?: 'supported' | 'refuted' | 'inconclusive'; confidence?: number
}
export interface Workspace {
  mode: 'research' | 'diagnose'; question: string; phase: 'done'
  subtasks: WorkspaceSubtask[]; sourceCount: number; subagentCount: number
  causes?: Array<{ cause: string; confidence: number; evidence: string[] }>; checks?: string[]
}

// Sub-agents end their final message with a `===FINDING===` JSON trailer so the
// Research panel can render a structured card (one-line headline + key-fact
// bullets) instead of a wall of prose. Parsing is best-effort: a model that
// doesn't emit the trailer just falls back to its raw text as the summary, so
// nothing breaks. The prose BEFORE the marker is kept as `summary` (what the
// synthesis step consumes); the JSON AFTER it becomes headline + bullets.
const FINDING_MARKER = '===FINDING==='
function parseFinding(raw: string): { summary: string; headline?: string; bullets?: string[] } {
  const text = (raw || '').trim()
  const at = text.indexOf(FINDING_MARKER)
  if (at === -1) return { summary: text || '(no findings)' }
  const prose = text.slice(0, at).trim()
  const tail = text.slice(at + FINDING_MARKER.length).trim()
  try {
    const obj = JSON.parse(tail.slice(tail.indexOf('{'), tail.lastIndexOf('}') + 1)) as { headline?: unknown; bullets?: unknown }
    const headline = typeof obj.headline === 'string' ? obj.headline.trim().slice(0, 200) : undefined
    const bullets = Array.isArray(obj.bullets)
      ? obj.bullets.filter((b): b is string => typeof b === 'string' && b.trim().length > 0).slice(0, 5).map(b => b.trim().slice(0, 240))
      : undefined
    return { summary: prose || headline || '(no findings)', headline, bullets: bullets && bullets.length ? bullets : undefined }
  } catch {
    return { summary: prose || text || '(no findings)' }
  }
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  async function worker() { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i) } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

function extractText(msg: Anthropic.Message): string {
  return msg.content.filter(b => b.type === 'text').map(b => (b as Anthropic.TextBlock).text).join('\n').trim()
}

// Pull {title,url} pairs out of whatever a research tool returned.
export function harvestSources(result: unknown, acc: Source[]) {
  const seen = new Set(acc.map(s => s.url))
  const visit = (v: unknown, depth: number) => {
    if (!v || depth > 4) return
    if (Array.isArray(v)) { v.forEach(x => visit(x, depth + 1)); return }
    if (typeof v === 'object') {
      const o = v as Record<string, unknown>
      const url = typeof o.url === 'string' ? o.url : undefined
      if (url && /^https?:\/\//.test(url) && !seen.has(url)) { seen.add(url); acc.push({ url, title: String(o.title || o.name || url).slice(0, 160) }) }
      for (const k of Object.keys(o)) visit(o[k], depth + 1)
    }
  }
  visit(result, 0)
}

async function planResearch(anthropic: Anthropic, model: string, question: string): Promise<SubTask[]> {
  const resp = await anthropic.messages.create({
    model, max_tokens: 1200,
    system: `You are the lead of a research team. Break the user's question into ${MIN_SUBAGENTS}-${MAX_SUBAGENTS} focused, non-overlapping sub-tasks that can be researched independently and in parallel. Each needs a short title and a one-sentence brief telling the sub-agent exactly what to find. Reply with ONLY a JSON array: [{"title":"...","brief":"..."}]. No prose.`,
    messages: [{ role: 'user', content: question }],
  })
  const txt = extractText(resp)
  let arr: Array<{ title?: string; brief?: string }> = []
  try { arr = JSON.parse(txt.slice(txt.indexOf('['), txt.lastIndexOf(']') + 1)) } catch { arr = [] }
  const tasks = arr.filter(t => t && t.title).slice(0, MAX_SUBAGENTS).map((t, i) => ({ id: `s${i + 1}`, title: String(t.title).slice(0, 120), brief: String(t.brief || t.title).slice(0, 400) }))
  if (tasks.length >= MIN_SUBAGENTS) return tasks
  // Fallback: a single catch-all sub-task so research still proceeds.
  return [{ id: 's1', title: 'Research the question', brief: question.slice(0, 400) }]
}

async function runSubAgent(anthropic: Anthropic, ctx: ResearchCtx, task: SubTask, emit: Emit, exec: typeof runTool): Promise<SubResult> {
  const tools = TOOLS.filter(t => SUBAGENT_TOOL_NAMES.has(t.name))
  const guardrailCtx = { userId: ctx.userId, userEmail: ctx.userEmail, userRole: ctx.userRole, conversationId: ctx.conversationId, allowedSources: ctx.allowedSources }
  const sources: Source[] = []
  let toolCalls = 0
  const history: Anthropic.MessageParam[] = [{ role: 'user', content: `Research task: ${task.brief}\n\nGather evidence with the tools, then give a concise findings summary (the key facts, numbers, named players), citing what you found. Be efficient — at most ${SUBAGENT_TOOL_BUDGET} tool calls.` }]
  const system = `You are a focused research sub-agent. Use web_search and fetch_url for public sources, and the data tools for internal data. Do not speculate — report only what the tools return.

Your final message MUST have two parts:
1. A tight factual summary (one or two sentences).
2. Then, on its own line, the marker ${FINDING_MARKER} followed by a JSON object:
{"headline":"<the single most important takeaway, one clause>","bullets":["<concrete fact, number or named player>", "<another>", "...up to 5"]}
Keep each bullet to one short line — a figure, a name, a specific fact — not a sentence of prose. Only include facts the tools returned.`

  for (let round = 0; round < SUBAGENT_TOOL_BUDGET; round++) {
    const forceFinish = round === SUBAGENT_TOOL_BUDGET - 1
    let resp: Anthropic.Message
    try {
      resp = await anthropic.messages.create({ model: ctx.model, max_tokens: 2000, system, tools, messages: history, ...(forceFinish ? { tool_choice: { type: 'none' as const } } : {}) })
    } catch (e) { return { ...task, summary: `Sub-agent error: ${e instanceof Error ? e.message : 'failed'}`, sources, toolCalls, error: 'model' } }
    const toolUses = resp.content.filter(b => b.type === 'tool_use') as Anthropic.ToolUseBlock[]
    if (resp.stop_reason !== 'tool_use' || !toolUses.length) {
      return { ...task, ...parseFinding(extractText(resp)), sources, toolCalls }
    }
    history.push({ role: 'assistant', content: resp.content })
    const results: Anthropic.ToolResultBlockParam[] = []
    for (const tu of toolUses) {
      emit({ type: 'subagent_status', id: task.id, status: 'running', tool: tu.name })
      toolCalls++
      let result: unknown
      try { result = await exec(tu.name, tu.input as Record<string, unknown>, guardrailCtx) }
      catch (e) { result = { error: e instanceof Error ? e.message : 'tool failed' } }
      harvestSources(result, sources)
      let s = JSON.stringify(result)
      if (s.length > 24000) s = s.slice(0, 24000) + ' …[truncated]'
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: s })
    }
    history.push({ role: 'user', content: results })
  }
  // Budget exhausted without a clean finish — ask for a summary with no tools.
  try {
    const fin = await anthropic.messages.create({ model: ctx.model, max_tokens: 1500, system, messages: [...history, { role: 'user', content: `Summarise your findings now. No more tools. Give one or two factual sentences, then the ${FINDING_MARKER} JSON object (headline + bullets) as instructed.` }] })
    return { ...task, ...parseFinding(extractText(fin)), sources, toolCalls }
  } catch { return { ...task, summary: '(summary unavailable)', sources, toolCalls, error: 'synth' } }
}

async function synthesize(anthropic: Anthropic, model: string, question: string, results: SubResult[], sources: Source[]): Promise<string> {
  const srcList = sources.map((s, i) => `[${i + 1}] ${s.title} — ${s.url}`).join('\n')
  const findings = results.map(r => `### ${r.title}\n${r.summary}`).join('\n\n')
  const resp = await anthropic.messages.create({
    model, max_tokens: 4000,
    system: `You are the lead researcher writing the final briefing from your sub-agents' findings. Write a clear, well-structured answer to the user's question: lead with the key takeaway, then the supporting detail in short sections. Cite sources inline as [n] using the numbered list provided. Only use facts present in the findings — do not invent. End with no "Sources" list (the UI shows it).`,
    messages: [{ role: 'user', content: `Question: ${question}\n\nSub-agent findings:\n${findings}\n\nNumbered sources:\n${srcList || '(none)'}` }],
  })
  return extractText(resp)
}

export async function runResearch(question: string, ctx: ResearchCtx, emit: Emit, deps?: ResearchDeps): Promise<{ report: string; sources: Source[]; subagents: Array<{ title: string; summary: string; sources: number }>; workspace: Workspace }> {
  const anthropic = deps?.client ?? await getAiClient()
  const exec = deps?.exec ?? runTool

  emit({ type: 'research_started', question })
  const t0 = Date.now()
  const tasks = await planResearch(anthropic, ctx.model, question)
  emit({ type: 'research_plan', question, subtasks: tasks.map(t => ({ id: t.id, title: t.title, brief: t.brief })) })
  for (const t of tasks) emit({ type: 'subagent_status', id: t.id, status: 'queued' })

  const results = await mapLimit(tasks, CONCURRENCY, async (task) => {
    const r = await runSubAgent(anthropic, ctx, task, emit, exec)
    emit({ type: 'subagent_result', id: task.id, status: 'done', title: task.title, summary: r.summary, headline: r.headline, bullets: r.bullets, links: r.sources.slice(0, 3), sources: r.sources.length, toolCalls: r.toolCalls, error: r.error })
    return r
  })

  emit({ type: 'research_synthesizing' })
  const sources: Source[] = []
  for (const r of results) harvestSources(r.sources, sources)
  const report = await synthesize(anthropic, ctx.model, question, results, sources)
  emit({ type: 'research_done', sourceCount: sources.length, subagentCount: results.length, ms: Date.now() - t0 })

  try { await audit(null, { id: ctx.userId, email: ctx.userEmail, role: ctx.userRole }, AUDIT.TOOL_CALL, 'deep_research', 'success', { subagents: results.length, sources: sources.length, toolCalls: results.reduce((a, r) => a + r.toolCalls, 0) }) } catch {}

  const workspace: Workspace = {
    mode: 'research', question, phase: 'done',
    subtasks: results.map(r => ({ id: r.id, title: r.title, status: 'done' as const, summary: r.summary, headline: r.headline, bullets: r.bullets, links: r.sources.slice(0, 3), sources: r.sources.length, toolCalls: r.toolCalls, error: r.error })),
    sourceCount: sources.length, subagentCount: results.length,
  }
  return { report, sources, subagents: results.map(r => ({ title: r.title, summary: r.summary, sources: r.sources.length })), workspace }
}
