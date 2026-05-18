import { getSession } from '@/lib/auth'
import { getDb } from '@/lib/db'
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

  // Build query with optional filters
  // SQLite doesn't support parameterised LIKE in all drivers — use conditional approach
  let rows: Record<string, unknown>[]

  if (actor && action && outcome && since && until) {
    rows = await sql`SELECT id, timestamp, actor_email, actor_ip, actor_role, action, resource, resource_id, outcome, detail FROM audit_events WHERE actor_email LIKE ${'%' + actor + '%'} AND action = ${action} AND outcome = ${outcome} AND timestamp >= ${since} AND timestamp <= ${until} ORDER BY timestamp DESC LIMIT ${limit} OFFSET ${offset}`
  } else if (actor && action && since) {
    rows = await sql`SELECT id, timestamp, actor_email, actor_ip, actor_role, action, resource, resource_id, outcome, detail FROM audit_events WHERE actor_email LIKE ${'%' + actor + '%'} AND action = ${action} AND timestamp >= ${since} ORDER BY timestamp DESC LIMIT ${limit} OFFSET ${offset}`
  } else if (actor && since) {
    rows = await sql`SELECT id, timestamp, actor_email, actor_ip, actor_role, action, resource, resource_id, outcome, detail FROM audit_events WHERE actor_email LIKE ${'%' + actor + '%'} AND timestamp >= ${since} ORDER BY timestamp DESC LIMIT ${limit} OFFSET ${offset}`
  } else if (action && since) {
    rows = await sql`SELECT id, timestamp, actor_email, actor_ip, actor_role, action, resource, resource_id, outcome, detail FROM audit_events WHERE action = ${action} AND timestamp >= ${since} ORDER BY timestamp DESC LIMIT ${limit} OFFSET ${offset}`
  } else if (actor && action) {
    rows = await sql`SELECT id, timestamp, actor_email, actor_ip, actor_role, action, resource, resource_id, outcome, detail FROM audit_events WHERE actor_email LIKE ${'%' + actor + '%'} AND action = ${action} ORDER BY timestamp DESC LIMIT ${limit} OFFSET ${offset}`
  } else if (actor) {
    rows = await sql`SELECT id, timestamp, actor_email, actor_ip, actor_role, action, resource, resource_id, outcome, detail FROM audit_events WHERE actor_email LIKE ${'%' + actor + '%'} ORDER BY timestamp DESC LIMIT ${limit} OFFSET ${offset}`
  } else if (action) {
    rows = await sql`SELECT id, timestamp, actor_email, actor_ip, actor_role, action, resource, resource_id, outcome, detail FROM audit_events WHERE action = ${action} ORDER BY timestamp DESC LIMIT ${limit} OFFSET ${offset}`
  } else if (outcome) {
    rows = await sql`SELECT id, timestamp, actor_email, actor_ip, actor_role, action, resource, resource_id, outcome, detail FROM audit_events WHERE outcome = ${outcome} ORDER BY timestamp DESC LIMIT ${limit} OFFSET ${offset}`
  } else if (since) {
    rows = await sql`SELECT id, timestamp, actor_email, actor_ip, actor_role, action, resource, resource_id, outcome, detail FROM audit_events WHERE timestamp >= ${since} ORDER BY timestamp DESC LIMIT ${limit} OFFSET ${offset}`
  } else {
    rows = await sql`SELECT id, timestamp, actor_email, actor_ip, actor_role, action, resource, resource_id, outcome, detail FROM audit_events ORDER BY timestamp DESC LIMIT ${limit} OFFSET ${offset}`
  }

  const totalRows = await sql`SELECT COUNT(*) as cnt FROM audit_events`
  const total = Number((totalRows[0] as { cnt: string })?.cnt || 0)

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
