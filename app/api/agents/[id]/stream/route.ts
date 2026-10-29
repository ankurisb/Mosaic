// app/api/agents/[id]/stream — run an agent and stream its activity over SSE.
//
// Same run as POST /api/agents/[id], but instead of blocking until the (possibly
// 50s+) run finishes, it streams the runner's emit() events live: run_started,
// plan + subagent_status/subagent_result (orchestrated), reason/tool/result
// (single), then a final { type:'run', run } carrying the full persisted RunResult.
// A 10s heartbeat keeps the connection warm through silent model-call windows
// (mirrors the chat SSE), and send() no-ops after the client disconnects.
import { getSession } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { setupDatabase } from '@/lib/setup'
import { runAgent } from '@/lib/agent-runner'
import { rowToAgent } from '../route'

export const runtime = 'nodejs'
export const maxDuration = 300

type Row = Record<string, unknown>

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  await setupDatabase().catch(() => {})
  const { id } = await params
  const rows = await getDb()`SELECT * FROM agents WHERE id = ${id}`.catch(() => [])
  const row = (rows as Row[])[0]
  if (!row) return Response.json({ error: 'Not found' }, { status: 404 })
  if (String(row.status) === 'paused') return Response.json({ error: 'Agent is paused' }, { status: 409 })
  const { attachCustomTools } = await import('@/lib/custom-tools-db')
  const agent = await attachCustomTools(rowToAgent(row), row.custom_tool_ids)

  const enc = new TextEncoder()
  let closed = false
  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (o: object) => {
        if (closed) return
        try { ctrl.enqueue(enc.encode('data: ' + JSON.stringify(o) + '\n\n')) } catch { closed = true }
      }
      const heartbeat = setInterval(() => send({ type: 'ping', t: Date.now() }), 10_000)
      try {
        const run = await runAgent(agent, {
          triggerSource: 'manual',
          userId: session.id, userEmail: session.email, userRole: session.role,
          emit: send,
        })
        send({ type: 'run', run })
      } catch (e) {
        send({ type: 'error', error: e instanceof Error ? e.message : String(e) })
      } finally {
        clearInterval(heartbeat)
        if (!closed) { try { ctrl.close() } catch {} }
      }
    },
    cancel() { closed = true },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' },
  })
}
