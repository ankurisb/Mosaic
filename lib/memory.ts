// lib/memory.ts
// Cross-conversation memory: short, durable facts about a user that Mosaic
// recalls in later chats. Per-user (never shared across users); optional project
// tag. Explicit writes only in v1 (save_memory tool / Settings page). A light
// privacy filter keeps obviously-sensitive content (credentials, health, IDs)
// out of the store. Kept small and DB-agnostic (SQLite + Postgres).
import { getDb } from '@/lib/db'
import { randomUUID } from 'crypto'

export type MemoryCategory = 'preference' | 'fact' | 'project'
export interface MemoryRow {
  id: string; user_id: string; project: string | null
  category: MemoryCategory; content: string; source: string
  created_at: string; updated_at: string
}

const MAX_CONTENT = 500         // chars per entry
const MAX_ENTRIES = 200         // per user
const MAX_PROMPT_CHARS = 2500   // injected into the system prompt
const CATEGORIES: MemoryCategory[] = ['preference', 'fact', 'project']

function normCategory(c?: string): MemoryCategory {
  return (CATEGORIES.includes(c as MemoryCategory) ? c : 'fact') as MemoryCategory
}

// Light guard against storing clearly-sensitive content. Not a substitute for
// the model's own judgement, but a backstop for both the tool and the UI.
const SENSITIVE = /\b(password|passwd|pass(?:phrase)?|api[\s_-]?key|secret\s*key|access\s*token|bearer\s+[a-z0-9._-]{10,}|ssn|social security|national insurance|credit\s*card|card\s*number|cvv|routing\s*number|iban|sort\s*code|\d{13,19}\b|diagnos(?:is|ed)|medical condition|prescription|mental health)\b/i

export function looksSensitive(content: string): boolean {
  return SENSITIVE.test(content)
}

function nowIso() { return new Date().toISOString() }

/** Save a memory for a user. Returns {ok} or {ok:false, reason}. */
export async function saveMemory(params: {
  userId: string; content: string; category?: string; project?: string | null; source?: string
}): Promise<{ ok: boolean; id?: string; reason?: string }> {
  const content = (params.content || '').trim().slice(0, MAX_CONTENT)
  if (!content) return { ok: false, reason: 'empty content' }
  if (looksSensitive(content)) return { ok: false, reason: 'content looks sensitive (credentials, health, or ID numbers) — not stored' }
  const sql = getDb()
  // Cap per-user entries: refuse politely once full (user can prune in Settings).
  try {
    const cnt = (await sql`SELECT COUNT(*) AS n FROM user_memory WHERE user_id = ${params.userId}`)[0] as { n: number }
    if (Number(cnt?.n || 0) >= MAX_ENTRIES) return { ok: false, reason: `memory is full (${MAX_ENTRIES} items) — remove some in Settings → Memory` }
  } catch { /* table may not exist yet pre-migration */ }
  // De-dupe exact repeats.
  try {
    const dup = await sql`SELECT id FROM user_memory WHERE user_id = ${params.userId} AND content = ${content}`
    if (dup.length) return { ok: true, id: (dup[0] as { id: string }).id }
  } catch { }
  const now = nowIso()
  const id = randomUUID()
  await sql`INSERT INTO user_memory (id, user_id, project, category, content, source, created_at, updated_at)
    VALUES (${id}, ${params.userId}, ${params.project || null}, ${normCategory(params.category)}, ${content}, ${params.source || 'chat'}, ${now}, ${now})`
  return { ok: true, id }
}

export async function listMemory(userId: string): Promise<MemoryRow[]> {
  const sql = getDb()
  try {
    return await sql`SELECT id, user_id, project, category, content, source, created_at, updated_at
      FROM user_memory WHERE user_id = ${userId} ORDER BY category, updated_at DESC` as unknown as MemoryRow[]
  } catch { return [] }
}

export async function updateMemory(id: string, userId: string, patch: { content?: string; category?: string; project?: string | null }): Promise<boolean> {
  const sql = getDb()
  // Read-modify-write so an omitted field keeps its value (portable across
  // SQLite/Postgres without COALESCE-on-self in a tagged template).
  const cur = (await sql`SELECT content, category, project FROM user_memory WHERE id = ${id} AND user_id = ${userId}`) as Array<{ content: string; category: string; project: string | null }>
  if (!cur.length) return false
  const content = patch.content !== undefined ? patch.content.trim().slice(0, MAX_CONTENT) : cur[0].content
  if (!content || looksSensitive(content)) return false
  const category = patch.category !== undefined ? normCategory(patch.category) : (cur[0].category as MemoryCategory)
  const project = patch.project !== undefined ? (patch.project || null) : cur[0].project
  await sql`UPDATE user_memory SET content = ${content}, category = ${category}, project = ${project}, updated_at = ${nowIso()}
    WHERE id = ${id} AND user_id = ${userId}`
  return true
}

export async function deleteMemory(id: string, userId: string): Promise<boolean> {
  const sql = getDb()
  const existing = (await sql`SELECT id FROM user_memory WHERE id = ${id} AND user_id = ${userId}`)
  if (!existing.length) return false
  await sql`DELETE FROM user_memory WHERE id = ${id} AND user_id = ${userId}`
  return true
}

/** Delete by fuzzy content match (for the forget_memory tool). Returns count removed. */
export async function forgetMemory(userId: string, match: string): Promise<number> {
  const sql = getDb()
  const m = (match || '').trim()
  if (!m) return 0
  const rows = await sql`SELECT id, content FROM user_memory WHERE user_id = ${userId}` as Array<{ id: string; content: string }>
  const lc = m.toLowerCase()
  const hit = rows.filter(r => r.content.toLowerCase().includes(lc))
  for (const r of hit) { try { await sql`DELETE FROM user_memory WHERE id = ${r.id} AND user_id = ${userId}` } catch {} }
  return hit.length
}

/** Compact block injected into the chat system prompt. Empty string if none. */
export async function formatMemoryForPrompt(userId: string): Promise<string> {
  const rows = await listMemory(userId)
  if (!rows.length) return ''
  const label: Record<MemoryCategory, string> = { preference: 'Preferences', fact: 'Facts', project: 'Project context' }
  const lines: string[] = []
  let used = 0
  for (const cat of CATEGORIES) {
    const items = rows.filter(r => r.category === cat)
    if (!items.length) continue
    lines.push(`\n${label[cat]}:`)
    for (const r of items) {
      const line = `- ${r.content}${r.project ? ` [${r.project}]` : ''}`
      if (used + line.length > MAX_PROMPT_CHARS) { lines.push('- …(more in Settings → Memory)'); used = MAX_PROMPT_CHARS; break }
      lines.push(line); used += line.length
    }
    if (used >= MAX_PROMPT_CHARS) break
  }
  return `\n\n## What you remember about this user\nThese are durable facts the user has asked you to remember across conversations. Use them when relevant; don't recite them unprompted.${lines.join('\n')}\n`
}
