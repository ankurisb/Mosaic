import { getSession } from '@/lib/auth'
import { getDb }      from '@/lib/db'
export const runtime = 'nodejs'

// -- GET -- list all rules with channel info --------------------
export async function GET() {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  const sql = getDb()
  const rows = await sql`
    SELECT r.id, r.name, r.active, r.trigger_type, r.source_type, r.source_id,
           r.query, r.condition, r.message_template,
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

  // -- Source validation (shared by create + update) -------------
  // Threshold and schedule rules MUST have a valid source bound; otherwise
  // the scheduler silently skips them (see app/api/integrations/scheduler/route.ts).
  // rca_complete rules don't run a query, so they're exempt.
  const VALID_SOURCE_TYPES = ['database', 'api', 'file_server'] as const
  function validateSource(triggerType: string, srcType: unknown, srcId: unknown, q: unknown) {
    if (triggerType !== 'threshold' && triggerType !== 'schedule') return null
    if (!srcId || typeof srcId !== 'string' || !srcId.trim()) {
      return 'Source is required for threshold and schedule rules'
    }
    if (!srcType || !VALID_SOURCE_TYPES.includes(srcType as typeof VALID_SOURCE_TYPES[number])) {
      return `Source type must be one of: ${VALID_SOURCE_TYPES.join(', ')}`
    }
    if (!q || typeof q !== 'string' || !q.trim()) {
      return 'Query is required for threshold and schedule rules'
    }
    return null
  }

  // -- CREATE ----------------------------------------------------
  if (action === 'create') {
    const {
      name, trigger_type, source_type, source_id,
      query, condition, channel_id, message_template,
    } = body
    if (!name?.trim())        return Response.json({ error: 'Name required' },         { status: 400 })
    if (!trigger_type)        return Response.json({ error: 'Trigger type required' },  { status: 400 })
    if (!channel_id)          return Response.json({ error: 'Channel required' },       { status: 400 })
    const srcErr = validateSource(trigger_type, source_type, source_id, query)
    if (srcErr) return Response.json({ error: srcErr }, { status: 400 })

    // Compute initial next_run_at for schedule rules
    const nextRun = computeNextRun(trigger_type, condition || {})

    const rows = await sql`
      INSERT INTO integration_rules
        (name, trigger_type, source_type, source_id, query,
         condition, channel_id, message_template, next_run_at, created_by)
      VALUES
        (${name.trim()}, ${trigger_type}, ${source_type ?? 'query'}, ${source_id ?? null},
         ${query ?? null}, ${JSON.stringify(condition ?? {})}, ${channel_id},
         ${message_template ?? ''}, ${nextRun}, ${session.id})
      RETURNING id`
    return Response.json({ id: rows[0].id })
  }

  // -- UPDATE ----------------------------------------------------
  if (action === 'update') {
    const {
      id, name, active, trigger_type, source_type, source_id,
      query, condition, channel_id, message_template,
    } = body
    if (!id) return Response.json({ error: 'ID required' }, { status: 400 })
    const srcErr = validateSource(trigger_type, source_type, source_id, query)
    if (srcErr) return Response.json({ error: srcErr }, { status: 400 })
    const nextRun = computeNextRun(trigger_type, condition || {})
    await sql`
      UPDATE integration_rules SET
        name             = ${name?.trim() ?? ''},
        active           = ${active ?? true},
        trigger_type     = ${trigger_type},
        source_type      = ${source_type ?? 'query'},
        source_id        = ${source_id ?? null},
        query            = ${query ?? null},
        condition        = ${JSON.stringify(condition ?? {})},
        channel_id       = ${channel_id},
        message_template = ${message_template ?? ''},
        next_run_at      = ${nextRun}
      WHERE id = ${id}`
    return Response.json({ ok: true })
  }

  // -- DELETE ----------------------------------------------------
  if (action === 'delete') {
    if (!body.id) return Response.json({ error: 'ID required' }, { status: 400 })
    await sql`DELETE FROM integration_rules WHERE id = ${body.id}`
    return Response.json({ ok: true })
  }

  // -- TOGGLE ACTIVE ---------------------------------------------
  if (action === 'toggle') {
    if (!body.id) return Response.json({ error: 'ID required' }, { status: 400 })
    await sql`UPDATE integration_rules SET active = NOT active WHERE id = ${body.id}`
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
