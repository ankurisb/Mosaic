/**
 * Workspace snapshot (v1.3.55) tests — proves runResearch / runDiagnose return a
 * serialisable `workspace` snapshot that the chat route persists on the assistant
 * message, so the Research/Diagnosis panel can be REOPENED later (and after a
 * reload) instead of being lost when it's closed.
 *
 *   npx tsx tests/research/workspace.test.ts
 */
import { runResearch } from '@/lib/research'
import { runDiagnose } from '@/lib/diagnose'

let pass = 0, fail = 0
const ok = (n: string, c: boolean, d = '') => { console.log(`  [${c ? 'PASS' : 'FAIL'}] ${n}${d ? '  ' + d : ''}`); c ? pass++ : fail++ }

const txt = (t: string) => ({ content: [{ type: 'text', text: t }], stop_reason: 'end_turn' })
const toolUse = (name: string, input: unknown) => ({ content: [{ type: 'tool_use', id: 'tu' + Math.random(), name, input }], stop_reason: 'tool_use' })

async function main() {
  console.log('Research workspace snapshot')
  {
    const PLAN = '[{"title":"Players","brief":"map vendors"},{"title":"Pricing","brief":"find pricing"}]'
    const STRUCT = `SMA and Sungrow lead.\n===FINDING===\n{"headline":"SMA and Sungrow lead the EU market","bullets":["SMA ~20% share","Sungrow strong in utility"]}`
    const client = { messages: { create: async (a: Record<string, unknown>) => {
      const s = String(a.system || '')
      if (/lead of a research team/.test(s)) return txt(PLAN)
      if (/lead researcher writing the final briefing/.test(s)) return txt('Briefing [1].')
      const isPlayers = /map vendors/.test(JSON.stringify((a.messages as Array<{ content: unknown }>)[0]?.content || ''))
      const rounds = (a.messages as Array<{ role: string }>).filter(m => m.role === 'assistant').length
      if (isPlayers && rounds < 1) return toolUse('web_search', { query: 'x' })
      return txt(STRUCT)
    } } } as never
    const exec = (async (n: string) => n === 'web_search' ? { results: [{ title: 'SMA', url: 'https://sma.de/x' }] } : { ok: true }) as never
    const res = await runResearch('EU inverter landscape?', { userId: 'u', userEmail: 'e', userRole: 'admin', model: 'fake', allowedSources: [] }, () => {}, { client, exec })
    const ws = res.workspace
    ok('research returns a workspace snapshot', !!ws)
    ok('workspace mode = research', ws.mode === 'research')
    ok('workspace phase is terminal (done)', ws.phase === 'done')
    ok('workspace has one subtask per sub-agent (2)', ws.subtasks.length === 2 && ws.subagentCount === 2)
    ok('each subtask carries id + title + done status', ws.subtasks.every(s => s.id && s.title && s.status === 'done'))
    const players = ws.subtasks.find(s => s.title === 'Players')
    ok('structured finding preserved in snapshot (headline + bullets)', players?.headline?.startsWith('SMA and Sungrow') === true && (players?.bullets?.length ?? 0) === 2)
    ok('top source links preserved for the reopened chips', (players?.links?.[0] as { url?: string })?.url?.includes('sma.de') === true)
    ok('sourceCount recorded', typeof ws.sourceCount === 'number' && ws.sourceCount >= 1)
    ok('snapshot is JSON-serialisable (persistable)', (() => { try { JSON.parse(JSON.stringify(ws)); return true } catch { return false } })())
  }

  console.log('\nDiagnosis workspace snapshot')
  {
    const PLAN = '[{"title":"Overvoltage","hypothesis":"grid spike","how_to_test":"v1n"},{"title":"Loose DC","hypothesis":"bad conn","how_to_test":"dc"}]'
    const VERDICT = 'Spike found.\n===VERDICT===\n{"verdict":"supported","confidence":0.8,"evidence":["v1n 280V at 02:14"]}'
    const SYNTH = 'Grid overvoltage.\n===CAUSES===\n{"causes":[{"cause":"Grid overvoltage tripped inverter","confidence":0.8,"evidence":["v1n 280V"]}],"checks":["Inspect AC terminals"]}'
    const client = { messages: { create: async (a: Record<string, unknown>) => {
      const s = String(a.system || '')
      if (/diagnostic sub-agent testing ONE hypothesis/.test(s)) return txt(VERDICT)
      if (/writing the RCA conclusion/.test(s)) return txt(SYNTH)
      return txt(PLAN)
    } } } as never
    const exec = (async () => ({ ok: true, rows: [{ v1n: 280 }] })) as never
    const res = await runDiagnose({ target: 'INV-01', symptom: 'tripped' }, { userId: 'u', userEmail: 'e', userRole: 'admin', model: 'fake', allowedSources: [], catalog: 'Prism: p1' }, () => {}, { client, exec })
    const ws = res.workspace
    ok('diagnose returns a workspace snapshot', !!ws)
    ok('workspace mode = diagnose', ws.mode === 'diagnose')
    ok('workspace has one subtask per hypothesis (2)', ws.subtasks.length === 2)
    ok('each hypothesis subtask carries verdict + confidence', ws.subtasks.every(s => s.verdict === 'supported' && s.confidence === 0.8))
    ok('ranked causes carried in snapshot', (ws.causes?.length ?? 0) === 1 && ws.causes?.[0].cause.startsWith('Grid overvoltage') === true)
    ok('recommended checks carried in snapshot', (ws.checks?.length ?? 0) === 1 && ws.checks?.[0].includes('AC terminals') === true)
    ok('snapshot is JSON-serialisable (persistable)', (() => { try { JSON.parse(JSON.stringify(ws)); return true } catch { return false } })())
  }

  console.log(`\n${pass}/${pass + fail} passed — ${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}`)
  process.exit(fail === 0 ? 0 : 1)
}
main().catch(e => { console.error(e); process.exit(2) })
