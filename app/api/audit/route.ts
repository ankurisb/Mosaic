import { getSession } from '@/lib/auth'
import { getDb, queryRaw } from '@/lib/db'
import { audit, AUDIT, verifyAuditChain, getAuditSettings } from '@/lib/audit'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const session = await getSession()
  if (!session || session.role !== 'admin')
    return Response.json({ error: 'Admin only' }, { status: 403 })

  const url     = new URL(req.url)
  const limit   = Math.min(parseInt(url.searchParams.get('limit')   || '100'), 500)
  const offset  = parseInt(url.searchParams.get('offset')  || '0')
  const actor   = url.searchParams.get('actor')   || null
  const action  = url.searchParams.get('action')  || null
  const outcome = url.searchParams.get('outcome') || null
  const since   = url.searchParams.get('since')   || null
  const until   = url.searchParams.get('until')   || null
  const q       = url.searchParams.get('q')?.trim() || null   // free-text search
  const format  = url.searchParams.get('format')  || 'json'
  const verify  = url.searchParams.get('verify')  === 'true'

  // Log audit log access (self-referential — only on first page, not paginated loads)
  // Use setImmediate so the audit event doesn't slow the response
  if (offset === 0) {
    const auditAction = format === 'csv' ? AUDIT.AUDIT_LOG_EXPORT : AUDIT.AUDIT_LOG_VIEW
    audit(req, { id: session.id, email: session.email, role: session.role }, auditAction, 'audit_log:access', 'success', {
      filters: { actor, action, outcome, since, until, format },
    })
  }

  const sql = getDb()

  // Build WHERE clause dynamically — avoids a combinatorial if/else explosion
  const conditions: string[] = []
  const values: unknown[] = []

  if (actor)   { conditions.push(`actor_email LIKE ?`);  values.push(`%${actor}%`) }
  if (action)  { conditions.push(`action = ?`);           values.push(action) }
  if (outcome) { conditions.push(`outcome = ?`);          values.push(outcome) }
  if (since)   { conditions.push(`timestamp >= ?`);       values.push(since) }
  if (until)   { conditions.push(`timestamp <= ?`);       values.push(until) }
  if (q) {
    // Free-text: match across email, action, resource, and detail (JSON blob)
    conditions.push(`(actor_email LIKE ? OR action LIKE ? OR resource LIKE ? OR detail LIKE ?)`)
    values.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const selectBase = `SELECT id, timestamp, actor_email, actor_ip, actor_role, action, resource, resource_id, outcome, detail FROM audit_events`

  // Dialect-agnostic filtered query + count (queryRaw converts ? -> $N on PG).
  const rows = await queryRaw(
    `${selectBase} ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
    [...values, limit, offset]
  ) as Record<string, unknown>[]
  const countRows = await queryRaw(
    `SELECT COUNT(*) as cnt FROM audit_events ${where}`,
    [...values]
  ) as { cnt: number | string }[]
  const total = Number(countRows[0]?.cnt || 0)

  // Verify chain integrity if requested
  let chainStatus: { valid: boolean; totalRows: number; brokenAt?: unknown } | null = null
  if (verify) {
    chainStatus = await verifyAuditChain()
  }

  // Available action types for filter dropdown
  const actionTypes = await sql`SELECT DISTINCT action FROM audit_events ORDER BY action ASC`

  if (format === 'csv') {
    const headers = ['id', 'timestamp', 'actor_email', 'actor_ip', 'actor_role', 'action', 'resource', 'outcome', 'detail']
    const csvRows = [headers.join(',')]
    for (const row of rows) {
      const values = headers.map(h => {
        const v = row[h]
        if (v == null) return ''
        const str = String(v).replace(/"/g, '""')
        return str.includes(',') || str.includes('"') || str.includes('\n') ? `"${str}"` : str
      })
      csvRows.push(values.join(','))
    }
    const csv = csvRows.join('\n')
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="mosaic-audit-${new Date().toISOString().slice(0,10)}.csv"`,
      },
    })
  }

  return Response.json({
    events: rows,
    total,
    limit,
    offset,
    hasMore: offset + rows.length < total,
    actionTypes: (actionTypes as { action: string }[]).map(r => r.action),
    chain: chainStatus,
    settings: offset === 0 ? await getAuditSettings() : undefined,
  })
}

// PATCH /api/audit — update retention policy
export async function PATCH(req: Request) {
  const session = await getSession()
  if (!session || session.role !== 'admin')
    return Response.json({ error: 'Admin only' }, { status: 403 })

  const { retention_days } = await req.json()
  if (!retention_days || isNaN(Number(retention_days)) || Number(retention_days) < 365) {
    return Response.json({ error: 'retention_days must be a number >= 365 (ISO 27001 minimum 1 year)' }, { status: 400 })
  }

  const sql = getDb()
  await sql`UPDATE audit_settings SET value = ${String(retention_days)}, updated_by = ${session.email}, updated_at = ${new Date().toISOString()} WHERE key = 'retention_days'`
  audit(req, { id: session.id, email: session.email, role: session.role }, AUDIT.SETTINGS_UPDATE, 'audit_settings:retention', 'success', { retention_days: Number(retention_days) })
  return Response.json({ ok: true, retention_days: Number(retention_days) })
}
