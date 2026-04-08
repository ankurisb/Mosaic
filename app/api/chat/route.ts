import Anthropic from '@anthropic-ai/sdk'
import { TOOLS, runTool } from '@/lib/tools'
import { getSession } from '@/lib/auth'
import { getDb } from '@/lib/db'
export const runtime = 'nodejs'
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const SONNET_PRICE = { input: 3 / 1_000_000, output: 15 / 1_000_000 }

export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  const { messages, system } = await req.json()
  if (!messages?.length) return Response.json({ error: 'No messages' }, { status: 400 })
  const enc = new TextEncoder()
  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (o: object) => ctrl.enqueue(enc.encode('data: ' + JSON.stringify(o) + '\n\n'))
      try {
        let history: Anthropic.MessageParam[] = messages.map((m: { role: string; content: string }) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
        let totalInput = 0, totalOutput = 0
        while (true) {
          const resp = await anthropic.messages.create({
            model: 'claude-sonnet-4-5', max_tokens: 4096,
            system: system || 'You are a helpful AI assistant. When you have access to database connections or API connections from the user\'s settings, you can query them to answer questions about their data.',
            tools: TOOLS, messages: history, stream: true,
          })
          let text = '', stopReason = ''
          const toolBlocks: Anthropic.ToolUseBlock[] = []
          let activeTool: { id: string; name: string; json: string } | null = null
          for await (const evt of resp) {
            if (evt.type === 'content_block_start' && evt.content_block.type === 'tool_use') {
              activeTool = { id: evt.content_block.id, name: evt.content_block.name, json: '' }
            } else if (evt.type === 'content_block_delta') {
              if (evt.delta.type === 'text_delta') { text += evt.delta.text; send({ type: 'text', text: evt.delta.text }) }
              else if (evt.delta.type === 'input_json_delta' && activeTool) activeTool.json += evt.delta.partial_json
            } else if (evt.type === 'content_block_stop' && activeTool) {
              const block: Anthropic.ToolUseBlock = { type: 'tool_use', id: activeTool.id, name: activeTool.name, input: JSON.parse(activeTool.json || '{}') }
              toolBlocks.push(block)
              send({ type: 'tool_start', name: block.name, input: block.input })
              activeTool = null
            } else if (evt.type === 'message_delta') {
              stopReason = evt.delta.stop_reason || ''
              if (evt.usage) totalOutput += evt.usage.output_tokens
            } else if (evt.type === 'message_start') {
              if (evt.message?.usage) totalInput += evt.message.usage.input_tokens
            }
          }
          if (stopReason !== 'tool_use' || !toolBlocks.length) break
          const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(toolBlocks.map(async block => {
            try {
              const result = await runTool(block.name, block.input as Record<string, unknown>)
              send({ type: 'tool_result', name: block.name, result })
              return { type: 'tool_result' as const, tool_use_id: block.id, content: JSON.stringify(result) }
            } catch (err) {
              const msg = err instanceof Error ? err.message : 'Tool failed'
              send({ type: 'tool_result', name: block.name, result: { error: msg } })
              return { type: 'tool_result' as const, tool_use_id: block.id, content: 'Error: ' + msg }
            }
          }))
          history = [...history, { role: 'assistant', content: [...(text ? [{ type: 'text' as const, text }] : []), ...toolBlocks] }, { role: 'user', content: toolResults }]
        }
        // Log usage
        try {
          const cost = totalInput * SONNET_PRICE.input + totalOutput * SONNET_PRICE.output
          const sql = getDb()
          await sql`INSERT INTO usage_events(user_id,user_email,type,model,input_tokens,output_tokens,cost_usd) VALUES(${session.id},${session.email},'chat','claude-sonnet-4-5',${totalInput},${totalOutput},${cost})`
        } catch {}
        send({ type: 'done' })
      } catch (err) {
        send({ type: 'error', message: err instanceof Error ? err.message : 'Something went wrong' })
      } finally { ctrl.close() }
    },
  })
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' } })
}
