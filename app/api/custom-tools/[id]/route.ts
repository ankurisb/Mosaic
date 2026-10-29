// app/api/custom-tools/[id] — enable/disable or delete one custom tool.
import { getSession } from '@/lib/auth'
import { getDb } from '@/lib/db'
export const runtime = 'nodejs'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(); if (!session || session.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 })
  const { id } = await params
  const b = await req.json().catch(() => ({})) as Record<string, unknown>
  if (typeof b.enabled === 'boolean') await getDb()`UPDATE custom_tools SET enabled=${b.enabled ? 1 : 0} WHERE id=${id}`.catch(() => {})
  return Response.json({ ok: true })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(); if (!session || session.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 })
  const { id } = await params
  await getDb()`DELETE FROM custom_tools WHERE id=${id}`.catch(() => {})
  return Response.json({ ok: true })
}
