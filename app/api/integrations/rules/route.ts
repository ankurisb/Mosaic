import { getSession } from '@/lib/auth'
import { getDb }      from '@/lib/db'
import { audit, AUDIT } from '@/lib/audit'
export const runtime = 'nodejs'

// -- GET -- list all rules with channel info --------------------
export async function GET() {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  const sql = getDb()
  const rows = await sql`
    SELECT r.id, r.name, r.active, r.trigger_type, r.source_type, r.source_id,
           r.query, r.saved_query_id, r.condition, r.message_template,
           r.last_run_at, r.next_run_at, r.created_at,
           r.channel_id, c.name AS channel_name, c.type AS channel_type
    FROM   integration_rules r
    JOIN   integration_channels c ON c.id = r.channel_id
    ORDER  BY r.created_at ASC`
  return Response.json({ rules: rows })
}

// -- POST -- create / update / delete / toggle ------------------
export async function POST(req: Request) {
  const session = await getSession()
  if (!session || session.role !== 'admin')
    return Response.json({ error: 'Admin only' }, { status: 403 })

  const sql  = getDb()
  const body = await req.json()
  const { action } = body

  // Threshold/schedule rules must reference a saved query (validated inline at
  // create/update). Legacy inline-source validation was removed in Step 3b.

  // -- CREATE ----------------------------------------------------
  if (action === 'create') {
    const {
      name, trigger_type, source_type, source_id,
      query, condition, channel_id, message_template, saved_query_id,
    } = body
    if (!name?.trim())        return Response.json({ error: 'Name required' },         { status: 400 })
    if (!trigger_type)        return Response.json({ error: 'Trigger type required' },  { status: 400 })
    if (!channel_id)          return Response.json({ error: 'Channel required' },       { status: 400 })
    // A saved query supplies the source + SQL. Threshold/schedule alerts now REQUIRE
    // one (inline SQL is no longer accepted for new alerts — Step 3b). rca_complete
    // needs no query.
    const needsQuery = trigger_type === 'threshold' || trigger_type === 'schedule'
    if (needsQuery && !saved_query_id) {
      return Response.json({ error: 'Select a saved query (create one in the Query Builder).' }, { status: 400 })
    }

    // Compute initial next_run_at for schedule rules
    const nextRun = computeNextRun(trigger_type, condition || {})

    const rows = await sql`
      INSERT INTO integration_rules
        (name, trigger_type, source_type, source_id, query, saved_query_id,
         condition, channel_id, message_template, next_run_at, created_by)
      VALUES
        (${name.trim()}, ${trigger_type}, ${source_type ?? 'query'}, ${source_id ?? null},
         ${query ?? null}, ${saved_query_id ?? null}, ${JSON.stringify(condition ?? {})}, ${channel_id},
         ${message_template ?? ''}, ${nextRun}, ${session.id})
      RETURNING id`
    audit(req, { id: session.id, email: session.email, role: session.role }, AUDIT.RULE_CREATE, `integration_rule:${rows[0].id}`, 'success', { name: name.trim(), trigger_type, channel_id })
    return Response.json({ id: rows[0].id })
  }

  // -- UPDATE ----------------------------------------------------
  if (action === 'update') {
    const {
      id, name, active, trigger_type, source_type, source_id,
      query, condition, channel_id, message_template,
    } = body
    if (!id) return Response.json({ error: 'ID required' }, { status: 400 })
    const needsQ = trigger_type === 'threshold' || trigger_type === 'schedule'
    if (needsQ && !body.saved_query_id) {
      return Response.json({ error: 'Select a saved query (create one in the Query Builder).' }, { status: 400 })
    }
    const nextRun = computeNextRun(trigger_type, condition || {})
    await sql`
      UPDATE integration_rules SET
        name             = ${name?.trim() ?? ''},
        active           = ${active ?? true},
        trigger_type     = ${trigger_type},
        source_type      = ${source_type ?? 'query'},
        source_id        = ${source_id ?? null},
        query            = ${query ?? null},
        saved_query_id   = ${body.saved_query_id ?? null},
        condition        = ${JSON.stringify(condition ?? {})},
        channel_id       = ${channel_id},
        message_template = ${message_template ?? ''},
        next_run_at      = ${nextRun}
      WHERE id = ${id}`
    audit(req, { id: session.id, email: session.email, role: session.role }, AUDIT.RULE_UPDATE, `integration_rule:${id}`, 'success', { name: name?.trim(), trigger_type, active })
    return Response.json({ ok: true })
  }

  // -- DELETE ----------------------------------------------------
  if (action === 'delete') {
    if (!body.id) return Response.json({ error: 'ID required' }, { status: 400 })
    await sql`DELETE FROM integration_rules WHERE id = ${body.id}`
    audit(req, { id: session.id, email: session.email, role: session.role }, AUDIT.RULE_DELETE, `integration_rule:${body.id}`, 'success', {})
    return Response.json({ ok: true })
  }

  // -- TOGGLE ACTIVE ---------------------------------------------
  if (action === 'toggle') {
    if (!body.id) return Response.json({ error: 'ID required' }, { status: 400 })
    await sql`UPDATE integration_rules SET active = NOT active WHERE id = ${body.id}`
    audit(req, { id: session.id, email: session.email, role: session.role }, AUDIT.RULE_TOGGLE, `integration_rule:${body.id}`, 'success', {})
    return Response.json({ ok: true })
  }

  // -- GET RECENT RUNS -------------------------------------------
  if (action === 'get_runs') {
    const runs = await sql`
      SELECT id, triggered_at, status, value_snapshot, message_sent, error, latency_ms
      FROM   integration_runs
      WHERE  rule_id = ${body.rule_id}
      ORDER  BY triggered_at DESC
      LIMIT  20`
    return Response.json({ runs })
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 })
}

// -- Helper -- compute next_run_at from condition ---------------
function computeNextRun(
  triggerType: string,
  condition: Record<string, unknown>
): string | null {
  if (triggerType === 'threshold' || triggerType === 'rca_complete') {
    // These run on the scheduler's tick -- set to now so they fire on next check
    return new Date().toISOString()
  }
  if (triggerType === 'schedule') {
    const intervalSec = Number(condition.interval_sec || 3600)
    return new Date(Date.now() + intervalSec * 1000).toISOString()
  }
  return null
}
