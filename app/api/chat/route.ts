import Anthropic from '@anthropic-ai/sdk'
import { TOOLS, runTool } from '@/lib/tools'
import { getSession } from '@/lib/auth'

export const runtime = 'nodejs'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: Request) {
  // Must be logged in
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })

  let body: { messages: { role: string; content: string }[]; system?: string }
  try { body = await req.json() }
  catch { return Response.json({ error: 'Invalid request body' }, { status: 400 }) }

  const { messages, system } = body
  if (!messages?.length) return Response.json({ error: 'No messages provided' }, { status: 400 })

  const enc = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function send(obj: object) {
        controller.enqueue(enc.encode('data: ' + JSON.stringify(obj) + '\n\n'))
      }

      try {
        // Build the message array for Anthropic
        let history: Anthropic.MessageParam[] = messages.map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }))

        // Agentic loop: keep going while Claude wants to use tools
        while (true) {
          const response = await anthropic.messages.create({
            model: 'claude-sonnet-4-5',
            max_tokens: 4096,
            system: system || 'You are a helpful AI assistant. Be concise and clear.',
            tools: TOOLS,
            messages: history,
            stream: true,
          })

          let text = ''
          let stopReason = ''
          const toolBlocks: Anthropic.ToolUseBlock[] = []
          let activeTool: { id: string; name: string; json: string } | null = null

          for await (const evt of response) {
            if (evt.type === 'content_block_start') {
              if (evt.content_block.type === 'tool_use') {
                activeTool = { id: evt.content_block.id, name: evt.content_block.name, json: '' }
              }
            } else if (evt.type === 'content_block_delta') {
              if (evt.delta.type === 'text_delta') {
                text += evt.delta.text
                send({ type: 'text', text: evt.delta.text })
              } else if (evt.delta.type === 'input_json_delta' && activeTool) {
                activeTool.json += evt.delta.partial_json
              }
            } else if (evt.type === 'content_block_stop' && activeTool) {
              const block: Anthropic.ToolUseBlock = {
                type: 'tool_use',
                id: activeTool.id,
                name: activeTool.name,
                input: JSON.parse(activeTool.json || '{}'),
              }
              toolBlocks.push(block)
              send({ type: 'tool_start', name: block.name, input: block.input })
              activeTool = null
            } else if (evt.type === 'message_delta') {
              stopReason = evt.delta.stop_reason || ''
            }
          }

          // No tools used — we are done
          if (stopReason !== 'tool_use' || !toolBlocks.length) break

          // Run all tools and collect results
          const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
            toolBlocks.map(async block => {
              try {
                const result = await runTool(block.name, block.input as Record<string, unknown>)
                send({ type: 'tool_result', name: block.name, result })
                return { type: 'tool_result' as const, tool_use_id: block.id, content: JSON.stringify(result) }
              } catch (err) {
                const msg = err instanceof Error ? err.message : 'Tool failed'
                send({ type: 'tool_result', name: block.name, result: { error: msg } })
                return { type: 'tool_result' as const, tool_use_id: block.id, content: 'Error: ' + msg }
              }
            })
          )

          // Append assistant message + tool results and loop
          history = [
            ...history,
            { role: 'assistant', content: [...(text ? [{ type: 'text' as const, text }] : []), ...toolBlocks] },
            { role: 'user', content: toolResults },
          ]
        }

        send({ type: 'done' })
      } catch (err) {
        console.error('Chat error:', err)
        send({ type: 'error', message: err instanceof Error ? err.message : 'Something went wrong' })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
