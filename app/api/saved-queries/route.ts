// app/api/saved-queries/route.ts
// CRUD for the single source of truth of user-authored queries (Query Builder).
// Dashboards and rules/alerts reference these by id instead of carrying their own
// SQL. Replaces the old browser-localStorage "saved queries".
import { getSession } from '@/lib/auth'
import { getDb, nowExpr } from '@/lib/db'

export const runtime = 'nodejs'

// GET /api/saved-queries — list the current user's saved queries (newest first).
export async function GET() {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  const sql = getDb()
  const rows = await sql`
    SELECT id, name, description, connection_id, connection_label, connection_type,
           query, created_at, updated_at
    FROM saved_queries
    WHERE owner_id = ${session.id}
    ORDER BY updated_at DESC`
  return Response.json({ queries: rows })
}

// POST /api/saved-queries — create / update / delete a saved query.
export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  const sql = getDb()
  const body = await req.json().catch(() => ({}))
  const { action } = body as { action?: string }

  if (action === 'create') {
    const { name, description, connection_id, connection_label, connection_type, query } =
      body as Record<string, string>
    if (!name?.trim() || !query?.trim()) {
      return Response.json({ error: 'name and query are required' }, { status: 400 })
    }
    const rows = await sql`
      INSERT INTO saved_queries
        (owner_id, name, description, connection_id, connection_label, connection_type, query)
      VALUES
        (${session.id}, ${name.trim()}, ${description || ''}, ${connection_id || null},
         ${connection_label || ''}, ${connection_type || 'db'}, ${query.trim()})
      RETURNING id` as unknown as { id: string }[]
    return Response.json({ ok: true, id: rows[0]?.id })
  }

  if (action === 'update') {
    const { id, name, description, connection_id, connection_label, connection_type, query } =
      body as Record<string, string>
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    await sql`
      UPDATE saved_queries SET
        name = ${name?.trim() ?? ''},
        description = ${description || ''},
        connection_id = ${connection_id || null},
        connection_label = ${connection_label || ''},
        connection_type = ${connection_type || 'db'},
        query = ${query?.trim() ?? ''},
        updated_at = ${nowExpr()}
      WHERE id = ${id} AND owner_id = ${session.id}`
    return Response.json({ ok: true })
  }

  if (action === 'delete') {
    const { id } = body as { id?: string }
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    await sql`DELETE FROM saved_queries WHERE id = ${id} AND owner_id = ${session.id}`
    return Response.json({ ok: true })
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 })
}
