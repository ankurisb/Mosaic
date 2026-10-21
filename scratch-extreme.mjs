// Extreme test: dashboard readiness + entity-filter determinism (v1.3.125)
// Runs INSIDE the mosaic container: node resolves /app/node_modules, reads the real secret.
import { SignJWT } from 'jose'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const BASE = 'http://localhost:3000'
const ADMIN = { id: 'f60484e5-379e-4069-9af0-c561d6854d9d', email: 'trial-admin@ugx.ai', name: 'Trial Admin', role: 'admin' }

function getSecret() {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET
  const f = join(homedir(), '.mosaic', 'secret.key')
  if (existsSync(f)) return readFileSync(f, 'utf8').trim()
  throw new Error('no secret')
}
function secretKey() { const s = getSecret(); return new TextEncoder().encode(s.padEnd(32, s).slice(0, 64)) }
async function token() {
  return new SignJWT({ id: ADMIN.id, email: ADMIN.email, name: ADMIN.name, role: ADMIN.role })
    .setProtectedHeader({ alg: 'HS256' }).setExpirationTime('7d').setIssuedAt().sign(await secretKeyP)
}
const secretKeyP = Promise.resolve(secretKey())

// One chat turn → parse SSE → { text, tools:[{name,result}], proposal }
async function chat(messages) {
  const tok = await token()
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `claude_session=${tok}` },
    body: JSON.stringify({ messages, model: 'auto' }),
  })
  if (!res.ok) { const t = await res.text(); throw new Error(`HTTP ${res.status}: ${t.slice(0, 200)}`) }
  let buf = '', text = '', proposal = null; const tools = []
  const dec = new TextDecoder()
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true })
    let i
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 2)
      if (!line.startsWith('data: ')) continue
      let e; try { e = JSON.parse(line.slice(6)) } catch { continue }
      if (e.type === 'text') text += e.text || ''
      else if (e.type === 'tool_result') tools.push({ name: e.name, result: e.result })
      else if (e.type === 'dashboard_proposal') proposal = e.proposal
    }
  }
  return { text, tools, proposal }
}

// Multi-turn: send msgs; if no proposal and the model asked something, send `answer` and retry.
async function converse(scenario, firstUser, answer) {
  const history = [{ role: 'user', content: firstUser }]
  let r = await chat(history)
  let turns = 1
  if (!r.proposal && answer) {
    history.push({ role: 'assistant', content: r.text })
    history.push({ role: 'user', content: answer })
    r = await chat(history); turns = 2
  }
  return { ...r, turns }
}

function prismEntityOf(q) { try { const p = JSON.parse(q); return p.entity_id } catch { return '(unparseable)' } }
function hasBakedUuid(q) {
  // a real baked id would be a long hex/uuid-ish token, NOT the placeholder
  const e = (() => { try { return JSON.parse(q).entity_id } catch { return null } })()
  if (e == null) return false
  return e !== '{{entity_id}}' && /[0-9a-fA-F-]{6,}/.test(String(e))
}

function reportProposal(p) {
  if (!p) { console.log('   (no proposal emitted)'); return }
  console.log(`   proposal: "${p.title}"  readiness.allReady=${p.readiness ? p.readiness.allReady : 'n/a'} (${p.readiness ? p.readiness.readyCount + '/' + p.readiness.total : '?'})`)
  if (p.entity) console.log(`   entity binding: kind=${p.entity.kind} key=${p.entity.key_field} default=${JSON.stringify(p.entity.default)}`)
  for (const pn of p.panels) {
    const rd = pn.readiness ? (pn.readiness.ready ? 'READY' : 'NOT-READY') : '?'
    const eid = pn.source_type === 'prism' ? ` entity_id=${JSON.stringify(prismEntityOf(pn.query))}` : (/\{\{entity_id\}\}/.test(pn.query) ? ' {{entity_id}}✓' : '')
    const baked = pn.source_type === 'prism' && hasBakedUuid(pn.query) ? '  ⚠BAKED-DEVICE' : ''
    console.log(`     - [${pn.validation.cls}/${rd}] ${pn.title} (${pn.source_type})${eid}${baked}`)
    if (pn.readiness && !pn.readiness.ready) console.log(`         gaps: ${pn.readiness.gaps.join(' | ')}`)
  }
}

const SANDBOX_DB = '9eb9ddf6-d3f4-4687-b71d-3c770687ce8b'

async function main() {
  console.log('VERSION check:', await (await fetch(`${BASE}/api/deployment`, { headers: { Cookie: `claude_session=${await token()}` } }).then(r => r.json()).catch(() => ({}))).currentVersion || '(unknown)')

  // ── S1: PRISM entity, well-specified + discovery → must keep {{entity_id}}, real default, allReady, NO baked id
  console.log('\n═══ S1: PRISM entity-filter build (Ornate NTPC) ═══')
  {
    const r = await converse('S1',
      "Build a dashboard from the PRISM instance 'Ornate NTPC'. Pick ONE real device that has recent telemetry as the default, but make every panel switchable by device using the device filter (do not hard-code a device). Include two trend panels (active power and energy over time) and one current-value stat. Call it 'Power & Energy'.",
      "Use whichever device has the most recent data as the default, and wire up the device filter so I can switch.")
    console.log(`   turns=${r.turns}; assistant: ${r.text.slice(0, 180).replace(/\n/g, ' ')}`)
    reportProposal(r.proposal)
  }

  // ── S2: PRISM, NO device named → must NOT silently build pinned to a random device
  console.log('\n═══ S2: PRISM, ambiguous (no device) — must ask or block ═══')
  {
    const r = await chat([{ role: 'user', content: 'Show me energy trends from PRISM Ornate NTPC.' }])
    console.log(`   assistant: ${r.text.slice(0, 220).replace(/\n/g, ' ')}`)
    reportProposal(r.proposal)
  }

  // ── S3: SQL grounding — hallucinated column must block; real column ready
  console.log('\n═══ S3: SQL grounding (Sandbox DB) — hallucinated field blocked ═══')
  {
    const r = await chat([{ role: 'user', content:
      `From the Sandbox DB (built-in, id ${SANDBOX_DB}), build a dashboard with two line panels over shift_date from production_logs: (1) oee_pct, and (2) power_factor_pct. Build it now.` }])
    console.log(`   assistant: ${r.text.slice(0, 220).replace(/\n/g, ' ')}`)
    reportProposal(r.proposal)
  }

  // ── S4: multi-entity SQL without scope — does it recognize machine_id fleet? (source-agnostic determinism)
  console.log('\n═══ S4: multi-entity SQL (production_logs per machine) — must scope, not mix ═══')
  {
    const r = await chat([{ role: 'user', content:
      `From the Sandbox DB (id ${SANDBOX_DB}), plot cycle_time_s over shift_date from production_logs as a line chart. Build it now.` }])
    console.log(`   assistant: ${r.text.slice(0, 260).replace(/\n/g, ' ')}`)
    reportProposal(r.proposal)
  }

  console.log('\n═══ DONE ═══')
}
main().catch(e => { console.error('FATAL', e); process.exit(1) })
