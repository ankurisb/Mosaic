/**
 * Deep Diagnose — EXTREME test pass. Adversarial / edge-case coverage beyond the
 * happy-path diagnose.test.ts: malformed verdict/causes JSON, out-of-range
 * confidence, invalid verdicts, plan under/overflow, sub-agent failure isolation,
 * synthesis-failure graceful fallback, strict-source governance, read-only tool
 * scoping, and tool-budget exhaustion.
 *
 *   npx tsx tests/research/diagnose-extreme.test.ts
 */
import { runDiagnose } from '@/lib/diagnose'
import { runTool } from '@/lib/tools'
import { SUBAGENT_TOOL_NAMES } from '@/lib/research'

let pass = 0, fail = 0
const ok = (n: string, c: boolean, d = '') => { console.log(`  [${c ? 'PASS' : 'FAIL'}] ${n}${d ? '  ' + d : ''}`); c ? pass++ : fail++ }

const txt = (t: string) => ({ content: [{ type: 'text', text: t }], stop_reason: 'end_turn' })
const toolUse = (name: string, input: unknown) => ({ content: [{ type: 'tool_use', id: 'tu' + Math.random(), name, input }], stop_reason: 'tool_use' })
const CTX = { userId: 'u', userEmail: 'e', userRole: 'admin', model: 'fake', allowedSources: [] as string[], catalog: 'Prism: p1 (inverters)' }
const fakeExec = (async () => ({ ok: true, rows: [{ v1n: 280 }] })) as never
const GOOD_SYNTH = 'Grid overvoltage.\n===CAUSES===\n{"causes":[{"cause":"Overvoltage","confidence":0.8,"evidence":["v1n 280V"]}],"checks":["Inspect AC"]}'
const PLAN2 = '[{"title":"H1","hypothesis":"a","how_to_test":"x"},{"title":"H2","hypothesis":"b","how_to_test":"y"}]'

type Sub = string | ((a: Record<string, unknown>) => unknown)
function client(sub: Sub, synth: string = GOOD_SYNTH, plan: string = PLAN2) {
  return { messages: { create: async (a: Record<string, unknown>) => {
    const s = String(a.system || '')
    if (/diagnostic sub-agent testing ONE hypothesis/.test(s)) return typeof sub === 'function' ? sub(a) : txt(sub)
    if (/writing the RCA conclusion/.test(s)) { if (synth === 'THROW') throw new Error('synth network error'); return txt(synth) }
    return txt(plan)
  } } } as never
}
async function run(sub: Sub, synth?: string, plan?: string) {
  const events: Record<string, unknown>[] = []
  const res = await runDiagnose({ target: 'INV-01', symptom: 'tripped' }, CTX, e => events.push(e), { client: client(sub, synth, plan), exec: fakeExec })
  return { events, res, sr: events.filter(e => e.type === 'subagent_result') }
}

async function main() {
  console.log('Deep Diagnose — EXTREME pass')

  // 1. Malformed VERDICT JSON → inconclusive, default confidence, no evidence.
  {
    const { sr } = await run('Looked at it.\n===VERDICT===\n{verdict:"supported", confidence:}')
    ok('malformed VERDICT JSON → inconclusive + default confidence 0.3', sr.every(e => e.verdict === 'inconclusive' && e.confidence === 0.3))
  }
  // 2. Invalid verdict value → inconclusive.
  {
    const { sr } = await run('x\n===VERDICT===\n{"verdict":"maybe","confidence":0.6,"evidence":["e"]}')
    ok('invalid verdict value ("maybe") → inconclusive', sr.every(e => e.verdict === 'inconclusive'))
  }
  // 3. Out-of-range confidence is clamped to [0,1].
  {
    const hi = await run('x\n===VERDICT===\n{"verdict":"supported","confidence":9,"evidence":[]}')
    ok('confidence 9 clamped to 1.0', hi.sr.every(e => e.confidence === 1))
    const lo = await run('x\n===VERDICT===\n{"verdict":"supported","confidence":-0.5,"evidence":[]}')
    ok('confidence -0.5 clamped to 0', lo.sr.every(e => e.confidence === 0))
    const nan = await run('x\n===VERDICT===\n{"verdict":"supported","confidence":"abc","evidence":[]}')
    ok('non-numeric confidence → 0', nan.sr.every(e => e.confidence === 0))
  }
  // 4. Non-array evidence → [] (no crash). Verified via successful synth downstream.
  {
    const { res } = await run('x\n===VERDICT===\n{"verdict":"supported","confidence":0.5,"evidence":"oops not array"}')
    ok('non-array evidence tolerated, run completes', typeof res.report === 'string' && res.report.length > 0)
  }
  // 5. No VERDICT marker at all → inconclusive, prose kept as summary.
  {
    const { sr } = await run('Just prose with no verdict block at all.')
    ok('missing VERDICT marker → inconclusive (default 0.3)', sr.every(e => e.verdict === 'inconclusive' && e.confidence === 0.3))
  }
  // 6. Plan returns ZERO hypotheses → single fallback hypothesis.
  {
    const { events } = await run('x\n===VERDICT===\n{"verdict":"inconclusive","confidence":0.3,"evidence":[]}', GOOD_SYNTH, '[]')
    const plan = events.find(e => e.type === 'research_plan')
    ok('empty plan → one fallback hypothesis', (plan?.subtasks as unknown[])?.length === 1)
  }
  // 7. Plan returns MORE than MAX_H (8) → capped at 6.
  {
    const big = JSON.stringify(Array.from({ length: 8 }, (_, i) => ({ title: `H${i}`, hypothesis: `h${i}`, how_to_test: 't' })))
    const { events } = await run('x\n===VERDICT===\n{"verdict":"inconclusive","confidence":0.3,"evidence":[]}', GOOD_SYNTH, big)
    const plan = events.find(e => e.type === 'research_plan')
    ok('overflowing plan capped at MAX_H=6', (plan?.subtasks as unknown[])?.length === 6)
  }
  // 8. Sub-agent FAILURE ISOLATION: one hypothesis' model call throws, the other
  //    still produces a verdict and the run completes.
  {
    const sub = (a: Record<string, unknown>) => {
      const u = JSON.stringify((a.messages as unknown[]) || '')
      if (/Hypothesis: a/.test(u)) throw new Error('model boom')
      return txt('ok\n===VERDICT===\n{"verdict":"supported","confidence":0.7,"evidence":["e"]}')
    }
    const { sr, res } = await run(sub)
    const failed = sr.find(e => (e.title as string) === 'H1')
    const okOne = sr.find(e => (e.title as string) === 'H2')
    ok('failed hypothesis isolated (error flag, inconclusive)', failed?.error === 'model' && failed?.verdict === 'inconclusive')
    ok('sibling hypothesis still supported despite the failure', okOne?.verdict === 'supported')
    ok('run still completes with a report after a sub-agent failure', typeof res.report === 'string' && res.report.length > 0)
  }
  // 9. Malformed CAUSES in synthesis → empty causes/checks, report still returned.
  {
    const { res } = await run('x\n===VERDICT===\n{"verdict":"supported","confidence":0.6,"evidence":["e"]}', 'Prose conclusion but no causes block.')
    ok('malformed CAUSES → empty causes + checks, no crash', res.causes.length === 0 && res.checks.length === 0)
    ok('report preserved when CAUSES block is absent', res.report.includes('Prose conclusion'))
  }
  // 10. Synthesis THROWS → graceful fallback surfaces supported hypotheses as causes.
  {
    const { res } = await run('x\n===VERDICT===\n{"verdict":"supported","confidence":0.75,"evidence":["spike"]}', 'THROW')
    ok('synthesis failure does NOT crash the run', typeof res.report === 'string' && res.report.includes('Synthesis could not complete'))
    ok('supported hypotheses surfaced as ranked causes on synth failure', res.causes.length >= 1 && res.causes.every(c => c.confidence === 0.75))
  }
  // 11. Tool-budget exhaustion: a sub-agent that keeps calling tools is forced to
  //     a no-tools verdict at the budget, with tool calls bounded.
  {
    const sub = (a: Record<string, unknown>) => {
      const forced = (a.tool_choice as { type?: string } | undefined)?.type === 'none'
      return forced ? txt('done\n===VERDICT===\n{"verdict":"supported","confidence":0.6,"evidence":["e"]}')
                    : toolUse('query_prism', { instance_id: 'p1', operation: 'telemetry' })
    }
    const { sr } = await run(sub)
    ok('budget exhaustion → bounded tool calls then a forced verdict', sr.every(e => Number(e.toolCalls) === 5 && e.verdict === 'supported'), `toolCalls=${sr.map(e => e.toolCalls).join(',')}`)
  }

  console.log('\nGovernance')
  // 12. strictSources: a source tool with no explicit id is blocked when scoped.
  {
    const r = await runTool('query_prism', { operation: 'telemetry' }, { userId: 'u', userEmail: 'e', userRole: 'admin', allowedSources: ['p1'], strictSources: true } as never) as Record<string, unknown>
    ok('strictSources blocks an unscoped source-tool call', r.out_of_scope === true && r.blocked === true)
  }
  // 13. Read-only governance: diagnose sub-agents never get write / codegen / recursion tools.
  {
    const banned = ['run_code', 'save_memory', 'forget_memory', 'render_map', 'render_chart', 'deep_research', 'deep_diagnose']
    ok('sub-agent toolset excludes write/codegen/recursion tools', banned.every(b => !SUBAGENT_TOOL_NAMES.has(b)))
  }

  console.log(`\n${pass}/${pass + fail} passed — ${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}`)
  process.exit(fail === 0 ? 0 : 1)
}
main().catch(e => { console.error(e); process.exit(2) })
