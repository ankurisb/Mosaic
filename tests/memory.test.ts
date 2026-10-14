/**
 * Extreme test suite for cross-conversation memory (Phase 1, lib/memory.ts).
 * Drives the REAL module against a throwaway SQLite DB — no mocks — covering
 * the privacy filter matrix, per-user isolation, caps, de-dupe, update/forget/
 * delete, and system-prompt formatting.
 *
 * Run:  DATABASE_URL=sqlite:///tmp/m.db tsx tests/memory.test.ts
 * (the npm wrapper / CI sets up a temp DB). Exit non-zero on any failure.
 */
import { getDb } from '@/lib/db'
import {
  saveMemory, listMemory, updateMemory, deleteMemory, forgetMemory,
  formatMemoryForPrompt, looksSensitive,
} from '@/lib/memory'

let pass = 0, fail = 0
const ok = (name: string, cond: boolean, detail = '') => {
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${name}${detail ? '  ' + detail : ''}`)
  cond ? pass++ : fail++
}
const section = (s: string) => console.log(`\n${s}`)

async function ensureSchema() {
  const sql = getDb()
  await sql`CREATE TABLE IF NOT EXISTS user_memory (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, project TEXT,
    category TEXT NOT NULL DEFAULT 'fact', content TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'chat',
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`
}

async function main() {
  await ensureSchema()

  // ── 1. Basic save / list / category / project ──────────────────────
  section('1. Save / list / category / project')
  const r1 = await saveMemory({ userId: 'u1', content: 'prefers concise, technically precise answers', category: 'preference' })
  ok('save preference returns id', r1.ok && !!r1.id)
  await saveMemory({ userId: 'u1', content: 'calls the pyranometer slr_rdtn', category: 'fact', project: 'prism' })
  await saveMemory({ userId: 'u1', content: 'OEE target for Line A is 85%', category: 'project', project: 'plant-ops' })
  const l1 = await listMemory('u1')
  ok('three memories listed', l1.length === 3, `n=${l1.length}`)
  ok('project tag stored', l1.some(m => m.project === 'prism'))
  const badCat = await saveMemory({ userId: 'u1', content: 'uses metric units', category: 'nonsense' })
  ok('invalid category normalised to fact', badCat.ok && (await listMemory('u1')).find(m => m.content === 'uses metric units')?.category === 'fact')

  // ── 2. Validation: empty + length cap ──────────────────────────────
  section('2. Validation')
  ok('empty content rejected', (await saveMemory({ userId: 'u1', content: '   ' })).ok === false)
  const long = 'x'.repeat(900)
  const rl = await saveMemory({ userId: 'u1', content: long })
  const stored = (await listMemory('u1')).find(m => m.content.startsWith('xxxx'))
  ok('content capped at 500 chars', rl.ok && !!stored && stored!.content.length === 500, `len=${stored?.content.length}`)

  // ── 3. De-dupe (per user) ──────────────────────────────────────────
  section('3. De-dupe')
  const before = (await listMemory('u1')).length
  const dup = await saveMemory({ userId: 'u1', content: 'prefers concise, technically precise answers' })
  ok('exact duplicate not re-inserted', dup.ok && (await listMemory('u1')).length === before)
  await saveMemory({ userId: 'u2', content: 'prefers concise, technically precise answers' })
  ok('same content allowed for a different user', (await listMemory('u2')).length === 1)

  // ── 4. Privacy filter matrix ───────────────────────────────────────
  section('4. Privacy filter — must REJECT')
  const mustReject = [
    'my password is hunter2', 'the passphrase is swordfish',
    'api_key = sk-abc123', 'api key: 12345', 'secret key is xyz',
    'access token abcdef', 'use bearer eyJhbGciOiJIUzI1NiIsInR5cCI6',
    'my ssn is 123-45-6789', 'national insurance QQ123456C',
    'credit card 4111 1111 1111 1111', 'card number 4111111111111111',
    'cvv 123', 'routing number 021000021', 'IBAN GB33BUKB20201555555555',
    'sort code 12-34-56', 'account 4532015112830366',
    'patient was diagnosed with hypertension', 'his medical condition is chronic',
    'prescription for metformin', 'struggles with mental health',
  ]
  let rejected = 0
  for (const c of mustReject) { if (looksSensitive(c)) rejected++; else console.log(`     missed: ${c}`) }
  ok(`all ${mustReject.length} sensitive inputs flagged`, rejected === mustReject.length, `${rejected}/${mustReject.length}`)
  ok('saveMemory refuses sensitive content', (await saveMemory({ userId: 'u1', content: 'my password is hunter2' })).ok === false)

  section('5. Privacy filter — must ALLOW (no over-blocking of normal facts)')
  const mustAllow = [
    'prefers dark mode and concise answers', 'works on the Prism IoT platform',
    'OEE target for Line A is 85%', 'uses metric units (kWh, °C)',
    'reports go to the finance team each quarter', 'the devfactory API has 739 operations',
    'calls the inverter GM01000050P', 'wants charts as PNG not inline',
    'default date range is last 30 days', 'the plant is in Telangana',
  ]
  let allowed = 0
  for (const c of mustAllow) { if (!looksSensitive(c)) allowed++; else console.log(`     over-blocked: ${c}`) }
  ok(`all ${mustAllow.length} normal facts allowed`, allowed === mustAllow.length, `${allowed}/${mustAllow.length}`)

  // ── 6. Per-user isolation ──────────────────────────────────────────
  section('6. Per-user isolation')
  const u1list = await listMemory('u1')
  ok('u1 list has no u2 rows', u1list.every(m => m.user_id === 'u1'))
  const u2row = (await listMemory('u2'))[0]
  ok('cross-user update refused', (await updateMemory(u2row.id, 'u1', { content: 'hacked' })) === false)
  ok('cross-user delete refused', (await deleteMemory(u2row.id, 'u1')) === false)
  ok('u2 row intact after cross-user attempts', (await listMemory('u2')).length === 1)
  const forgotOther = await forgetMemory('u1', 'concise')  // u2 also has a 'concise' row
  ok('forget only affects own rows', (await listMemory('u2')).some(m => m.content.includes('concise')), `removed from u1=${forgotOther}`)

  // ── 7. Update (read-modify-write, partial) ─────────────────────────
  section('7. Update')
  const target = (await listMemory('u1')).find(m => m.content.includes('pyranometer'))!
  ok('edit content', await updateMemory(target.id, 'u1', { content: 'calls the pyranometer the irradiance sensor' }))
  const after = (await listMemory('u1')).find(m => m.id === target.id)!
  ok('content changed, category preserved (partial update)', after.content.includes('irradiance') && after.category === 'fact', `cat=${after.category}`)
  ok('change category only, content preserved', await updateMemory(target.id, 'u1', { category: 'project' }) && (await listMemory('u1')).find(m => m.id === target.id)!.content.includes('irradiance'))
  ok('update to sensitive content refused', (await updateMemory(target.id, 'u1', { content: 'password is 1234' })) === false)

  // ── 8. Forget / delete ─────────────────────────────────────────────
  section('8. Forget / delete')
  await saveMemory({ userId: 'u3', content: 'alpha one' })
  await saveMemory({ userId: 'u3', content: 'alpha two' })
  await saveMemory({ userId: 'u3', content: 'beta three' })
  ok('forget by case-insensitive substring removes all matches', (await forgetMemory('u3', 'ALPHA')) === 2 && (await listMemory('u3')).length === 1)
  ok('forget with no match returns 0', (await forgetMemory('u3', 'zzz')) === 0)
  const del = (await listMemory('u3'))[0]
  ok('delete own row', await deleteMemory(del.id, 'u3') && (await listMemory('u3')).length === 0)
  ok('delete nonexistent returns false', (await deleteMemory('does-not-exist', 'u3')) === false)

  // ── 9. formatMemoryForPrompt ───────────────────────────────────────
  section('9. System-prompt formatting')
  ok('empty user yields empty block', (await formatMemoryForPrompt('nobody')) === '')
  const block = await formatMemoryForPrompt('u1')
  ok('block has header', block.includes('What you remember about this user'))
  ok('block groups by category label', /Preferences:|Facts:|Project context:/.test(block))
  ok('block includes a project tag', block.includes('[plant-ops]') || block.includes('[prism]'))
  ok('block isolated to user (no u3 content)', !block.includes('alpha') && !block.includes('beta'))

  // cap test: stuff a user with lots of long entries, ensure block is bounded
  for (let i = 0; i < 60; i++) await saveMemory({ userId: 'ucap', content: `fact number ${i} ` + 'y'.repeat(80) })
  const capBlock = await formatMemoryForPrompt('ucap')
  ok('prompt block bounded (~<=2800 chars)', capBlock.length <= 2800, `len=${capBlock.length}`)
  ok('bounded block signals truncation', capBlock.includes('more in Settings'))

  // ── 10. Per-user entry cap (200) ───────────────────────────────────
  section('10. Per-user entry cap')
  // ucap already has 60; add to reach 200 then expect refusal at 201.
  for (let i = 60; i < 200; i++) await saveMemory({ userId: 'ucap', content: `cap filler ${i}` })
  const n = (await listMemory('ucap')).length
  const over = await saveMemory({ userId: 'ucap', content: 'one too many' })
  ok('201st save refused when full', n === 200 && over.ok === false && /full/.test(over.reason || ''), `n=${n}`)

  console.log(`\n${pass}/${pass + fail} passed — ${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(e => { console.error(e); process.exit(2) })
