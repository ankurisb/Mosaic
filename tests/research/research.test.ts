/**
 * Extreme test for the deep-research orchestrator (lib/research.ts). Drives the
 * REAL orchestration with a scripted fake Anthropic client and fake tool
 * executor (dependency-injected), so planning, the sub-agent loop, budgets,
 * concurrency, source harvesting, synthesis, event ordering, resilience and
 * read-only isolation are all exercised deterministically — no network/keys.
 *
 *   tsx tests/research/research.test.ts
 */
import { runResearch, mapLimit, harvestSources, SUBAGENT_TOOL_NAMES, SUBAGENT_TOOL_BUDGET, CONCURRENCY } from '@/lib/research'

let pass = 0, fail = 0
const ok = (n: string, c: boolean, d = '') => { console.log(`  [${c ? 'PASS' : 'FAIL'}] ${n}${d ? '  ' + d : ''}`); c ? pass++ : fail++ }
const section = (s: string) => console.log(`\n${s}`)

const CTX = { userId: 'u', userEmail: 'e@x', userRole: 'admin', model: 'fake-model' }
const txt = (t: string) => ({ content: [{ type: 'text', text: t }], stop_reason: 'end_turn' })
const tool = (name: string, input: unknown) => ({ content: [{ type: 'tool_use', id: 'tu' + Math.random().toString(36).slice(2), name, input }], stop_reason: 'tool_use' })

interface Cfg { planJson?: string; runawayOn?: string; throwOn?: string }
function makeClient(cfg: Cfg = {}) {
  const stats = { planCalls: 0, synthCalls: 0, subCreate: 0, cur: 0, maxConc: 0, toolsSeen: [] as string[] }
  const create = async (args: Record<string, unknown>) => {
    const sys = String(args.system || '')
    if (/lead of a research team/.test(sys)) { stats.planCalls++; return txt(cfg.planJson ?? '[{"title":"A","brief":"ba"},{"title":"B","brief":"bb"},{"title":"C","brief":"bc"},{"title":"D","brief":"bd"}]') }
    if (/lead researcher writing the final briefing/.test(sys)) { stats.synthCalls++; return txt('FINAL REPORT — key takeaway [1].') }
    // sub-agent path
    stats.subCreate++
    if (Array.isArray(args.tools)) stats.toolsSeen = (args.tools as Array<{ name: string }>).map(t => t.name)
    stats.cur++; stats.maxConc = Math.max(stats.maxConc, stats.cur)
    await new Promise(r => setTimeout(r, 15))
    try {
      const brief = String((args.messages as Array<{ content: unknown }>)?.[0]?.content || '')
      if (cfg.throwOn && brief.includes(cfg.throwOn)) throw new Error('model boom')
      const noTools = !!(args.tool_choice as { type?: string })?.type && (args.tool_choice as { type: string }).type === 'none'
      if (noTools) return txt('Forced summary.')
      if (cfg.runawayOn && brief.includes(cfg.runawayOn)) return tool('web_search', { query: 'loop' })
      const rounds = (args.messages as Array<{ role: string }>).filter(m => m.role === 'assistant').length
      return rounds < 1 ? tool('web_search', { query: 'q' }) : txt('Findings summary.')
    } finally { stats.cur-- }
  }
  return { client: { messages: { create } } as never, stats }
}

const execCalls: string[] = []
const fakeExec = (async (name: string) => {
  execCalls.push(name)
  if (name === 'web_search') return [{ title: 'Alpha', url: 'https://a.com' }, { title: 'Beta', url: 'https://b.com' }]
  return { ok: true }
}) as never

async function main() {
  // ── helpers ──────────────────────────────────────────────────────
  section('0. Pure helpers')
  {
    const acc: Array<{ title: string; url: string }> = []
    harvestSources([{ url: 'https://a.com', title: 'A' }, { nested: { url: 'https://b.com' } }, { url: 'https://a.com' }], acc)
    ok('harvestSources finds nested URLs and de-dupes', acc.length === 2 && acc[0].url === 'https://a.com')
    let peak = 0, cur = 0
    await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async () => { cur++; peak = Math.max(peak, cur); await new Promise(r => setTimeout(r, 8)); cur-- })
    ok('mapLimit respects the concurrency limit', peak <= 3, `peak=${peak}`)
  }

  section('1. Read-only isolation (no recursion, no writes)')
  {
    const banned = ['run_code', 'save_memory', 'forget_memory', 'deep_research', 'apply_api_fix', 'create_alert', 'render_chart', 'render_map', 'diagnose_api_connection']
    ok('sub-agent toolset excludes all write/dangerous/recursive tools', banned.every(n => !SUBAGENT_TOOL_NAMES.has(n)))
    ok('sub-agent toolset includes core research tools', SUBAGENT_TOOL_NAMES.has('web_search') && SUBAGENT_TOOL_NAMES.has('fetch_url') && SUBAGENT_TOOL_NAMES.has('query_prism'))
  }

  // ── happy path ───────────────────────────────────────────────────
  section('2. Happy path (4 sub-agents)')
  {
    execCalls.length = 0
    const { client, stats } = makeClient()
    const events: Array<Record<string, unknown>> = []
    const res = await runResearch('q', CTX, e => events.push(e), { client, exec: fakeExec })
    const types = events.map(e => e.type)
    ok('plan parsed into 4 sub-tasks', (events.find(e => e.type === 'research_plan')?.subtasks as unknown[])?.length === 4)
    ok('planner + synthesiser each called once', stats.planCalls === 1 && stats.synthCalls === 1)
    ok('final report returned from synthesis', res.report.startsWith('FINAL REPORT'))
    ok('4 subagent_result events', types.filter(t => t === 'subagent_result').length === 4)
    ok('concurrency peak ≤ CONCURRENCY', stats.maxConc <= CONCURRENCY, `peak=${stats.maxConc} limit=${CONCURRENCY}`)
    ok('sub-agent create got ONLY read-only tools', stats.toolsSeen.length > 0 && stats.toolsSeen.every(n => SUBAGENT_TOOL_NAMES.has(n)) && stats.toolsSeen.length === SUBAGENT_TOOL_NAMES.size)
    ok('executor only ran read-only tools', execCalls.every(n => SUBAGENT_TOOL_NAMES.has(n)))
    ok('sources de-duped across sub-agents (a.com,b.com → 2)', (events.find(e => e.type === 'research_done')?.sourceCount) === 2)
    ok('each sub-agent did 1 tool call', events.filter(e => e.type === 'subagent_result').every(e => e.toolCalls === 1))
    // event ordering
    const iStart = types.indexOf('research_started'), iPlan = types.indexOf('research_plan'), iSyn = types.indexOf('research_synthesizing'), iDone = types.indexOf('research_done')
    ok('event ordering: started < plan < synthesizing < done', iStart === 0 && iStart < iPlan && iPlan < iSyn && iSyn < iDone && iDone === types.length - 1)
    ok('every sub-task emitted a queued status', events.filter(e => e.type === 'subagent_status' && e.status === 'queued').length === 4)
    ok('running statuses carried the current tool', events.some(e => e.type === 'subagent_status' && e.status === 'running' && typeof e.tool === 'string'))
  }

  // ── budget cap ───────────────────────────────────────────────────
  section('3. Tool-budget cap (runaway sub-agents)')
  {
    const { client } = makeClient({ runawayOn: 'Research' })  // every brief loops forever
    const events: Array<Record<string, unknown>> = []
    const res = await runResearch('q', CTX, e => events.push(e), { client, exec: fakeExec })
    const results = events.filter(e => e.type === 'subagent_result')
    ok('runaway sub-agents stop at the budget', results.every(e => (e.toolCalls as number) <= SUBAGENT_TOOL_BUDGET && (e.toolCalls as number) === SUBAGENT_TOOL_BUDGET - 1), `toolCalls=${results.map(e => e.toolCalls)}`)
    ok('each still returns a summary (forced finish, no hang)', results.every(e => typeof e.summary === 'string' && (e.summary as string).length > 0))
    ok('run still completes', events.some(e => e.type === 'research_done') && res.report.length > 0)
  }

  // ── plan fallback ────────────────────────────────────────────────
  section('4. Malformed plan → safe fallback')
  {
    const { client } = makeClient({ planJson: 'this is not json at all' })
    const events: Array<Record<string, unknown>> = []
    const res = await runResearch('why did the inverter trip', CTX, e => events.push(e), { client, exec: fakeExec })
    const subs = events.find(e => e.type === 'research_plan')?.subtasks as unknown[]
    ok('bad plan JSON → single catch-all sub-task', subs?.length === 1)
    ok('run still completes with a report', res.report.length > 0 && events.some(e => e.type === 'research_done'))
  }

  // ── resilience ───────────────────────────────────────────────────
  section('5. Sub-agent failure is isolated')
  {
    const { client } = makeClient({ throwOn: 'bc' })  // the 3rd sub-task's model call throws
    const events: Array<Record<string, unknown>> = []
    const res = await runResearch('q', CTX, e => events.push(e), { client, exec: fakeExec })
    const results = events.filter(e => e.type === 'subagent_result')
    ok('all 4 sub-agents still report (failure contained)', results.length === 4)
    ok('the failed sub-agent is flagged, not fatal', results.some(e => e.error) && events.some(e => e.type === 'research_done'))
    ok('synthesis still produced a report', res.report.length > 0)
  }

  console.log(`\n${pass}/${pass + fail} passed — ${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}`)
  process.exit(fail === 0 ? 0 : 1)
}
main().catch(e => { console.error(e); process.exit(2) })
