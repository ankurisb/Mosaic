// lib/diagnose.ts
// Deep Diagnose (Phase 3.1) — multi-agent root-cause analysis for equipment
// faults. A lead decomposes the fault into testable HYPOTHESES (failure modes),
// each sub-agent tests one against the right data source, returning a verdict +
// confidence + evidence; synthesis ranks the probable causes and recommends the
// next checks. Built on the research orchestration (lib/research.ts) but
// specialised: diagnostic sub-agents get the data-source CATALOG in their prompt
// and run with strict source scoping.
import Anthropic from '@anthropic-ai/sdk'
import { getKey } from '@/lib/keys'
import { TOOLS, runTool } from '@/lib/tools'
import { audit, AUDIT } from '@/lib/audit'
import { mapLimit, harvestSources, SUBAGENT_TOOL_NAMES, SUBAGENT_TOOL_BUDGET, CONCURRENCY, type Emit, type ResearchCtx, type ResearchDeps, type Workspace } from '@/lib/research'

export interface DiagnoseCtx extends ResearchCtx { catalog?: string }
interface Hypothesis { id: string; title: string; hypothesis: string; how_to_test: string }
interface Source { title: string; url: string }
type Verdict = 'supported' | 'refuted' | 'inconclusive'
interface HypoResult extends Hypothesis { verdict: Verdict; confidence: number; evidence: string[]; summary: string; sources: Source[]; toolCalls: number; error?: string }
interface Cause { cause: string; confidence: number; evidence: string[] }

const MIN_H = 3, MAX_H = 6

function extractText(msg: Anthropic.Message): string {
  return msg.content.filter(b => b.type === 'text').map(b => (b as Anthropic.TextBlock).text).join('\n').trim()
}
function clamp01(n: number): number { return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0)) }

// Pull a trailing ===MARKER=== JSON block out of a model reply.
function parseTail(text: string, marker: string): Record<string, unknown> | null {
  const i = text.lastIndexOf(marker)
  if (i < 0) return null
  const after = text.slice(i + marker.length)
  const start = after.indexOf('{'), end = after.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try { return JSON.parse(after.slice(start, end + 1)) } catch { return null }
}

async function planDiagnose(anthropic: Anthropic, model: string, target: string, symptom: string, window: string, catalog: string): Promise<Hypothesis[]> {
  const resp = await anthropic.messages.create({
    model, max_tokens: 1400,
    system: `You are the lead diagnostic engineer. A piece of equipment has a fault. Break the diagnosis into ${MIN_H}-${MAX_H} INDEPENDENT, TESTABLE hypotheses about the root cause. Cover the relevant failure modes — telemetry/electrical anomaly, alarms/events sequence, maintenance & history, neighbouring assets / common-cause, control setpoints, sensor / data quality — choosing the ones that fit this asset and the data that actually exists. For each: a short title, the hypothesis, and how_to_test (which data to check). Reply with ONLY JSON: [{"title":"...","hypothesis":"...","how_to_test":"..."}]. No prose.`,
    messages: [{ role: 'user', content: `Target: ${target}\nSymptom: ${symptom}\nTime window: ${window || 'recent'}\n\nAvailable data sources:\n${catalog || '(none described)'}` }],
  })
  const txt = extractText(resp)
  let arr: Array<{ title?: string; hypothesis?: string; how_to_test?: string }> = []
  try { arr = JSON.parse(txt.slice(txt.indexOf('['), txt.lastIndexOf(']') + 1)) } catch { arr = [] }
  const hs = arr.filter(h => h && (h.title || h.hypothesis)).slice(0, MAX_H).map((h, i) => ({
    id: `h${i + 1}`, title: String(h.title || `Hypothesis ${i + 1}`).slice(0, 120),
    hypothesis: String(h.hypothesis || h.title || '').slice(0, 400), how_to_test: String(h.how_to_test || '').slice(0, 400),
  }))
  if (hs.length >= 1) return hs
  return [{ id: 'h1', title: 'General fault investigation', hypothesis: `Investigate why ${target} showed: ${symptom}`, how_to_test: 'Check telemetry, alarms and history around the event.' }]
}

async function runHypoSubAgent(anthropic: Anthropic, ctx: DiagnoseCtx, h: Hypothesis, emit: Emit, exec: typeof runTool): Promise<HypoResult> {
  const tools = TOOLS.filter(t => SUBAGENT_TOOL_NAMES.has(t.name))
  const guardrailCtx = { userId: ctx.userId, userEmail: ctx.userEmail, userRole: ctx.userRole, conversationId: ctx.conversationId, allowedSources: ctx.allowedSources, strictSources: true }
  const sources: Source[] = []
  let toolCalls = 0
  const system = `You are a diagnostic sub-agent testing ONE hypothesis about an equipment fault. Use the read-only data tools (telemetry, alarms, history) to gather evidence; use web_search/fetch_url only for reference specs. Do not speculate — report only what the tools return. When a data tool needs a source, target an explicit source from the catalog.\n\nAvailable data sources:\n${ctx.catalog || '(none described)'}\n\nEnd your reply with a line "===VERDICT===" then JSON: {"verdict":"supported|refuted|inconclusive","confidence":0.0-1.0,"evidence":["short fact","short fact"]}.`
  const history: Anthropic.MessageParam[] = [{ role: 'user', content: `Hypothesis: ${h.hypothesis}\nHow to test: ${h.how_to_test}\n\nInvestigate and give your verdict with evidence. At most ${SUBAGENT_TOOL_BUDGET} tool calls.` }]

  for (let round = 0; round < SUBAGENT_TOOL_BUDGET; round++) {
    const forceFinish = round === SUBAGENT_TOOL_BUDGET - 1
    let resp: Anthropic.Message
    try { resp = await anthropic.messages.create({ model: ctx.model, max_tokens: 2000, system, tools, messages: history, ...(forceFinish ? { tool_choice: { type: 'none' as const } } : {}) }) }
    catch (e) { return { ...h, verdict: 'inconclusive', confidence: 0, evidence: [], summary: `error: ${e instanceof Error ? e.message : 'failed'}`, sources, toolCalls, error: 'model' } }
    const toolUses = resp.content.filter(b => b.type === 'tool_use') as Anthropic.ToolUseBlock[]
    if (resp.stop_reason !== 'tool_use' || !toolUses.length) return finalize(h, extractText(resp), sources, toolCalls)
    history.push({ role: 'assistant', content: resp.content })
    const results: Anthropic.ToolResultBlockParam[] = []
    for (const tu of toolUses) {
      emit({ type: 'subagent_status', id: h.id, status: 'running', tool: tu.name })
      toolCalls++
      let result: unknown
      try { result = await exec(tu.name, tu.input as Record<string, unknown>, guardrailCtx) } catch (e) { result = { error: e instanceof Error ? e.message : 'tool failed' } }
      harvestSources(result, sources)
      let s = JSON.stringify(result); if (s.length > 24000) s = s.slice(0, 24000) + ' …[truncated]'
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: s })
    }
    history.push({ role: 'user', content: results })
  }
  try {
    const fin = await anthropic.messages.create({ model: ctx.model, max_tokens: 1500, system, messages: [...history, { role: 'user', content: 'Give your verdict now (with the ===VERDICT=== JSON). No more tools.' }] })
    return finalize(h, extractText(fin), sources, toolCalls)
  } catch { return { ...h, verdict: 'inconclusive', confidence: 0.2, evidence: [], summary: '(verdict unavailable)', sources, toolCalls, error: 'synth' } }

  function finalize(hypo: Hypothesis, text: string, src: Source[], calls: number): HypoResult {
    const v = parseTail(text, '===VERDICT===')
    const verdict: Verdict = v && ['supported', 'refuted', 'inconclusive'].includes(String(v.verdict)) ? v.verdict as Verdict : 'inconclusive'
    const confidence = v ? clamp01(Number(v.confidence)) : 0.3
    const evidence = v && Array.isArray(v.evidence) ? (v.evidence as unknown[]).map(x => String(x)).slice(0, 6) : []
    const summary = (v ? text.slice(0, text.lastIndexOf('===VERDICT===')) : text).trim() || '(no findings)'
    return { ...hypo, verdict, confidence, evidence, summary, sources: src, toolCalls: calls }
  }
}

async function synthesizeDiagnosis(anthropic: Anthropic, model: string, target: string, symptom: string, results: HypoResult[], sources: Source[]): Promise<{ report: string; causes: Cause[]; checks: string[] }> {
  const srcList = sources.map((s, i) => `[${i + 1}] ${s.title} — ${s.url}`).join('\n')
  const findings = results.map(r => `### ${r.title} — verdict: ${r.verdict} (confidence ${r.confidence.toFixed(2)})\n${r.summary}\nEvidence: ${r.evidence.join('; ') || '(none)'}`).join('\n\n')
  const resp = await anthropic.messages.create({
    model, max_tokens: 4000,
    system: `You are the lead diagnostic engineer writing the RCA conclusion from your sub-agents' hypothesis tests. Write: (1) the most probable root cause(s), ranked most-likely first, each with the evidence behind it; (2) which hypotheses were ruled out; (3) recommended next checks the engineer should perform. Use ONLY the evidence provided — if it's inconclusive, say so plainly. At the very end add a JSON block on its own: "===CAUSES===" then {"causes":[{"cause":"...","confidence":0.0-1.0,"evidence":["..."]}],"checks":["..."]}.`,
    messages: [{ role: 'user', content: `Fault — target: ${target}; symptom: ${symptom}.\n\nHypothesis tests:\n${findings}\n\nNumbered sources:\n${srcList || '(none)'}` }],
  })
  const text = extractText(resp)
  const tail = parseTail(text, '===CAUSES===')
  const causes: Cause[] = tail && Array.isArray(tail.causes) ? (tail.causes as Array<Record<string, unknown>>).map(c => ({ cause: String(c.cause || ''), confidence: clamp01(Number(c.confidence)), evidence: Array.isArray(c.evidence) ? (c.evidence as unknown[]).map(x => String(x)).slice(0, 6) : [] })).filter(c => c.cause) : []
  const checks: string[] = tail && Array.isArray(tail.checks) ? (tail.checks as unknown[]).map(x => String(x)).slice(0, 10) : []
  const report = (tail ? text.slice(0, text.lastIndexOf('===CAUSES===')) : text).trim()
  return { report, causes, checks }
}

export async function runDiagnose(params: { target: string; symptom: string; window?: string }, ctx: DiagnoseCtx, emit: Emit, deps?: ResearchDeps): Promise<{ report: string; causes: Cause[]; checks: string[]; sources: Source[]; workspace: Workspace }> {
  const anthropic = deps?.client ?? new Anthropic({ apiKey: (await getKey('ANTHROPIC_API_KEY')) || undefined })
  const exec = deps?.exec ?? runTool
  const target = params.target || 'the asset', symptom = params.symptom || 'a fault', window = params.window || ''

  emit({ type: 'research_started', mode: 'diagnose', question: `Diagnose ${target}: ${symptom}` })
  const t0 = Date.now()
  const hs = await planDiagnose(anthropic, ctx.model, target, symptom, window, ctx.catalog || '')
  emit({ type: 'research_plan', mode: 'diagnose', question: `Diagnose ${target}: ${symptom}`, subtasks: hs.map(h => ({ id: h.id, title: h.title, brief: h.hypothesis })) })
  for (const h of hs) emit({ type: 'subagent_status', id: h.id, status: 'queued' })

  const results = await mapLimit(hs, CONCURRENCY, async (h) => {
    const r = await runHypoSubAgent(anthropic, ctx, h, emit, exec)
    emit({ type: 'subagent_result', id: h.id, status: 'done', title: h.title, summary: r.summary, verdict: r.verdict, confidence: r.confidence, sources: r.sources.length, toolCalls: r.toolCalls, error: r.error })
    return r
  })

  emit({ type: 'research_synthesizing' })
  const sources: Source[] = []
  for (const r of results) harvestSources(r.sources, sources)
  const syn = await synthesizeDiagnosis(anthropic, ctx.model, target, symptom, results, sources)
  emit({ type: 'research_done', mode: 'diagnose', sourceCount: sources.length, subagentCount: results.length, causes: syn.causes, checks: syn.checks, ms: Date.now() - t0 })

  try { await audit(null, { id: ctx.userId, email: ctx.userEmail, role: ctx.userRole }, AUDIT.TOOL_CALL, 'deep_diagnose', 'success', { hypotheses: results.length, sources: sources.length, causes: syn.causes.length }) } catch {}

  const workspace: Workspace = {
    mode: 'diagnose', question: `Diagnose ${target}: ${symptom}`, phase: 'done',
    subtasks: results.map(r => ({ id: r.id, title: r.title, status: 'done' as const, summary: r.summary, verdict: r.verdict, confidence: r.confidence, sources: r.sources.length, toolCalls: r.toolCalls, error: r.error })),
    sourceCount: sources.length, subagentCount: results.length,
    causes: syn.causes, checks: syn.checks,
  }
  return { report: syn.report, causes: syn.causes, checks: syn.checks, sources, workspace }
}
