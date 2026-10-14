/**
 * Deep Diagnose (Phase 3.1) tests — orchestrator driven by a scripted fake
 * model + fake tools, plus the strictSources scope guard.
 *   tsx tests/research/diagnose.test.ts
 */
import { runDiagnose } from '@/lib/diagnose'
import { runTool } from '@/lib/tools'

let pass = 0, fail = 0
const ok = (n: string, c: boolean, d = '') => { console.log(`  [${c ? 'PASS' : 'FAIL'}] ${n}${d ? '  ' + d : ''}`); c ? pass++ : fail++ }

const txt = (t: string) => ({ content: [{ type: 'text', text: t }], stop_reason: 'end_turn' })
const tool = (name: string, input: unknown) => ({ content: [{ type: 'tool_use', id: 'tu' + Math.random(), name, input }], stop_reason: 'tool_use' })

const PLAN = '[{"title":"Telemetry anomaly","hypothesis":"voltage spike before trip","how_to_test":"check v1n"},{"title":"Alarm sequence","hypothesis":"mb_error fired","how_to_test":"read alarms"},{"title":"Maintenance history","hypothesis":"overdue service","how_to_test":"history"}]'
const VERDICT = 'Found a voltage spike just before the trip.\n===VERDICT===\n{"verdict":"supported","confidence":0.8,"evidence":["v1n spiked to 280V at 02:14","mb_error set at 02:14"]}'
const SYNTH = 'The most likely cause is a grid overvoltage event that tripped the inverter.\n===CAUSES===\n{"causes":[{"cause":"Grid overvoltage tripped the inverter","confidence":0.8,"evidence":["v1n 280V at 02:14"]},{"cause":"Loose DC connection","confidence":0.3,"evidence":[]}],"checks":["Inspect AC terminals","Download the full event log"]}'

function fakeClient() {
  const create = async (args: Record<string, unknown>) => {
    const sys = String(args.system || '')
    if (/diagnostic sub-agent testing ONE hypothesis/.test(sys)) {
      const noTools = (args.tool_choice as { type?: string })?.type === 'none'
      if (noTools) return txt(VERDICT)
      const rounds = (args.messages as Array<{ role: string }>).filter(m => m.role === 'assistant').length
      return rounds < 1 ? tool('query_prism', { instance_id: 'prism-1', operation: 'telemetry' }) : txt(VERDICT)
    }
    if (/writing the RCA conclusion/.test(sys)) return txt(SYNTH)
    return txt(PLAN)  // plan
  }
  return { messages: { create } } as never
}
const fakeExec = (async () => ({ ok: true, rows: [{ ts: '02:14', v1n: 280, mb_error: 1 }] })) as never
const CTX = { userId: 'u', userEmail: 'e', userRole: 'admin', model: 'fake', catalog: 'Prism: prism-1 (solar inverters)', allowedSources: [] as string[] }

async function main() {
  console.log('Deep Diagnose orchestrator')
  const events: Array<Record<string, unknown>> = []
  const res = await runDiagnose({ target: 'inverter GM01000041P', symptom: 'tripped overnight' }, CTX, e => events.push(e), { client: fakeClient(), exec: fakeExec })

  const plan = events.find(e => e.type === 'research_plan')
  ok('plan runs in diagnose mode with 3 hypotheses', plan?.mode === 'diagnose' && (plan?.subtasks as unknown[])?.length === 3)
  const subResults = events.filter(e => e.type === 'subagent_result')
  ok('each hypothesis gets a verdict + confidence parsed', subResults.length === 3 && subResults.every(e => e.verdict === 'supported' && e.confidence === 0.8))
  const doneEv = events.find(e => e.type === 'research_done')
  ok('research_done carries ranked causes (2) + checks (2) in diagnose mode', doneEv?.mode === 'diagnose' && (doneEv?.causes as unknown[])?.length === 2 && (doneEv?.checks as unknown[])?.length === 2)
  ok('top cause confidence parsed', (res.causes[0]?.confidence) === 0.8 && res.causes[0].cause.startsWith('Grid overvoltage'))
  ok('report is the prose, not the JSON block', res.report.startsWith('The most likely cause') && !res.report.includes('===CAUSES==='))
  ok('recommended checks returned', res.checks.length === 2 && res.checks[0].includes('AC terminals'))
  const order = events.map(e => e.type)
  ok('event order: started → plan → synthesizing → done', order.indexOf('research_started') === 0 && order.indexOf('research_plan') < order.indexOf('research_synthesizing') && order.indexOf('research_synthesizing') < order.indexOf('research_done'))

  console.log('\nstrictSources scope guard')
  const strict = await runTool('query_prism', { operation: 'telemetry' }, { userId: 'u', userEmail: 'e', userRole: 'admin', allowedSources: ['prism-1'], strictSources: true } as never) as Record<string, unknown>
  ok('strict: source tool with NO id is blocked when scoped', strict.out_of_scope === true)
  // Non-strict: the scope guard lets a no-id call through to execution (which
  // then fails here only because there is no DB — not a scope block).
  let looseBlocked = false
  try { const loose = await runTool('query_prism', { operation: 'telemetry' }, { userId: 'u', userEmail: 'e', userRole: 'admin', allowedSources: ['prism-1'] } as never) as Record<string, unknown>; looseBlocked = loose.out_of_scope === true } catch { looseBlocked = false }
  ok('non-strict: no-id call is NOT blocked by the scope guard (falls through)', !looseBlocked)

  console.log(`\n${pass}/${pass + fail} passed — ${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}`)
  process.exit(fail === 0 ? 0 : 1)
}
main().catch(e => { console.error(e); process.exit(2) })
