import { getSession } from '@/lib/auth'
import { getRawDb } from '@/lib/db'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const session = await getSession()
  if (!session || session.role !== 'admin')
    return Response.json({ error: 'Admin only' }, { status: 403 })

  const url     = new URL(req.url)
  const limit   = Math.min(parseInt(url.searchParams.get('limit')  || '50'), 200)
  const offset  = parseInt(url.searchParams.get('offset') || '0')
  const q       = url.searchParams.get('q')?.trim()       || null
  const userId  = url.searchParams.get('user_id')         || null
  const since   = url.searchParams.get('since')           || null
  const isRca   = url.searchParams.get('is_rca')          || null
  const convId  = url.searchParams.get('conversation_id') || null

  const db = getRawDb()
  if (!db) return Response.json({ error: 'SQLite only' }, { status: 501 })

  const conditions: string[] = []
  const values: unknown[] = []

  if (userId)  { conditions.push('user_id = ?');          values.push(userId) }
  if (convId)  { conditions.push('conversation_id = ?');  values.push(convId) }
  if (since)   { conditions.push('created_at >= ?');      values.push(since) }
  if (isRca === '1') { conditions.push('is_rca = 1') }
  if (q) {
    conditions.push('(question LIKE ? OR answer_summary LIKE ? OR sources_queried LIKE ? OR user_email LIKE ?)')
    values.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const rows = db.prepare(
    `SELECT id, message_id, conversation_id, user_id, user_email,
            question, answer_summary,
            tool_calls_count, tools_used, sources_queried, rows_read, web_search_used,
            input_tokens, output_tokens, cost_usd, latency_ms, model, is_rca, created_at
     FROM transparency_log ${where}
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`
  ).all([...values, limit, offset]) as Record<string, unknown>[]

  const total = (db.prepare(`SELECT COUNT(*) as cnt FROM transparency_log ${where}`)
    .get([...values]) as { cnt: number }).cnt

  // Parse JSON columns
  const entries = rows.map(r => ({
    ...r,
    tools_used:      typeof r.tools_used === 'string'      ? JSON.parse(r.tools_used)      : r.tools_used,
    sources_queried: typeof r.sources_queried === 'string' ? JSON.parse(r.sources_queried) : r.sources_queried,
    is_rca:          r.is_rca === 1,
    web_search_used: r.web_search_used === 1,
  }))

  return Response.json({ entries, total, limit, offset, hasMore: offset + rows.length < total })
}
