import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getDb } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = getDb()
  const { searchParams } = new URL(req.url)
  const limit = Math.min(Number(searchParams.get('limit') ?? 100), 500)
  const offset = Number(searchParams.get('offset') ?? 0)
  const search = searchParams.get('q') ?? ''

  try {
    let rows
    if (search) {
      rows = await db`
        SELECT id, connection_label, connection_type, dialect, query, row_count, duration_ms, status, error, executed_at
        FROM query_history
        WHERE user_id = ${session.id}
          AND (connection_label ILIKE ${'%' + search + '%'} OR query ILIKE ${'%' + search + '%'})
        ORDER BY executed_at DESC
        LIMIT ${limit} OFFSET ${offset}`
    } else {
      rows = await db`
        SELECT id, connection_label, connection_type, dialect, query, row_count, duration_ms, status, error, executed_at
        FROM query_history
        WHERE user_id = ${session.id}
        ORDER BY executed_at DESC
        LIMIT ${limit} OFFSET ${offset}`
    }

    const [{ total }] = await db`SELECT COUNT(*) as total FROM query_history WHERE user_id = ${session.id}`

    return NextResponse.json({ history: rows, total: Number(total) })
  } catch {
    return NextResponse.json({ history: [], total: 0 })
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const db = getDb()
  const { id } = await req.json().catch(() => ({}))
  if (id) {
    await db`DELETE FROM query_history WHERE id = ${id} AND user_id = ${session.id}`
  } else {
    await db`DELETE FROM query_history WHERE user_id = ${session.id}`
  }
  return NextResponse.json({ ok: true })
}
