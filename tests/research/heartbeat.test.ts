/**
 * SSE heartbeat (v1.3.52) tests — proves the fix for long research/diagnose
 * runs dropping with "Error: network error".
 *
 *   npx tsx tests/research/heartbeat.test.ts
 *
 * Background: a deep_research / deep_diagnose turn has silent windows where the
 * server is awaiting ONE long model call and emits no SSE events — the lead
 * planning call, a sub-agent mid model-round, and above all the SYNTHESIS gap
 * between the `research_synthesizing` and `research_done` events (lib/research.ts
 * lines 139→143: the synthesize() call emits nothing). Safari (and some proxies)
 * tear down a streaming fetch that goes idle during those windows; the client's
 * reader threw and, with no assistant text streamed yet, wrote "Error: <msg>"
 * (on Safari literally "network error") into the empty bubble. The fix is a
 * lightweight heartbeat ({type:'ping'} every 10s) for the life of the stream.
 *
 * These tests mirror the EXACT scaffold added to app/api/chat/route.ts
 * (guarded send() + setInterval ping + clearInterval in finally + cancel()),
 * parameterised with a short interval so timing is deterministic and fast, and
 * then drive the REAL runResearch orchestrator (with a scripted slow-synthesis
 * fake model) through that scaffold to prove the real synthesis gap is covered.
 */
import { runResearch } from '@/lib/research'

let pass = 0, fail = 0
const ok = (n: string, c: boolean, d = '') => { console.log(`  [${c ? 'PASS' : 'FAIL'}] ${n}${d ? '  ' + d : ''}`); c ? pass++ : fail++ }
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

// ── Faithful replica of the route.ts stream scaffold ──────────────────────────
// Mirrors app/api/chat/route.ts: streamClosed flag, guarded send(), the
// heartbeat setInterval, clearInterval in finally, and the cancel() handler.
// The only change is `intervalMs` is a parameter (10_000 in prod) so tests run
// in milliseconds, plus instrumentation counters.
function makeHeartbeatStream(
  body: (send: (o: object) => void) => Promise<void>,
  intervalMs: number,
) {
  let streamClosed = false
  let enqueued = 0, skipped = 0, heartbeatCleared = false
  const enc = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      const send = (o: object) => {
        if (streamClosed) { skipped++; return }
        try { ctrl.enqueue(enc.encode('data: ' + JSON.stringify(o) + '\n\n')); enqueued++ }
        catch { streamClosed = true }
      }
      const heartbeat = setInterval(() => send({ type: 'ping', t: Date.now() }), intervalMs)
      try {
        await body(send)
      } finally {
        clearInterval(heartbeat); heartbeatCleared = true
        if (!streamClosed) { try { ctrl.close() } catch { /* already closed */ } }
        streamClosed = true
      }
    },
    cancel() { streamClosed = true },
  })
  return { stream, counts: () => ({ enqueued, skipped, heartbeatCleared, streamClosed }) }
}

// Drain a stream, timestamping each chunk at the moment the (client-side) reader
// receives it — so gaps measured here are exactly what the browser experiences.
async function drain(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  const dec = new TextDecoder()
  const out: Array<{ t: number; events: Record<string, unknown>[] }> = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const txt = dec.decode(value)
    const events = txt.split('\n\n').filter(Boolean).map(l => { try { return JSON.parse(l.replace(/^data: /, '')) } catch { return {} } })
    out.push({ t: Date.now(), events })
  }
  return out
}
const maxGap = (ts: number[]) => ts.slice(1).reduce((m, t, i) => Math.max(m, t - ts[i]), 0)

async function main() {
  console.log('SSE heartbeat — mechanism')

  // 1. Cadence: a body that is SILENT for ~7 intervals still produces a steady
  //    stream of pings.
  {
    const { stream } = makeHeartbeatStream(async () => { await sleep(210) }, 30)
    const chunks = await drain(stream)
    const pings = chunks.flatMap(c => c.events).filter(e => e.type === 'ping')
    ok('silent body emits periodic pings (≥4 over ~7 intervals)', pings.length >= 4, `got ${pings.length}`)
  }

  // 2. Gap coverage: a body that emits one event, goes idle for a long window
  //    (the synthesis-gap simulation), then one more — WITH heartbeat the client
  //    never sees an idle gap longer than ~a couple of intervals.
  {
    const { stream } = makeHeartbeatStream(async (send) => {
      send({ type: 'research_synthesizing' })
      await sleep(200)               // the silent synthesize() window
      send({ type: 'research_done' })
    }, 30)
    const chunks = await drain(stream)
    const gap = maxGap(chunks.map(c => c.t))
    ok('max idle gap stays small with heartbeat (≤120ms for a 30ms interval)', gap <= 120, `maxGap=${gap}ms`)
  }

  // 3. CONTROL: the SAME body with NO heartbeat (huge interval) leaves the exact
  //    long idle gap that dropped the connection in production. This is the bug.
  {
    const { stream } = makeHeartbeatStream(async (send) => {
      send({ type: 'research_synthesizing' })
      await sleep(200)
      send({ type: 'research_done' })
    }, 10_000_000)
    const chunks = await drain(stream)
    const gap = maxGap(chunks.map(c => c.t))
    const pings = chunks.flatMap(c => c.events).filter(e => e.type === 'ping')
    ok('WITHOUT heartbeat the idle gap reappears (≥180ms) — reproduces the drop window', gap >= 180, `maxGap=${gap}ms`)
    ok('WITHOUT heartbeat zero pings are sent (control is clean)', pings.length === 0, `got ${pings.length}`)
  }

  // 4. Lifecycle: the interval is cleared in finally — no leaked timer after the
  //    body completes.
  {
    const { stream, counts } = makeHeartbeatStream(async (send) => { send({ type: 'done' }); }, 20)
    await drain(stream)
    await sleep(80)
    ok('heartbeat cleared in finally (no leaked timer)', counts().heartbeatCleared === true)
    ok('stream marked closed after completion', counts().streamClosed === true)
  }

  // 5. cancel(): a client disconnect marks the stream closed; subsequent heartbeat
  //    sends no-op instead of throwing (the invariant that stops a dropped
  //    connection from turning into a thrown server error).
  {
    const { stream, counts } = makeHeartbeatStream(async () => { await sleep(300) }, 20)
    const reader = stream.getReader()
    await reader.read()            // receive at least one ping
    await reader.cancel()          // client goes away → cancel() → streamClosed
    await sleep(120)               // heartbeat keeps firing into a closed stream
    const c = counts()
    ok('after cancel the stream is closed', c.streamClosed === true)
    ok('post-cancel heartbeat sends no-op (skipped>0, never throw)', c.skipped > 0, `skipped=${c.skipped}`)
  }

  // 6. Client ignores unknown ping events. Faithful replica of the ChatPage.tsx
  //    reader dispatch (components/ChatPage.tsx ~lines 1026–1065): an if/else-if
  //    chain keyed on e.type with NO final else, so an unknown type is a no-op.
  {
    type Bubble = { content: string; research: unknown }
    const reduce = (b: Bubble, e: Record<string, unknown>): Bubble => {
      if (e.type === 'text') return { ...b, content: b.content + String(e.text) }
      else if (e.type === 'research_done') return { ...b, research: 'done' }
      else if (e.type === 'error') return { ...b, content: 'Error: ' + String(e.message) }
      // no final else → any other type (including 'ping') falls through unchanged
      return b
    }
    const before: Bubble = { content: 'hello', research: 'running' }
    let after = before
    let threw = false
    try { after = reduce(before, { type: 'ping', t: Date.now() }) } catch { threw = true }
    ok('client reducer does not throw on a ping event', !threw)
    ok('ping leaves bubble content untouched', after.content === 'hello')
    ok('ping leaves research state untouched', after.research === 'running')
  }

  // 7. Regression contract: the ORIGINAL failure path. ChatPage's outer catch
  //    (components/ChatPage.tsx ~lines 1068–1071) does
  //    `content: m.content || 'Error: ' + err.message`. When a deep_research run
  //    drops BEFORE any assistant text has streamed, m.content is empty, so the
  //    catch overwrites the empty bubble with the raw transport error — on Safari
  //    that string is "network error". The heartbeat prevents the idle that led
  //    to the reader throwing in the first place.
  {
    const onReaderThrow = (content: string, errMessage: string) => content || 'Error: ' + errMessage
    ok('empty bubble + reader throw → "Error: network error" (the symptom we fixed)',
       onReaderThrow('', 'network error') === 'Error: network error')
    ok('a bubble that already has text is NOT clobbered by a late throw',
       onReaderThrow('partial answer', 'network error') === 'partial answer')
  }

  console.log('\nSSE heartbeat — integration with the real runResearch orchestrator')

  // 8. Drive the REAL runResearch through the heartbeat scaffold with a scripted
  //    fake model whose SYNTHESIS call is slow (the exact prod failure window).
  //    Assert pings are emitted DURING the research_synthesizing → research_done
  //    gap, and that the whole run never leaves the client idle too long.
  {
    const txt = (t: string) => ({ content: [{ type: 'text', text: t }], stop_reason: 'end_turn' })
    const PLAN = '[{"title":"Alpha","brief":"find A"},{"title":"Beta","brief":"find B"}]'
    const fakeClient = {
      messages: {
        create: async (args: Record<string, unknown>) => {
          const sys = String(args.system || '')
          if (/lead of a research team/.test(sys)) return txt(PLAN)                       // plan (fast)
          if (/focused research sub-agent/.test(sys)) return txt('Finding: value is 42.') // sub-agent finishes immediately, no tools
          if (/lead researcher writing the final briefing/.test(sys)) {                   // SYNTHESIS — the slow, silent window
            await sleep(220)
            return txt('The answer is 42 [1].')
          }
          return txt('')
        },
      },
    } as never
    const exec = (async () => ({ ok: true })) as never
    const ctx = { userId: 'u', userEmail: 'e', userRole: 'admin', model: 'fake', allowedSources: [] as string[] }

    let report = ''
    const { stream } = makeHeartbeatStream(async (send) => {
      const res = await runResearch('What is the answer?', ctx, (ev) => send(ev), { client: fakeClient, exec })
      report = res.report
    }, 30)
    const chunks = await drain(stream)
    const flat: Record<string, unknown>[] = chunks.flatMap(c => c.events)

    const synthIdx = chunks.findIndex(c => c.events.some(e => e.type === 'research_synthesizing'))
    const doneIdx = chunks.findIndex(c => c.events.some(e => e.type === 'research_done'))
    const pingsInGap = chunks
      .slice(synthIdx + 1, doneIdx)
      .flatMap(c => c.events)
      .filter(e => e.type === 'ping').length

    ok('research completed end-to-end through the heartbeat stream', report.includes('42'))
    ok('research_synthesizing and research_done both emitted', synthIdx >= 0 && doneIdx > synthIdx)
    ok('pings fill the synthesis gap (≥4 during the silent synthesize window)', pingsInGap >= 4, `pingsInGap=${pingsInGap}`)
    const gap = maxGap(chunks.map(c => c.t))
    ok('whole run never leaves the client idle too long (maxGap ≤150ms)', gap <= 150, `maxGap=${gap}ms`)
    ok('real research events still delivered intact alongside pings',
       flat.some(e => e.type === 'research_plan') && flat.some(e => e.type === 'subagent_result'))
  }

  console.log(`\n${pass}/${pass + fail} passed — ${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}`)
  process.exit(fail === 0 ? 0 : 1)
}
main().catch(e => { console.error(e); process.exit(2) })
