import { NextRequest } from 'next/server'
import { getSession } from '@/lib/auth'
import { getDb } from '@/lib/db'

// CRUD for the metrics & definitions layer. Admin-only (these shape every AI answer).
async function requireAdmin() {
  const session = await getSession()
  if (!session) return { error: 'Unauthorized', status: 401 as const }
  if (session.role !== 'admin') return { error: 'Admin only', status: 403 as const }
  return { session }
}

export async function GET() {
  const auth = await requireAdmin()
  if ('error' in auth) return Response.json({ error: auth.error }, { status: auth.status })
  try {
    const sql = getDb()
    const rows = await sql`SELECT id, name, kind, definition, formula, applies_to, enabled
                           FROM metric_definitions ORDER BY kind, name`
    return Response.json({ metrics: rows })
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin()
  if ('error' in auth) return Response.json({ error: auth.error }, { status: auth.status })
  try {
    const b = await req.json()
    const name = String(b.name || '').trim()
    if (!name) return Response.json({ error: 'name is required' }, { status: 400 })
    const kind = ['metric', 'entity', 'term'].includes(b.kind) ? b.kind : 'metric'
    const definition = String(b.definition || '').trim()
    const formula = b.formula ? String(b.formula).trim() : null
    const applies_to = b.applies_to ? String(b.applies_to).trim() : null
    const sql = getDb()
    if (b.id) {
      await sql`UPDATE metric_definitions
                SET name=${name}, kind=${kind}, definition=${definition}, formula=${formula},
                    applies_to=${applies_to}, enabled=${b.enabled ? 1 : 0}, updated_at=datetime('now')
                WHERE id=${String(b.id)}`
      return Response.json({ ok: true, id: b.id })
    } else {
      await sql`INSERT INTO metric_definitions (name, kind, definition, formula, applies_to, enabled)
                VALUES (${name}, ${kind}, ${definition}, ${formula}, ${applies_to}, ${b.enabled === false ? 0 : 1})`
      return Response.json({ ok: true })
    }
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin()
  if ('error' in auth) return Response.json({ error: auth.error }, { status: auth.status })
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    const sql = getDb()
    await sql`DELETE FROM metric_definitions WHERE id=${id}`
    return Response.json({ ok: true })
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 })
  }
}
