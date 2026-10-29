// app/api/agents/[id]/evals/[evalId] — delete one eval case.
import { getSession } from '@/lib/auth'
import { getDb } from '@/lib/db'
export const runtime = 'nodejs'

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; evalId: string }> }) {
  const session = await getSession(); if (!session || session.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 })
  const { id, evalId } = await params
  await getDb()`DELETE FROM agent_evals WHERE id=${evalId} AND agent_id=${id}`.catch(() => {})
  return Response.json({ ok: true })
}
