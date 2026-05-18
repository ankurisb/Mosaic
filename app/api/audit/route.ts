import { getSession } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { verifyAuditChain } from '@/lib/audit'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const session = await getSession()
  if (!session || session.role !== 'admin')
    return Response.json({ error: 'Admin only' }, { status: 403 })

  const url     = new URL(req.url)
  const limit   = Math.min(parseInt(url.searchParams.get('limit')   || '100'), 500)
  const offset  = parseInt(url.searchParams.get('offset')  || '0')
  const actor   = url.searchParams.get('actor')   || null   // email substring
  const action  = url.searchParams.get('action')  || null   // exact action
  const outcome = url.searchParams.get('outcome') || null   // success | failure | error
  const since   = url.searchParams.get('since')   || null   // ISO timestamp
  const until   = url.searchParams.get('until')   || null
  const format  = url.searchParams.get('format')  || 'json' // json | csv
  const verify  = url.searchParams.get('verify')  === 'true'

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
  })
}
