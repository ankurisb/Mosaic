// app/api/agents/[id]/evals — list + create eval cases for an agent.
import { getSession } from '@/lib/auth'
import { getDb, nowExpr } from '@/lib/db'
import { setupDatabase } from '@/lib/setup'
export const runtime = 'nodejs'

type Row = Record<string, unknown>

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(); if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  await setupDatabase().catch(() => {})
  const { id } = await params
  const rows = await getDb()`SELECT id, agent_id, name, input, expected_contains, expect_status, last_passed, last_run_at, created_at
    FROM agent_evals WHERE agent_id=${id} ORDER BY created_at ASC`.catch(() => [])
  return Response.json({ evals: rows })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(); if (!session || session.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 })
  await setupDatabase().catch(() => {})
  const { id } = await params
  const b = await req.json().catch(() => ({})) as Row
  const name = typeof b.name === 'string' && b.name.trim() ? b.name.trim().slice(0, 160) : 'Untitled check'
  const input = typeof b.input === 'string' && b.input.trim() ? b.input.trim() : null
  const expected = Array.isArray(b.expected_contains) ? (b.expected_contains as unknown[]).map(String).filter(s => s.trim()).slice(0, 20) : []
  const expectStatus = b.expect_status === 'any' ? 'any' : 'succeeded'
  const rows = await getDb()`INSERT INTO agent_evals (agent_id, name, input, expected_contains, expect_status, created_by, created_at)
    VALUES (${id}, ${name}, ${input}, ${JSON.stringify(expected)}, ${expectStatus}, ${session.id}, ${nowExpr()}) RETURNING *`
  return Response.json({ eval: (rows as Row[])[0] })
}
