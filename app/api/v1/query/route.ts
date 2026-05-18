import { validateDevApiKey, logDevApiUsage } from '@/lib/dev-api-auth'
import { getKey } from '@/lib/keys'
import { getDb } from '@/lib/db'
import Anthropic from '@anthropic-ai/sdk'
import { TOOLS, runTool } from '@/lib/tools'
import { log, newRequestId } from '@/lib/logger'
export const runtime = 'nodejs'

export async function POST(req: Request) {
  const start = Date.now()
  const requestId = newRequestId()
  const reqLog = log.child({ requestId, service: 'v1/query' })

  const auth = await validateDevApiKey(req, ['read'])
  if (!auth.ok) return auth.response

  const body = await req.json()
  const { query, connection_id, limit = 100 } = body as {
    query: string
    connection_id?: string
    limit?: number
  }

  if (!query?.trim())
    return Response.json({ error: 'query is required' }, { status: 400 })

  const apiKey = await getKey('ANTHROPIC_API_KEY')
  if (!apiKey)
    return Response.json({ error: 'Anthropic API key not configured' }, { status: 503 })

  const sql = getDb()

  // Build connection context
  const dbConns = connection_id
    ? await sql`SELECT id, label, dialect, host, database_name FROM db_connections WHERE id = ${connection_id}`
    : await sql`SELECT id, label, dialect, host, database_name FROM db_connections ORDER BY created_at ASC`

  if (!dbConns.length)
    return Response.json({ error: 'No data sources found' }, { status: 404 })

  const connList = dbConns.map((c: Record<string, unknown>) =>
    `- id:"${c.id}" | "${c.label}" | ${c.dialect} | ${c.host}/${c.database_name}`
  ).join('\n')

  const anthropic = new Anthropic({ apiKey })

  reqLog.info({ query: query.slice(0, 100) }, 'Query request received')

  try {
    const resp = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      tools: TOOLS,
      system: `You are a data query assistant. Given a natural language query, use the query_database tool to retrieve the data. Always apply a LIMIT of ${limit} unless overridden by the user. Return only the raw data — no narration, no explanation, just the result.

Available data sources:
${connList}`,
      messages: [{ role: 'user', content: query }],
    })

    // Extract tool results
    const toolResults: Array<{ tool: string; input: unknown; result: unknown }> = []
    let assistantText = ''

    for (const block of resp.content) {
      if (block.type === 'text') assistantText = block.text
      if (block.type === 'tool_use') {
        try {
          const result = await runTool(block.name, block.input as Record<string, unknown>)
          toolResults.push({ tool: block.name, input: block.input, result })
        } catch (err) {
          toolResults.push({ tool: block.name, input: block.input, result: { error: (err as Error).message } })
        }
      }
    }

    const latency = Date.now() - start
    await logDevApiUsage(auth.keyId, '/api/v1/query', 'POST', 200, latency)
    reqLog.info({ latency_ms: latency, tools: toolResults.length }, 'Query completed')

    return Response.json({
      query,
      results: toolResults.length ? toolResults[toolResults.length - 1].result : null,
      tool_calls: toolResults,
      text: assistantText || undefined,
      latency_ms: latency,
    })
  } catch (err) {
    const latency = Date.now() - start
    await logDevApiUsage(auth.keyId, '/api/v1/query', 'POST', 500, latency)
    reqLog.error({ err }, 'Query failed')
    return Response.json({ error: (err as Error).message }, { status: 500 })
  }
}
