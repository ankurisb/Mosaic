/**
 * Extreme test for the render_map tool (lib/tools.ts) — the contract between the
 * model and the map renderer. Validates coordinate parsing/filtering, caps,
 * zoom/center handling, and field passthrough.
 *
 *   tsx tests/map/render_map.test.ts
 */
import { runTool } from '@/lib/tools'

const CTX = { userId: 'u', userEmail: 'e@x', userRole: 'admin' } as const
const run = (input: Record<string, unknown>) => runTool('render_map', input, CTX as never) as Promise<Record<string, unknown>>

let pass = 0, fail = 0
const ok = (n: string, c: boolean, d = '') => { console.log(`  [${c ? 'PASS' : 'FAIL'}] ${n}${d ? '  ' + d : ''}`); c ? pass++ : fail++ }

async function main() {
  // 1. valid
  const a = await run({ title: 'Sites', points: [{ lat: 17.4, lng: 78.4, label: 'A', detail: 'd', value: 5 }, { lat: 51.5, lng: -0.12, label: 'London' }] })
  ok('valid → map_artifact', a.kind === 'map_artifact' && (a.points as unknown[]).length === 2 && a.title === 'Sites')

  // 2/3/4. error cases
  ok('empty points → error', !!(await run({ points: [] })).error)
  ok('non-array points → error', !!(await run({ points: 'nope' })).error)
  ok('all-invalid points → error', !!(await run({ points: [{ lat: 999, lng: 0 }, { lat: 'x', lng: 'y' }] })).error)

  // 5. mixed valid/invalid — every invalid shape dropped, valid kept
  const mix = await run({ points: [
    { lat: 10, lng: 20, label: 'keep1' },
    { lat: 91, lng: 0 },           // lat out of range
    { lat: 0, lng: 181 },          // lng out of range
    { lat: NaN, lng: 5 },          // NaN
    { lat: null, lng: 5 },         // null -> must NOT become 0
    { lat: undefined, lng: 5 },    // undefined
    { lat: '', lng: 5 },           // empty string
    { lat: true, lng: 5 },         // boolean
    { lat: {}, lng: 5 },           // object
    { lat: '-33.86', lng: '151.2', label: 'numeric-string' }, // numeric strings OK
    { lat: -10, lng: -20, label: 'keep2' },
  ] })
  const mp = mix.points as Array<{ lat: number; lng: number; label?: string }>
  ok('invalid shapes dropped, numeric strings kept', mix.kind === 'map_artifact' && mp.length === 3 && mp.every(p => Number.isFinite(p.lat) && Number.isFinite(p.lng)), `n=${mp?.length}`)
  ok('null coord NOT coerced to 0', !mp.some(p => p.lat === 0 && p.lng === 5))

  // 6/7. boundary coords
  const bnd = await run({ points: [{ lat: 90, lng: 180 }, { lat: -90, lng: -180 }] })
  ok('exact boundary coords accepted', (bnd.points as unknown[]).length === 2)
  const over = await run({ points: [{ lat: 90.0001, lng: 0 }, { lat: 0, lng: 180.0001 }] })
  ok('just-over boundary rejected', !!over.error)

  // 8. cap at 2000
  const many = await run({ points: Array.from({ length: 2600 }, (_, i) => ({ lat: (i % 80) - 40, lng: (i % 160) - 80 })) })
  ok('points capped at 2000', (many.points as unknown[]).length === 2000)

  // 9. zoom clamp
  ok('zoom > 18 clamped to 18', (await run({ points: [{ lat: 1, lng: 2 }], zoom: 99 })).zoom === 18)
  ok('zoom < 1 clamped to 1', (await run({ points: [{ lat: 1, lng: 2 }], zoom: 0 })).zoom === 1)
  ok('non-numeric zoom ignored', (await run({ points: [{ lat: 1, lng: 2 }], zoom: 'big' })).zoom === undefined)

  // 10. center
  const ctr = await run({ points: [{ lat: 1, lng: 2 }], center: { lat: 10, lng: 20 } })
  ok('valid center kept', (ctr.center as { lat: number }).lat === 10)
  ok('invalid center dropped', (await run({ points: [{ lat: 1, lng: 2 }], center: { lat: 'x', lng: 2 } })).center === undefined)

  // 11. field passthrough + coercion
  const f = await run({ points: [{ lat: 1, lng: 2, label: 42, detail: 'ok', value: 'high' }] })
  const p0 = (f.points as Array<{ label?: string; detail?: string; value?: unknown }>)[0]
  ok('label coerced to string, detail/value passed through', p0.label === '42' && p0.detail === 'ok' && p0.value === 'high')
  const f2 = await run({ points: [{ lat: 1, lng: 2, value: 3.14, label: 'x' }] })
  ok('numeric value preserved as number', (f2.points as Array<{ value?: unknown }>)[0].value === 3.14)

  console.log(`\n${pass}/${pass + fail} passed — ${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}`)
  process.exit(fail === 0 ? 0 : 1)
}
main().catch(e => { console.error(e); process.exit(2) })
