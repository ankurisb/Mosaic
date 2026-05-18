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
  const reqLog = log.child({ requestId, service: 'v1/chat' })

  const auth = await validateDevApiKey(req, ['read'])
  if (!auth.ok) return auth.response

  const body = await req.json()
  const {
    messages,
    system,
    model = 'claude-sonnet-4-6',
    max_tokens = 4096,
    conversation_id,
  } = body as {
    messages: Array<{ role: 'user' | 'assistant'; content: string }>
    system?: string
    model?: string
    max_tokens?: number
    conversation_id?: string
  }

  if (!messages?.length)
    return Response.json({ error: 'messages is required' }, { status: 400 })

  const apiKey = await getKey('ANTHROPIC_API_KEY')
  if (!apiKey)
    return Response.json({ error: 'Anthropic API key not configured' }, { status: 503 })

  // Build data source context
  const sql = getDb()
  const [dbConns, apiConns] = await Promise.all([
    sql`SELECT id, label, dialect, host, database_name FROM db_connections ORDER BY created_at ASC`.catch(() => []),
    sql`SELECT c.id, c.label, s.label as service_label, c.base_path FROM api_connections c JOIN api_services s ON s.id = c.service_id ORDER BY c.created_at ASC`.catch(() => []),
  ])

  const dbList = dbConns.length
    ? '\n\nDatabases:\n' + dbConns.map((c: Record<string, unknown>) =>
        `- id:"${c.id}" | "${c.label}" | ${c.dialect}`).join('\n')
    : ''

  const apiList = apiConns.length
    ? '\n\nAPIs:\n' + apiConns.map((c: Record<string, unknown>) =>
        `- id:"${c.id}" | "${c.label}" (${c.service_label})`).join('\n')
    : ''

  const defaultSystem = `You are Mosaic, an industrial AI assistant. Answer directly and accurately.${dbList}${apiList}`

  const anthropic = new Anthropic({ apiKey })
  const MODELS: Record<string, boolean> = {
    'claude-haiku-4-5-20251001': true,
    'claude-sonnet-4-6': true,
    'claude-opus-4-6': true,
  }
  const safeModel = MODELS[model] ? model : 'claude-sonnet-4-6'

  reqLog.info({ model: safeModel }, 'Chat request received')

  try {
    // Agentic loop — handle tool calls
    let history = messages
    let finalText = ''
    let totalInput = 0, totalOutput = 0
    const allToolCalls: Array<{ name: string; input: unknown; result?: unknown }> = []
    const MAX_TURNS = 10

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const resp = await anthropic.messages.create({
        model: safeModel, max_tokens, tools: TOOLS,
        system: system || defaultSystem,
        messages: history,
      })

      if (resp.usage) {
        totalInput += resp.usage.input_tokens
        totalOutput += resp.usage.output_tokens
      }

      const toolUseBlocks = resp.content.filter(b => b.type === 'tool_use') as Anthropic.ToolUseBlock[]
      const textBlock = resp.content.find(b => b.type === 'text') as Anthropic.TextBlock | undefined
      if (textBlock) finalText = textBlock.text

      if (resp.stop_reason !== 'tool_use' || !toolUseBlocks.length) break

      // Execute tools
      const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
        toolUseBlocks.map(async block => {
          try {
            const result = await runTool(block.name, block.input as Record<string, unknown>)
            allToolCalls.push({ name: block.name, input: block.input, result })
            return { type: 'tool_result' as const, tool_use_id: block.id, content: JSON.stringify(result) }
          } catch (err) {
            allToolCalls.push({ name: block.name, input: block.input, result: { error: (err as Error).message } })
            return { type: 'tool_result' as const, tool_use_id: block.id, content: 'Error: ' + (err as Error).message }
          }
        })
      )

      history = [
        ...history,
        { role: 'assistant' as const, content: resp.content },
        { role: 'user' as const, content: toolResults },
      ] as typeof history
    }

    const latency = Date.now() - start
    await logDevApiUsage(auth.keyId, '/api/v1/chat', 'POST', 200, latency)
    reqLog.info({ model: safeModel, inputTokens: totalInput, outputTokens: totalOutput, tools: allToolCalls.length }, 'Chat completed')

    return Response.json({
      response: finalText,
      model: safeModel,
      tool_calls: allToolCalls.length ? allToolCalls : undefined,
      usage: { input_tokens: totalInput, output_tokens: totalOutput },
      latency_ms: latency,
      conversation_id: conversation_id || undefined,
    })
  } catch (err) {
    const latency = Date.now() - start
    await logDevApiUsage(auth.keyId, '/api/v1/chat', 'POST', 500, latency)
    reqLog.error({ err }, 'Chat failed')
    return Response.json({ error: (err as Error).message }, { status: 500 })
  }
}
