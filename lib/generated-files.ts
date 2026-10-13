// lib/generated-files.ts
// Store + retrieve files produced by the code sandbox (run_code). Bytes live on
// disk under MOSAIC_FILE_DIR (persistent /data volume by default); metadata +
// ownership live in the generated_files table so downloads can be access-checked
// and expired files pruned. Kept small and dependency-free.
import { getDb } from '@/lib/db'
import { randomUUID, createHash } from 'crypto'
import { promises as fs } from 'fs'
import path from 'path'

const FILE_DIR = process.env.MOSAIC_FILE_DIR || '/data/generated-files'
const DEFAULT_TTL_DAYS = 7
const MAX_FILE_BYTES = 20 * 1024 * 1024

export interface StoredFileMeta { id: string; name: string; mime: string; size: number }

function isoIn(days: number): string {
  return new Date(Date.now() + days * 86400_000).toISOString()
}

/** Write bytes to disk and record metadata. Returns the row id + display meta. */
export async function saveGeneratedFile(params: {
  conversationId?: string | null
  userId?: string | null
  name: string
  mime: string
  bytes: Buffer
  ttlDays?: number
}): Promise<StoredFileMeta> {
  if (params.bytes.length > MAX_FILE_BYTES) throw new Error('file exceeds size limit')
  await fs.mkdir(FILE_DIR, { recursive: true })
  const id = randomUUID()
  // Store under a hashed basename (never the user-supplied name) to avoid any
  // path games; the real name is only metadata used for the download header.
  const diskName = createHash('sha256').update(id).digest('hex').slice(0, 32)
  const diskPath = path.join(FILE_DIR, diskName)
  await fs.writeFile(diskPath, params.bytes)
  const name = (params.name || 'file').split(/[\\/]/).pop() || 'file'
  const sql = getDb()
  await sql`INSERT INTO generated_files (id, conversation_id, user_id, name, mime, size, path, expires_at)
    VALUES (${id}, ${params.conversationId || null}, ${params.userId || null}, ${name}, ${params.mime || 'application/octet-stream'}, ${params.bytes.length}, ${diskPath}, ${isoIn(params.ttlDays ?? DEFAULT_TTL_DAYS)})`
  return { id, name, mime: params.mime, size: params.bytes.length }
}

export interface GeneratedFileRow { id: string; name: string; mime: string; size: number; path: string; user_id: string | null; conversation_id: string | null; expires_at: string | null }

/** Fetch a file's metadata if the requester may read it (owner or admin). */
export async function getGeneratedFileForUser(id: string, userId: string, role: string): Promise<GeneratedFileRow | null> {
  const sql = getDb()
  const rows = await sql`SELECT id, name, mime, size, path, user_id, conversation_id, expires_at FROM generated_files WHERE id = ${id}`
  if (!rows.length) return null
  const r = rows[0] as unknown as GeneratedFileRow
  if (r.expires_at && new Date(r.expires_at).getTime() < Date.now()) return null
  if (role !== 'admin' && r.user_id && r.user_id !== userId) return null
  return r
}

/** Read the bytes for a row (after access has been checked). */
export async function readGeneratedFileBytes(row: GeneratedFileRow): Promise<Buffer> {
  return fs.readFile(row.path)
}

/** Best-effort prune of expired files (disk + row). Safe to call opportunistically. */
export async function pruneExpiredGeneratedFiles(): Promise<number> {
  const sql = getDb()
  const now = new Date().toISOString()
  const rows = await sql`SELECT id, path FROM generated_files WHERE expires_at IS NOT NULL AND expires_at < ${now}` as Array<{ id: string; path: string }>
  let n = 0
  for (const r of rows) {
    try { await fs.unlink(r.path) } catch {}
    try { await sql`DELETE FROM generated_files WHERE id = ${r.id}`; n++ } catch {}
  }
  return n
}
