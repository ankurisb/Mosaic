import { validateDevApiKey, logDevApiUsage } from '@/lib/dev-api-auth'
import { getKey } from '@/lib/keys'
import { getDb } from '@/lib/db'
import Anthropic from '@anthropic-ai/sdk'
import { TOOLS, runTool } from '@/lib/tools'
import { RCA_SYSTEM_PROMPT } from '@/lib/rca'
import { log, newRequestId } from '@/lib/logger'
export const runtime = 'nodejs'

export async function POST(req: Request) {
  const start = Date.now()
  const requestId = newRequestId()
  const reqLog = log.child({ requestId, service: 'v1/rca' })

  const auth = await validateDevApiKey(req, ['read'])
  if (!auth.ok) return auth.response

  const body = await req.json()
  const {
    problem,
    workflow_id,
    context,
  } = body as {
    problem: string
    workflow_id?: string
    context?: string
  }

  if (!problem?.trim())
    return Response.json({ error: 'problem is required' }, { status: 400 })

  const apiKey = await getKey('ANTHROPIC_API_KEY')
  if (!apiKey)
    return Response.json({ error: 'Anthropic API key not configured' }, { status: 503 })

  const sql = getDb()

  // Load workflow template if specified
  let workflowPrompt = ''
  if (workflow_id) {
    const wf = await sql`SELECT * FROM rca_workflows WHERE id = ${workflow_id} AND active = true LIMIT 1`
    if (wf.length) {
      const w = wf[0] as Record<string, unknown>
      const steps = (w.data_steps as Array<{ n: number; source_label: string; query_hint: string; required: boolean }>) || []
      const renderers = (w.renderers as Array<{ type: string; label: string; required: boolean; order: number }>) || []
      workflowPrompt = `\n\nWorkflow: "${w.name}"\nData steps:\n${steps.map(s => `  ${s.n}. [${s.source_label}] ${s.query_hint}`).join('\n')}\nRenderers: ${renderers.map(r => r.type).join(', ')}`
    }
  }

  // Build data source context
  const [dbConns, apiConns] = await Promise.all([
    sql`SELECT id, label, dialect, host, database_name FROM db_connections ORDER BY created_at ASC`.catch(() => []),
    sql`SELECT c.id, c.label, s.label as service_label, c.base_path FROM api_connections c JOIN api_services s ON s.id = c.service_id ORDER BY c.created_at ASC`.catch(() => []),
  ])

  const dbList = dbConns.map((c: Record<string, unknown>) =>
    `- id:"${c.id}" | "${c.label}" | ${c.dialect}`).join('\n')

  const userMessage = [
    problem,
    context ? `\nAdditional context: ${context}` : '',
  ].join('')

  const anthropic = new Anthropic({ apiKey })

  reqLog.info({ problem: problem.slice(0, 100), workflow_id }, 'RCA request received')

  try {
    let history: Anthropic.MessageParam[] = [{ role: 'user', content: userMessage }]
    let finalText = ''
    let rcaBlock: unknown = null
    let totalInput = 0, totalOutput = 0
    const allToolCalls: Array<{ name: string; input: unknown; result?: unknown }> = []
    const MAX_TURNS = 20

    const systemPrompt = RCA_SYSTEM_PROMPT +
      `\n\nDatabases:\n${dbList}` +
      (apiConns.length ? `\n\nAPIs:\n${apiConns.map((c: Record<string, unknown>) => `- id:"${c.id}" | "${c.label}"`).join('\n')}` : '') +
      workflowPrompt

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const resp = await anthropic.messages.create({
        model: 'claude-sonnet-4-6', max_tokens: 16384,
        tools: TOOLS, system: systemPrompt, messages: history,
      })

      if (resp.usage) { totalInput += resp.usage.input_tokens; totalOutput += resp.usage.output_tokens }

      const toolUseBlocks = resp.content.filter(b => b.type === 'tool_use') as Anthropic.ToolUseBlock[]
      const textBlock = resp.content.find(b => b.type === 'text') as Anthropic.TextBlock | undefined
      if (textBlock) finalText = textBlock.text

      if (resp.stop_reason !== 'tool_use' || !toolUseBlocks.length) break

      const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
        toolUseBlocks.map(async block => {
          try {
            const result = await runTool(block.name, block.input as Record<string, unknown>)
            allToolCalls.push({ name: block.name, input: block.input, result })
            return { type: 'tool_result' as const, tool_use_id: block.id, content: JSON.stringify(result) }
          } catch (err) {
            return { type: 'tool_result' as const, tool_use_id: block.id, content: 'Error: ' + (err as Error).message }
          }
        })
      )
      history = [...history, { role: 'assistant', content: resp.content }, { role: 'user', content: toolResults }] as typeof history
    }

    // Extract rca_output JSON block
    const rcaMatch = finalText.match(/<rca_output>([\s\S]*?)<\/rca_output>/)
    if (rcaMatch) {
      try { rcaBlock = JSON.parse(rcaMatch[1].trim()) } catch { }
    }
    const cleanText = finalText.replace(/<rca_output>[\s\S]*?<\/rca_output>/, '').trim()

    const latency = Date.now() - start
    await logDevApiUsage(auth.keyId, '/api/v1/rca', 'POST', 200, latency)
    reqLog.info({ latency_ms: latency, tools: allToolCalls.length }, 'RCA completed')

    return Response.json({
      problem,
      analysis: cleanText,
      rca_output: rcaBlock,
      tool_calls: allToolCalls.length ? allToolCalls : undefined,
      usage: { input_tokens: totalInput, output_tokens: totalOutput },
      latency_ms: latency,
    })
  } catch (err) {
    const latency = Date.now() - start
    await logDevApiUsage(auth.keyId, '/api/v1/rca', 'POST', 500, latency)
    reqLog.error({ err }, 'RCA failed')
    return Response.json({ error: (err as Error).message }, { status: 500 })
  }
}
