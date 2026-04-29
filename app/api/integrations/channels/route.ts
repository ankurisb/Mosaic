import { getSession } from '@/lib/auth'
import { getDb }      from '@/lib/db'
import { encrypt }    from '@/lib/encrypt'
export const runtime = 'nodejs'

// -- GET -- list all channels -----------------------------------
export async function GET() {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  const sql = getDb()
  const rows = await sql`
    SELECT id, name, type, active, config, created_at
    FROM   integration_channels
    ORDER  BY created_at ASC`
  // Mask secrets in JS so the query stays portable across SQLite + Neon
  // (Postgres jsonb_set is not supported by SQLite).
  const SECRET_KEYS = ['smtp_pass_enc', 'webhook_url', 'auth_token', 'api_key']
  const channels = (rows as Array<Record<string, unknown>>).map(r => {
    let config: Record<string, unknown> = {}
    try {
      config = typeof r.config === 'string' ? JSON.parse(r.config) : (r.config as Record<string, unknown>) || {}
    } catch { config = {} }
    const config_masked = { ...config }
    for (const k of SECRET_KEYS) {
      if (k in config_masked) config_masked[k] = '[hidden]'
    }
    return {
      id: r.id,
      name: r.name,
      type: r.type,
      active: r.active,
      created_at: r.created_at,
      config: config_masked,
    }
  })
  return Response.json({ channels })
}

// -- POST -- create / update / delete / test --------------------
export async function POST(req: Request) {
  const session = await getSession()
  if (!session || session.role !== 'admin')
    return Response.json({ error: 'Admin only' }, { status: 403 })

  const sql  = getDb()
  const body = await req.json()
  const { action } = body

  // -- CREATE ----------------------------------------------------
  if (action === 'create') {
    const { name, type, config } = body
    if (!name?.trim()) return Response.json({ error: 'Name required' }, { status: 400 })
    if (!type)         return Response.json({ error: 'Type required' }, { status: 400 })

    const safeConfig = buildConfig(type, config || {})
    const rows = await sql`
      INSERT INTO integration_channels (name, type, config, created_by)
      VALUES (${name.trim()}, ${type}, ${JSON.stringify(safeConfig)}, ${session.id})
      RETURNING id`
    return Response.json({ id: rows[0].id })
  }

  // -- UPDATE ----------------------------------------------------
  if (action === 'update') {
    const { id, name, type, config, active } = body
    if (!id) return Response.json({ error: 'ID required' }, { status: 400 })

    // Merge with existing config so we don't wipe secrets on partial update
    const existing = await sql`SELECT config FROM integration_channels WHERE id = ${id}`
    if (!existing.length) return Response.json({ error: 'Not found' }, { status: 404 })
    const existingConfig = existing[0].config as Record<string, unknown>
    const mergedConfig   = buildConfig(type, { ...existingConfig, ...(config || {}) })

    await sql`
      UPDATE integration_channels
      SET name = ${name?.trim() ?? ''}, type = ${type}, active = ${active ?? true},
          config = ${JSON.stringify(mergedConfig)}
      WHERE id = ${id}`
    return Response.json({ ok: true })
  }

  // -- DELETE ----------------------------------------------------
  if (action === 'delete') {
    if (!body.id) return Response.json({ error: 'ID required' }, { status: 400 })
    await sql`DELETE FROM integration_channels WHERE id = ${body.id}`
    return Response.json({ ok: true })
  }

  // -- TEST -- send a test notification --------------------------
  if (action === 'test') {
    const rows = await sql`SELECT * FROM integration_channels WHERE id = ${body.id}`
    if (!rows.length) return Response.json({ ok: false, error: 'Channel not found' })
    const raw = rows[0] as { id: string; name: string; type: string; config: unknown }
    const parsedConfig: Record<string, unknown> = typeof raw.config === 'string'
      ? (() => { try { return JSON.parse(raw.config as string) } catch { return {} } })()
      : (raw.config as Record<string, unknown>) || {}
    const channel = { ...raw, config: parsedConfig }
    const { sendNotification } = await import('@/lib/notify')
    const result = await sendNotification(channel, ` Test notification from Mosaic -- channel "${channel.name}" is working.`)
    return Response.json(result)
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 })
}

// -- Config builder -- encrypt secrets -------------------------
function buildConfig(type: string, raw: Record<string, unknown>): Record<string, unknown> {
  const cfg: Record<string, unknown> = {}
  if (type === 'slack' || type === 'teams') {
    if (raw.webhook_url) cfg.webhook_url = encrypt(String(raw.webhook_url))
  }
  if (type === 'webhook') {
    if (raw.url)     cfg.url     = String(raw.url)
    if (raw.headers) cfg.headers = raw.headers
  }
  if (type === 'email') {
    cfg.smtp_host    = raw.smtp_host    || ''
    cfg.smtp_port    = raw.smtp_port    || 587
    cfg.smtp_user    = raw.smtp_user    || ''
    cfg.from_address = raw.from_address || ''
    cfg.recipients   = raw.recipients   || []
    if (raw.smtp_pass) cfg.smtp_pass_enc = encrypt(String(raw.smtp_pass))
    else if (raw.smtp_pass_enc) cfg.smtp_pass_enc = raw.smtp_pass_enc
  }
  if (type === 'twilio_sms' || type === 'twilio_whatsapp') {
    cfg.account_sid  = raw.account_sid  || ''
    cfg.from_number  = raw.from_number  || ''
    cfg.to_number    = raw.to_number    || ''
    if (type === 'twilio_whatsapp') {
      cfg.template_sid       = raw.template_sid       || ''
      cfg.content_variables  = raw.content_variables  || {}
    }
    if (raw.auth_token)     cfg.auth_token_enc = encrypt(String(raw.auth_token))
    else if (raw.auth_token_enc) cfg.auth_token_enc = raw.auth_token_enc
  }
  return cfg
}
