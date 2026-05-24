import { getSession } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { invalidateGuardrailCache } from '@/lib/guardrails'
import { audit, AUDIT } from '@/lib/audit'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  const sql = getDb()
  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type')

  if (type === 'settings') {
    const rows = await sql`SELECT key, value FROM guardrail_settings`
    const settings = Object.fromEntries(rows.map((r: Record<string,unknown>) => [r.key, r.value]))
    return Response.json({ settings })
  }
  if (type === 'ai_rules') {
    const rows = await sql`SELECT * FROM guardrail_ai_rules ORDER BY created_at ASC`
    return Response.json({ rules: rows })
  }
  if (type === 'data_access') {
    const rows = await sql`SELECT * FROM guardrail_data_access ORDER BY created_at ASC`
    return Response.json({ rules: rows })
  }
  if (type === 'actions') {
    const rows = await sql`SELECT * FROM guardrail_actions ORDER BY created_at ASC`
    return Response.json({ rules: rows })
  }
  if (type === 'usage_limits') {
    const rows = await sql`SELECT * FROM guardrail_usage_limits ORDER BY created_at ASC`
    return Response.json({ limits: rows })
  }
  if (type === 'content') {
    const rows = await sql`SELECT * FROM guardrail_content ORDER BY created_at ASC`
    return Response.json({ policies: rows })
  }
  if (type === 'egress') {
    const limit = parseInt(searchParams.get('limit') || '50')
    const rows = await sql`SELECT * FROM egress_events ORDER BY timestamp DESC LIMIT ${limit}`
    const summary = await sql`
      SELECT
        COUNT(*) as total_requests,
        COUNT(DISTINCT user_id) as unique_users,
        COALESCE(SUM(prompt_tokens + completion_tokens), 0) as total_tokens,
        SUM(web_search_used) as web_search_count
      FROM egress_events
      WHERE timestamp >= datetime('now', '-30 days')
    `
    return Response.json({ events: rows, summary: summary[0] })
  }
  if (type === 'pending_actions') {
    const rows = await sql`SELECT * FROM guardrail_pending_actions WHERE status = 'pending' ORDER BY created_at DESC LIMIT 50`
    return Response.json({ actions: rows })
  }

  // Return everything
  const [settings, aiRules, content, usageLimits] = await Promise.all([
    sql`SELECT key, value FROM guardrail_settings`,
    sql`SELECT * FROM guardrail_ai_rules ORDER BY created_at ASC`,
    sql`SELECT * FROM guardrail_content ORDER BY created_at ASC`,
    sql`SELECT * FROM guardrail_usage_limits ORDER BY created_at ASC`,
  ])
  return Response.json({
    settings: Object.fromEntries(settings.map((r: Record<string,unknown>) => [r.key, r.value])),
    ai_rules: aiRules,
    content_policies: content,
    usage_limits: usageLimits,
  })
}

export async function POST(req: Request) {
  const session = await getSession()
  if (!session || session.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 })
  const body = await req.json()
  const sql = getDb()
  const { action } = body

  // ── Settings ───────────────────────────────────────────────────────────────
  if (action === 'update_settings') {
    for (const [key, value] of Object.entries(body.settings as Record<string, string>)) {
      await sql`INSERT INTO guardrail_settings (key, value) VALUES (${key}, ${value})
        ON CONFLICT (key) DO UPDATE SET value = ${value}`
    }
    invalidateGuardrailCache()
    audit(req, { id: session.id, email: session.email, role: session.role }, AUDIT.GUARDRAIL_SETTINGS, 'guardrail:settings', 'success', { keys: Object.keys(body.settings) })
    return Response.json({ ok: true })
  }

  // ── AI Rules ───────────────────────────────────────────────────────────────
  if (action === 'save_ai_rules') {
    const { id, name, enabled, rules_text } = body
    if (id) {
      await sql`UPDATE guardrail_ai_rules SET name=${name}, enabled=${enabled?1:0}, rules_text=${rules_text}, updated_at=datetime('now') WHERE id=${id}`
      audit(req, { id: session.id, email: session.email, role: session.role }, AUDIT.GUARDRAIL_UPDATE, `guardrail_ai_rule:${id}`, 'success', { name, enabled })
    } else {
      const rows = await sql`INSERT INTO guardrail_ai_rules (name, enabled, rules_text) VALUES (${name||'Policy'}, ${enabled?1:0}, ${rules_text}) RETURNING id`
      audit(req, { id: session.id, email: session.email, role: session.role }, AUDIT.GUARDRAIL_CREATE, `guardrail_ai_rule:${rows[0]?.id}`, 'success', { name, enabled, type: 'ai_rules' })
    }
    invalidateGuardrailCache()
    return Response.json({ ok: true })
  }
  if (action === 'delete_ai_rules') {
    await sql`DELETE FROM guardrail_ai_rules WHERE id=${body.id}`
    invalidateGuardrailCache()
    audit(req, { id: session.id, email: session.email, role: session.role }, AUDIT.GUARDRAIL_DELETE, `guardrail_ai_rule:${body.id}`, 'success', {})
    return Response.json({ ok: true })
  }

  // ── Content ────────────────────────────────────────────────────────────────
  if (action === 'save_content') {
    const { id, name, enabled, mode, patterns, block_message } = body
    const patternsJson = JSON.stringify(Array.isArray(patterns) ? patterns : [])
    if (id) {
      await sql`UPDATE guardrail_content SET name=${name}, enabled=${enabled?1:0}, mode=${mode}, patterns=${patternsJson}, block_message=${block_message} WHERE id=${id}`
      audit(req, { id: session.id, email: session.email, role: session.role }, AUDIT.GUARDRAIL_UPDATE, `guardrail_content:${id}`, 'success', { name, enabled, mode })
    } else {
      const rows = await sql`INSERT INTO guardrail_content (name, enabled, mode, patterns, block_message) VALUES (${name||'Policy'}, ${enabled?1:0}, ${mode||'blocklist'}, ${patternsJson}, ${block_message||'This topic is restricted.'}) RETURNING id`
      audit(req, { id: session.id, email: session.email, role: session.role }, AUDIT.GUARDRAIL_CREATE, `guardrail_content:${rows[0]?.id}`, 'success', { name, enabled, mode, type: 'content' })
    }
    invalidateGuardrailCache()
    return Response.json({ ok: true })
  }
  if (action === 'delete_content') {
    await sql`DELETE FROM guardrail_content WHERE id=${body.id}`
    invalidateGuardrailCache()
    audit(req, { id: session.id, email: session.email, role: session.role }, AUDIT.GUARDRAIL_DELETE, `guardrail_content:${body.id}`, 'success', {})
    return Response.json({ ok: true })
  }

  // ── Data Access ────────────────────────────────────────────────────────────
  if (action === 'save_data_access') {
    const { id, role, source_id, source_type, allowed_tables, blocked_columns, row_filter, enabled } = body
    const at = JSON.stringify(Array.isArray(allowed_tables) ? allowed_tables : [])
    const bc = JSON.stringify(Array.isArray(blocked_columns) ? blocked_columns : [])
    if (id) {
      await sql`UPDATE guardrail_data_access SET role=${role}, source_id=${source_id||null}, source_type=${source_type}, allowed_tables=${at}, blocked_columns=${bc}, row_filter=${row_filter||''}, enabled=${enabled?1:0} WHERE id=${id}`
      audit(req, { id: session.id, email: session.email, role: session.role }, AUDIT.GUARDRAIL_UPDATE, `guardrail_data_access:${id}`, 'success', { role, source_type, enabled })
    } else {
      const rows = await sql`INSERT INTO guardrail_data_access (role, source_id, source_type, allowed_tables, blocked_columns, row_filter, enabled) VALUES (${role||'user'}, ${source_id||null}, ${source_type||'database'}, ${at}, ${bc}, ${row_filter||''}, ${enabled?1:0}) RETURNING id`
      audit(req, { id: session.id, email: session.email, role: session.role }, AUDIT.GUARDRAIL_CREATE, `guardrail_data_access:${rows[0]?.id}`, 'success', { role, source_type, type: 'data_access' })
    }
    invalidateGuardrailCache()
    return Response.json({ ok: true })
  }
  if (action === 'delete_data_access') {
    await sql`DELETE FROM guardrail_data_access WHERE id=${body.id}`
    invalidateGuardrailCache()
    audit(req, { id: session.id, email: session.email, role: session.role }, AUDIT.GUARDRAIL_DELETE, `guardrail_data_access:${body.id}`, 'success', {})
    return Response.json({ ok: true })
  }

  // ── Action Controls ────────────────────────────────────────────────────────
  if (action === 'save_action_control') {
    const { id, role, source_id, read_only, blocked_tools, allowed_methods, enabled } = body
    const bt = JSON.stringify(Array.isArray(blocked_tools) ? blocked_tools : [])
    const am = JSON.stringify(Array.isArray(allowed_methods) ? allowed_methods : ['GET','POST','PUT','PATCH','DELETE'])
    if (id) {
      await sql`UPDATE guardrail_actions SET role=${role}, source_id=${source_id||null}, read_only=${read_only?1:0}, blocked_tools=${bt}, allowed_methods=${am}, enabled=${enabled?1:0} WHERE id=${id}`
      audit(req, { id: session.id, email: session.email, role: session.role }, AUDIT.GUARDRAIL_UPDATE, `guardrail_action:${id}`, 'success', { role, read_only, enabled })
    } else {
      const rows = await sql`INSERT INTO guardrail_actions (role, source_id, read_only, blocked_tools, allowed_methods, enabled) VALUES (${role||'user'}, ${source_id||null}, ${read_only?1:0}, ${bt}, ${am}, ${enabled?1:0}) RETURNING id`
      audit(req, { id: session.id, email: session.email, role: session.role }, AUDIT.GUARDRAIL_CREATE, `guardrail_action:${rows[0]?.id}`, 'success', { role, read_only, type: 'action_control' })
    }
    invalidateGuardrailCache()
    return Response.json({ ok: true })
  }
  if (action === 'delete_action_control') {
    await sql`DELETE FROM guardrail_actions WHERE id=${body.id}`
    invalidateGuardrailCache()
    audit(req, { id: session.id, email: session.email, role: session.role }, AUDIT.GUARDRAIL_DELETE, `guardrail_action:${body.id}`, 'success', {})
    return Response.json({ ok: true })
  }

  // ── Usage Limits ───────────────────────────────────────────────────────────
  if (action === 'save_usage_limit') {
    const { id, role, user_id, daily_token_limit, monthly_token_limit, daily_request_limit, soft_warn_pct, enabled } = body
    if (id) {
      await sql`UPDATE guardrail_usage_limits SET role=${role}, user_id=${user_id||null}, daily_token_limit=${daily_token_limit||null}, monthly_token_limit=${monthly_token_limit||null}, daily_request_limit=${daily_request_limit||null}, soft_warn_pct=${soft_warn_pct||90}, enabled=${enabled?1:0} WHERE id=${id}`
      audit(req, { id: session.id, email: session.email, role: session.role }, AUDIT.GUARDRAIL_UPDATE, `guardrail_usage_limit:${id}`, 'success', { role, daily_token_limit, enabled })
    } else {
      const rows = await sql`INSERT INTO guardrail_usage_limits (role, user_id, daily_token_limit, monthly_token_limit, daily_request_limit, soft_warn_pct, enabled) VALUES (${role||'user'}, ${user_id||null}, ${daily_token_limit||null}, ${monthly_token_limit||null}, ${daily_request_limit||null}, ${soft_warn_pct||90}, ${enabled?1:0}) RETURNING id`
      audit(req, { id: session.id, email: session.email, role: session.role }, AUDIT.GUARDRAIL_CREATE, `guardrail_usage_limit:${rows[0]?.id}`, 'success', { role, type: 'usage_limit' })
    }
    return Response.json({ ok: true })
  }
  if (action === 'delete_usage_limit') {
    await sql`DELETE FROM guardrail_usage_limits WHERE id=${body.id}`
    audit(req, { id: session.id, email: session.email, role: session.role }, AUDIT.GUARDRAIL_DELETE, `guardrail_usage_limit:${body.id}`, 'success', {})
    return Response.json({ ok: true })
  }

  // ── Pending action resolution (HITL) ──────────────────────────────────────
  if (action === 'resolve_pending') {
    const { pending_id, approved } = body
    await sql`UPDATE guardrail_pending_actions SET status=${approved?'approved':'rejected'}, resolved_at=datetime('now') WHERE id=${pending_id}`
    audit(req, { id: session.id, email: session.email, role: session.role }, AUDIT.GUARDRAIL_UPDATE, `guardrail_pending:${pending_id}`, approved ? 'success' : 'failure', { approved })
    return Response.json({ ok: true })
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 })
}
