/**
 * Structured sub-agent finding (v1.3.53) tests — proves research sub-agents emit
 * a parseable headline + key-fact bullets (the ===FINDING=== trailer) so the
 * Research panel renders a structured card instead of a wall of prose, and that
 * a sub-agent that omits the trailer degrades gracefully to its raw summary.
 *
 *   npx tsx tests/research/finding.test.ts
 */
import { runResearch } from '@/lib/research'

let pass = 0, fail = 0
const ok = (n: string, c: boolean, d = '') => { console.log(`  [${c ? 'PASS' : 'FAIL'}] ${n}${d ? '  ' + d : ''}`); c ? pass++ : fail++ }

const txt = (t: string) => ({ content: [{ type: 'text', text: t }], stop_reason: 'end_turn' })
const toolUse = (name: string, input: unknown) => ({ content: [{ type: 'tool_use', id: 'tu' + Math.random(), name, input }], stop_reason: 'tool_use' })
const PLAN = '[{"title":"Players","brief":"map vendors"},{"title":"Pricing","brief":"find pricing"}]'

// Sub-agent that does ONE web_search (so it harvests a source) then finishes with
// the structured ===FINDING=== trailer.
const STRUCTURED = `SMA, Sungrow and Huawei dominate the EU residential inverter market with GDPR-compliant portals.
===FINDING===
{"headline":"SMA, Sungrow and Huawei lead the EU residential inverter market","bullets":["SMA Sunny Portal is GDPR-compliant","Sungrow iSolarCloud hosts data in Frankfurt","Huawei FusionSolar offers on-prem option"]}`
// Sub-agent that ignores the instruction and returns only prose (fallback path).
const PLAIN = 'Pricing ranges roughly 1,000 to 3,000 EUR per residential unit depending on vendor and capacity, with no standard public list.'

function fakeClient() {
  const create = async (args: Record<string, unknown>) => {
    const sys = String(args.system || '')
    if (/lead of a research team/.test(sys)) return txt(PLAN)
    if (/lead researcher writing the final briefing/.test(sys)) return txt('EU inverter landscape summary [1].')
    // sub-agent: first round does a search for the "Players" task, else finishes
    const userMsg = JSON.stringify((args.messages as Array<{ content: unknown }>)[0]?.content || '')
    const isPlayers = /map vendors/.test(userMsg)
    const rounds = (args.messages as Array<{ role: string }>).filter(m => m.role === 'assistant').length
    if (isPlayers) {
      if (rounds < 1) return toolUse('web_search', { query: 'EU residential inverter vendors' })
      return txt(STRUCTURED)
    }
    return txt(PLAIN)
  }
  return { messages: { create } } as never
}
// web_search returns a result carrying a {title,url} so harvestSources picks it up.
const fakeExec = (async (name: string) => name === 'web_search'
  ? { results: [{ title: 'SMA Sunny Portal', url: 'https://www.sma.de/en/products/monitoring-control' }] }
  : { ok: true }) as never

const CTX = { userId: 'u', userEmail: 'e', userRole: 'admin', model: 'fake', allowedSources: [] as string[] }

async function main() {
  console.log('Structured sub-agent finding')
  const events: Record<string, unknown>[] = []
  const res = await runResearch('Who are the EU residential inverter players and their pricing?', CTX, e => events.push(e), { client: fakeClient(), exec: fakeExec })

  const results = events.filter(e => e.type === 'subagent_result')
  ok('both sub-agents produced a result', results.length === 2)

  const structured = results.find(r => (r.title as string) === 'Players')
  ok('structured finding carries a one-line headline', typeof structured?.headline === 'string' && (structured!.headline as string).startsWith('SMA, Sungrow and Huawei'))
  ok('headline has no ===FINDING=== marker leaked in', !(structured?.headline as string)?.includes('==='))
  ok('bullets parsed as an array of key facts (3)', Array.isArray(structured?.bullets) && (structured!.bullets as string[]).length === 3)
  ok('bullets are short facts, not the whole blob', (structured!.bullets as string[]).every(b => b.length < 80))
  ok('summary (prose) kept for synthesis, trailer stripped', typeof structured?.summary === 'string' && !(structured!.summary as string).includes('===FINDING==='))
  ok('top source links emitted for chips', Array.isArray(structured?.links) && (structured!.links as Array<{ url: string }>)[0]?.url?.includes('sma.de'))

  const plain = results.find(r => (r.title as string) === 'Pricing')
  ok('sub-agent WITHOUT trailer falls back to raw summary (no headline)', plain?.headline === undefined && typeof plain?.summary === 'string' && (plain!.summary as string).startsWith('Pricing ranges'))
  ok('fallback sub-agent has no bullets', plain?.bullets === undefined)

  ok('final report still synthesised end-to-end', typeof res.report === 'string' && res.report.length > 0)

  console.log(`\n${pass}/${pass + fail} passed — ${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}`)
  process.exit(fail === 0 ? 0 : 1)
}
main().catch(e => { console.error(e); process.exit(2) })
