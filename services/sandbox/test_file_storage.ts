/**
 * App-side storage + access-control tests for run_code output files.
 *
 * Drives the REAL lib/generated-files.ts module against a throwaway SQLite DB,
 * so the security-critical behaviour is exercised as it runs in production:
 *   - owner isolation: a user cannot read another user's file
 *   - admin override: an admin can read any file
 *   - expiry: an expired file is never returned
 *   - at-rest safety: bytes are stored under a hashed name (never the
 *     user-supplied filename), and the stored display name is basename-only
 *   - prune removes expired rows + bytes
 *
 * Run:  DATABASE_URL=sqlite:///tmp/xxx.db MOSAIC_FILE_DIR=/tmp/xxx tsx test_file_storage.ts
 * (the npm script sets these up in a temp dir and tears them down)
 */
import { getDb } from '@/lib/db'
import {
  saveGeneratedFile, getGeneratedFileForUser, readGeneratedFileBytes,
  pruneExpiredGeneratedFiles,
} from '@/lib/generated-files'
import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import path from 'path'

let pass = 0, fail = 0
const log = (ok: boolean, name: string, detail = '') => {
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? '  ' + detail : ''}`)
  ok ? pass++ : fail++
}

async function main() {
  const sql = getDb()
  // Minimal schema matching migration 015 / setup baseline.
  await sql`CREATE TABLE IF NOT EXISTS generated_files (
    id TEXT PRIMARY KEY, conversation_id TEXT, user_id TEXT, name TEXT NOT NULL,
    mime TEXT NOT NULL, size INTEGER NOT NULL, path TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), expires_at TEXT )`

  const FILE_DIR = process.env.MOSAIC_FILE_DIR as string

  console.log('App-side file storage + access control\n')

  // 1. Save a file for user "alice"
  const bytes = Buffer.from('machine,oee\nM1,0.82\n')
  const meta = await saveGeneratedFile({
    conversationId: 'conv1', userId: 'alice', name: 'oee.csv', mime: 'text/csv', bytes,
  })
  log(!!meta.id && meta.name === 'oee.csv' && meta.size === bytes.length,
    'saveGeneratedFile returns id + meta', `id=${meta.id.slice(0, 8)} size=${meta.size}`)

  // 2. Bytes are stored under a hashed basename, never the user's filename
  const rowRaw = (await sql`SELECT path FROM generated_files WHERE id = ${meta.id}`)[0] as { path: string }
  const diskBase = path.basename(rowRaw.path)
  const expectedHash = createHash('sha256').update(meta.id).digest('hex').slice(0, 32)
  const onDisk = await fs.readdir(FILE_DIR)
  log(diskBase === expectedHash && !diskBase.includes('oee') && onDisk.includes(expectedHash),
    'bytes stored under sha256(id), not user filename', `disk=${diskBase}`)

  // 3. Owner can read own file
  const asOwner = await getGeneratedFileForUser(meta.id, 'alice', 'user')
  log(!!asOwner && asOwner.user_id === 'alice', 'owner can read own file')

  // 4. Another non-admin user CANNOT read it
  const asOther = await getGeneratedFileForUser(meta.id, 'mallory', 'user')
  log(asOther === null, 'different user is denied (owner isolation)')

  // 5. Admin CAN read any file
  const asAdmin = await getGeneratedFileForUser(meta.id, 'mallory', 'admin')
  log(!!asAdmin && asAdmin.id === meta.id, 'admin override can read any file')

  // 6. Bytes round-trip correctly
  const back = asOwner ? await readGeneratedFileBytes(asOwner) : Buffer.alloc(0)
  log(back.equals(bytes), 'readGeneratedFileBytes round-trips exactly', `${back.length}B`)

  // 7. Display name is basename-sanitised (defence against stored traversal)
  const evil = await saveGeneratedFile({
    userId: 'alice', name: '../../etc/passwd', mime: 'text/plain', bytes: Buffer.from('x'),
  })
  log(evil.name === 'passwd', 'stored display name stripped to basename', `name=${evil.name}`)

  // 8. Expired file is never returned, then prune removes it
  const past = new Date(Date.now() - 86400_000).toISOString()
  const exp = await saveGeneratedFile({ userId: 'alice', name: 'old.txt', mime: 'text/plain', bytes: Buffer.from('old') })
  await sql`UPDATE generated_files SET expires_at = ${past} WHERE id = ${exp.id}`
  const expiredRead = await getGeneratedFileForUser(exp.id, 'alice', 'user')
  log(expiredRead === null, 'expired file is not readable')

  const expPathRow = (await sql`SELECT path FROM generated_files WHERE id = ${exp.id}`)[0] as { path: string } | undefined
  const pruned = await pruneExpiredGeneratedFiles()
  const stillThere = expPathRow ? await fs.access(expPathRow.path).then(() => true).catch(() => false) : false
  const rowGone = (await sql`SELECT id FROM generated_files WHERE id = ${exp.id}`).length === 0
  log(pruned >= 1 && rowGone && !stillThere, 'prune removes expired row + bytes', `pruned=${pruned}`)

  // 9. End-to-end: mirror runCode() — sandbox /exec -> store -> retrieve.
  const sandboxUrl = process.env.SANDBOX_URL || 'http://localhost:8002'
  let sandboxUp = false
  try { sandboxUp = (await (await fetch(`${sandboxUrl}/health`)).json() as { ok: boolean }).ok } catch { /* down */ }
  if (sandboxUp) {
    const res = await fetch(`${sandboxUrl}/exec`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        language: 'python', timeout_s: 30,
        code: "import pandas as pd\npd.DataFrame({'a':[1,2],'b':[3,4]}).to_excel('e2e.xlsx', index=False)\nprint('made xlsx')",
      }),
    })
    const data = await res.json() as { ok: boolean; files: Array<{ name: string; mime: string; b64: string }> }
    const produced = data.files?.[0]
    // Store exactly as runCode() does, then read back as the download route does.
    const stored = produced ? await saveGeneratedFile({
      conversationId: 'e2e', userId: 'alice', name: produced.name, mime: produced.mime,
      bytes: Buffer.from(produced.b64, 'base64'),
    }) : null
    const fetched = stored ? await getGeneratedFileForUser(stored.id, 'alice', 'user') : null
    const bytes2 = fetched ? await readGeneratedFileBytes(fetched) : Buffer.alloc(0)
    log(data.ok && !!stored && !!fetched && bytes2.slice(0, 2).toString() === 'PK',
      'E2E: sandbox exec -> store -> owner retrieve -> valid xlsx', `size=${bytes2.length}`)
  } else {
    console.log('  [SKIP] E2E sandbox->store (sandbox not running)')
  }

  console.log(`\n${pass}/${pass + fail} passed — ${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}\n`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(e => { console.error(e); process.exit(2) })
