// lib/transparency.ts
// AI Transparency Ledger — writes one row per assistant response.
// Called at the end of every chat completion, fire-and-forget.
//
// The record answers: what did the AI query, how many tokens, what data did it read?
// Designed for security-apprehensive industrial buyers auditing AI decisions.

import { getDb } from './db'
import { log } from './logger'

export interface TransparencyEntry {
  messageId:       string | null
  conversationId:  string | null
  userId:          string
  userEmail:       string
  question:        string
  answerSummary:   string
  toolCalls:       Array<{ name: string; input: unknown; result?: unknown }>
  inputTokens:     number
  outputTokens:    number
  costUsd:         number
  latencyMs:       number
  model:           string
  isRca:           boolean
}

function countRows(result: unknown): number {
  if (!result || typeof result !== 'object') return 0
  const r = result as Record<string, unknown>
  if (Array.isArray(r.rows)) return r.rows.length
  if (Array.isArray(result)) return (result as unknown[]).length
  return 0
}

// Cache connection labels in-process to avoid a DB hit per tool call
const _labelCache = new Map<string, string>()

async function resolveLabel(id: string, type: 'database' | 'api' | 'file_server'): Promise<string> {
  const key = `${type}:${id}`
  if (_labelCache.has(key)) return _labelCache.get(key)!
  try {
    const sql = getDb()
    let row: { label?: string; service_name?: string } | undefined
    if (type === 'database') {
      const rows = await sql`SELECT label FROM db_connections WHERE id = ${id} LIMIT 1`
      row = rows[0] as { label: string } | undefined
    } else if (type === 'api') {
      const rows = await sql`SELECT label FROM api_services WHERE id = ${id} LIMIT 1`
      row = rows[0] as { label: string } | undefined
    } else {
      const rows = await sql`SELECT label FROM file_servers WHERE id = ${id} LIMIT 1`
      row = rows[0] as { label: string } | undefined
    }
    const label = (row?.label) || id.slice(0, 8)
    _labelCache.set(key, label)
    return label
  } catch {
    return id.slice(0, 8)
  }
}

async function buildSource(tc: { name: string; input: unknown }): Promise<{ type: string; label: string } | null> {
  const inp = (tc.input || {}) as Record<string, unknown>
  if (tc.name === 'query_database') {
    const id = String(inp.connection_id || '')
    const label = id ? await resolveLabel(id, 'database') : 'database'
    return { type: 'database', label }
  }
  if (tc.name === 'call_api') {
    const id = String(inp.service_id || inp.connection_id || '')
    const label = id ? await resolveLabel(id, 'api') : 'api'
    return { type: 'api', label }
  }
  if (tc.name === 'read_file_server') {
    const id = String(inp.connection_id || '')
    const label = id ? await resolveLabel(id, 'file_server') : 'file server'
    return { type: 'file_server', label }
  }
  if (tc.name === 'web_search') {
    return { type: 'web', label: `Web: "${String(inp.query || '').slice(0, 40)}"` }
  }
  if (tc.name === 'query_prism') {
    return { type: 'prism', label: String(inp.instance_id || 'Prism IoT') }
  }
  return null
}

export async function writeTransparencyLog(entry: TransparencyEntry): Promise<void> {
  try {
    const sql = getDb()

    // Deduplicate sources — resolve friendly labels from DB
    const seenSources = new Set<string>()
    const sourcesQueried: Array<{ type: string; label: string }> = []
    for (const tc of entry.toolCalls) {
      const s = await buildSource(tc)
      if (s) {
        const key = `${s.type}:${s.label}`
        if (!seenSources.has(key)) { seenSources.add(key); sourcesQueried.push(s) }
      }
    }

    const toolsUsed = [...new Set(entry.toolCalls.map(tc => tc.name))]
    const rowsRead = entry.toolCalls.reduce((sum, tc) => sum + countRows(tc.result), 0)
    const webSearchUsed = entry.toolCalls.some(tc => tc.name === 'web_search') ? 1 : 0

    await sql`
      INSERT INTO transparency_log (
        message_id, conversation_id, user_id, user_email,
        question, answer_summary,
        tool_calls_count, tools_used, sources_queried, rows_read, web_search_used,
        input_tokens, output_tokens, cost_usd, latency_ms, model, is_rca
      ) VALUES (
        ${entry.messageId},
        ${entry.conversationId},
        ${entry.userId},
        ${entry.userEmail},
        ${entry.question.slice(0, 300)},
        ${entry.answerSummary.slice(0, 300)},
        ${entry.toolCalls.length},
        ${JSON.stringify(toolsUsed)},
        ${JSON.stringify(sourcesQueried)},
        ${rowsRead},
        ${webSearchUsed},
        ${entry.inputTokens},
        ${entry.outputTokens},
        ${entry.costUsd},
        ${entry.latencyMs},
        ${entry.model},
        ${entry.isRca ? 1 : 0}
      )`
  } catch (err) {
    // Never block the chat response — transparency is observational
    log.error({ service: 'transparency', err }, 'Failed to write transparency log')
  }
}
