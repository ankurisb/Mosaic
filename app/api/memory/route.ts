// app/api/memory/route.ts
// Per-user memory CRUD for the Settings → Memory page. Every operation is scoped
// to the signed-in user — a user can only see and change their own memory.
import { getSession } from '@/lib/auth'
import { listMemory, saveMemory, updateMemory, deleteMemory } from '@/lib/memory'

export const runtime = 'nodejs'

export async function GET() {
  const s = await getSession()
  if (!s) return Response.json({ error: 'Not signed in' }, { status: 401 })
  return Response.json({ memories: await listMemory(s.id) })
}

export async function POST(req: Request) {
  const s = await getSession()
  if (!s) return Response.json({ error: 'Not signed in' }, { status: 401 })
  const body = await req.json().catch(() => ({})) as { content?: string; category?: string; project?: string | null }
  const r = await saveMemory({ userId: s.id, content: String(body.content || ''), category: body.category, project: body.project ?? null, source: 'settings' })
  return Response.json(r, { status: r.ok ? 200 : 400 })
}

export async function PATCH(req: Request) {
  const s = await getSession()
  if (!s) return Response.json({ error: 'Not signed in' }, { status: 401 })
  const body = await req.json().catch(() => ({})) as { id?: string; content?: string; category?: string; project?: string | null }
  if (!body.id) return Response.json({ error: 'id required' }, { status: 400 })
  const ok = await updateMemory(String(body.id), s.id, { content: body.content, category: body.category, project: body.project })
  return Response.json({ ok }, { status: ok ? 200 : 400 })
}

export async function DELETE(req: Request) {
  const s = await getSession()
  if (!s) return Response.json({ error: 'Not signed in' }, { status: 401 })
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })
  const ok = await deleteMemory(id, s.id)
  return Response.json({ ok }, { status: ok ? 200 : 404 })
}
