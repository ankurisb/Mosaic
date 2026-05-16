import { getDb } from './db'
import bcrypt from 'bcryptjs'

let done = false

export async function setupDatabase() {
  if (done) return
  const sql = getDb()

  // -- Core auth tables ------------------------------------------
  await sql`CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
    email         TEXT UNIQUE NOT NULL,
    name          TEXT NOT NULL DEFAULT '',
    password_hash TEXT,
    role          TEXT NOT NULL DEFAULT 'user',
    banned        INTEGER DEFAULT 0,
    sso_provider  TEXT,
    sso_sub       TEXT,
    created_at    TEXT DEFAULT (datetime('now'))
  )`

  await sql`CREATE TABLE IF NOT EXISTS sso_config (
    id          TEXT PRIMARY KEY DEFAULT 'default',
    provider    TEXT NOT NULL,
    client_id   TEXT NOT NULL,
    client_secret TEXT NOT NULL,
    tenant_id   TEXT,
    enabled     INTEGER DEFAULT 1,
    created_at  TEXT DEFAULT (datetime('now'))
  )`

  await sql`CREATE TABLE IF NOT EXISTS smtp_config (
    id           TEXT PRIMARY KEY DEFAULT 'default',
    host         TEXT NOT NULL,
    port         INTEGER NOT NULL DEFAULT 587,
    username     TEXT,
    password_enc TEXT,
    from_address TEXT NOT NULL,
    from_name    TEXT NOT NULL DEFAULT 'Mosaic',
    enabled      INTEGER DEFAULT 1,
    created_at   TEXT DEFAULT (datetime('now'))
  )`

  await sql`CREATE TABLE IF NOT EXISTS smtp_config (
    id           TEXT PRIMARY KEY DEFAULT 'default',
    host         TEXT NOT NULL,
    port         INTEGER NOT NULL DEFAULT 587,
    username     TEXT,
    password_enc TEXT,
    from_address TEXT NOT NULL,
    from_name    TEXT NOT NULL DEFAULT 'Mosaic',
    enabled      INTEGER DEFAULT 1,
    created_at   TEXT DEFAULT (datetime('now'))
  )`

  // Migrations: add SSO columns to existing users table
  // SQLite doesn't support IF NOT EXISTS on ALTER TABLE — use .catch() to ignore "duplicate column" errors
  await sql`ALTER TABLE users ADD COLUMN sso_provider TEXT`.catch((e: unknown) => {
    if (!String(e).includes('duplicate column')) throw e
  })
  await sql`ALTER TABLE users ADD COLUMN sso_sub TEXT`.catch((e: unknown) => {
    if (!String(e).includes('duplicate column')) throw e
  })
  await sql`ALTER TABLE users ADD COLUMN invite_sent_at TEXT`.catch((e: unknown) => {
    if (!String(e).includes('duplicate column')) throw e
  })
  await sql`ALTER TABLE users ADD COLUMN last_login_at TEXT`.catch((e: unknown) => {
    if (!String(e).includes('duplicate column')) throw e
  })
  await sql`ALTER TABLE users ADD COLUMN invite_sent_at TEXT`.catch((e: unknown) => {
    if (!String(e).includes('duplicate column')) throw e
  })
  await sql`ALTER TABLE users ADD COLUMN last_login_at TEXT`.catch((e: unknown) => {
    if (!String(e).includes('duplicate column')) throw e
  })

  await sql`CREATE TABLE IF NOT EXISTS conversations (
    id         TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      TEXT NOT NULL DEFAULT 'New conversation',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`

  await sql`CREATE TABLE IF NOT EXISTS messages (
    id              TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role            TEXT NOT NULL,
    content         TEXT NOT NULL DEFAULT '',
    tool_calls      TEXT,
    rca_block       TEXT,
    created_at      TEXT DEFAULT (datetime('now'))
  )`
  await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS tool_calls TEXT`.catch(() => {})
  await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS rca_block  TEXT`.catch(() => {})

  // -- Database connections --------------------------------------
  await sql`CREATE TABLE IF NOT EXISTS db_connections (
    id                  TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
    label               TEXT NOT NULL,
    dialect             TEXT NOT NULL DEFAULT 'postgres',
    environment         TEXT NOT NULL DEFAULT 'development',
    host                TEXT,
    port                INTEGER DEFAULT 5432,
    database_name       TEXT,
    username            TEXT,
    password_enc        TEXT,
    connection_string   TEXT,
    schema_name         TEXT DEFAULT 'public',
    ssl_mode            TEXT DEFAULT 'prefer',
    ssl_ca              TEXT,
    pool_min            INTEGER DEFAULT 1,
    pool_max            INTEGER DEFAULT 5,
    connect_timeout_ms  INTEGER DEFAULT 5000,
    query_timeout_ms    INTEGER DEFAULT 30000,
    read_only           INTEGER DEFAULT 0,
    mcp_endpoint        TEXT,
    mcp_token           TEXT,
    created_at          TEXT DEFAULT (datetime('now'))
  )`
  await sql`ALTER TABLE db_connections ADD COLUMN IF NOT EXISTS mcp_endpoint TEXT`.catch(() => {})
  await sql`ALTER TABLE db_connections ADD COLUMN IF NOT EXISTS mcp_token           TEXT`.catch(() => {})
  await sql`ALTER TABLE db_connections ADD COLUMN IF NOT EXISTS full_text_search    INTEGER DEFAULT 0`.catch(() => {})
  await sql`ALTER TABLE db_connections ADD COLUMN IF NOT EXISTS fts_airbyte_conn_id TEXT`.catch(() => {})
  await sql`ALTER TABLE db_connections ADD COLUMN IF NOT EXISTS description         TEXT`.catch(() => {})

  // -- Auto-register internal Elasticsearch (Mosaic Search Index) --------
  // If ELASTICSEARCH_INTERNAL_URL is set (Docker Compose deployment),
  // upsert a db_connections row for it. Idempotent — safe on every boot.
  // The connection is marked with label 'Mosaic Search Index' and is
  // never shown in the admin delete flow (managed = 1).
  await sql`ALTER TABLE db_connections ADD COLUMN IF NOT EXISTS managed INTEGER DEFAULT 0`.catch(() => {})
  const esUrl = process.env.ELASTICSEARCH_INTERNAL_URL
  if (esUrl) {
    const existing = await sql`SELECT id FROM db_connections WHERE managed = 1 AND dialect = 'elasticsearch' LIMIT 1`
    if (!existing.length) {
      await sql`
        INSERT INTO db_connections
          (label, dialect, environment, host, port, database_name, ssl_mode, read_only, managed, description)
        VALUES
          ('Mosaic Search Index', 'elasticsearch', 'production',
           'elasticsearch', 9200, '_all', 'disable', 1, 1,
           'Internal full-text search index. Fed by Airbyte syncs from connected data sources. Use for searching technician notes, fault descriptions, and shift narratives.')
      `
    } else {
      // Update host/port in case the URL changed
      await sql`
        UPDATE db_connections
        SET host = 'elasticsearch', port = 9200, description = 'Internal full-text search index. Fed by Airbyte syncs from connected data sources. Use for searching technician notes, fault descriptions, and shift narratives.'
        WHERE managed = 1 AND dialect = 'elasticsearch'
      `
    }
  }

  // -- API services + connections --------------------------------
  await sql`CREATE TABLE IF NOT EXISTS api_services (
    id                  TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
    label               TEXT NOT NULL,
    base_url            TEXT NOT NULL,
    environment         TEXT NOT NULL DEFAULT 'production',
    auth_type           TEXT NOT NULL DEFAULT 'bearer',
    auth_config         TEXT NOT NULL DEFAULT '{}',
    default_headers     TEXT DEFAULT '{}',
    api_version         TEXT,
    version_header      TEXT,
    rate_limit_rpm      INT,
    connect_timeout_ms  INTEGER DEFAULT 5000,
    request_timeout_ms  INTEGER DEFAULT 30000,
    retry_count         INTEGER DEFAULT 3,
    created_at          TEXT DEFAULT (datetime('now'))
  )`
  await sql`ALTER TABLE api_services ADD COLUMN IF NOT EXISTS auth_status     TEXT DEFAULT 'unknown'`.catch(() => {})
  await sql`ALTER TABLE api_services ADD COLUMN IF NOT EXISTS last_auth_error TEXT`.catch(() => {})
  await sql`ALTER TABLE api_services ADD COLUMN IF NOT EXISTS last_auth_check INTEGER`.catch(() => {})

  await sql`CREATE TABLE IF NOT EXISTS api_connections (
    id                      TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
    service_id              TEXT NOT NULL REFERENCES api_services(id) ON DELETE CASCADE,
    label                   TEXT NOT NULL,
    description             TEXT,
    base_path               TEXT,
    pagination_style        TEXT DEFAULT 'none',
    pagination_limit_param  TEXT DEFAULT 'limit',
    pagination_cursor_param TEXT DEFAULT 'cursor',
    pagination_data_path    TEXT,
    auth_override           INTEGER DEFAULT 0,
    auth_config             TEXT,
    created_at              TEXT DEFAULT (datetime('now'))
  )`

  // -- Usage events ----------------------------------------------
  await sql`CREATE TABLE IF NOT EXISTS usage_events (
    id            TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
    user_id       TEXT NOT NULL,
    user_email    TEXT,
    type          TEXT NOT NULL,
    model         TEXT,
    input_tokens  INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    cost_usd      NUMERIC(10,6) DEFAULT 0,
    latency_ms    INT,
    created_at    TEXT DEFAULT (datetime('now'))
  )`

  // -- File server connections -----------------------------------
  await sql`CREATE TABLE IF NOT EXISTS file_servers (
    id                    TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
    label                 TEXT NOT NULL,
    transport             TEXT NOT NULL DEFAULT 'smb',
    environment           TEXT NOT NULL DEFAULT 'production',
    host                  TEXT,
    port                  INT,
    share_path            TEXT,
    sub_path              TEXT,
    username              TEXT,
    password_enc          TEXT,
    ssh_key_enc           TEXT,
    bucket                TEXT,
    endpoint_url          TEXT,
    access_key_id         TEXT,
    secret_key_enc        TEXT,
    file_types            TEXT NOT NULL DEFAULT 'csv,xlsx,pdf',
    poll_interval_sec     INTEGER NOT NULL DEFAULT 60,
    max_files             INTEGER NOT NULL DEFAULT 20,
    max_rows              INTEGER NOT NULL DEFAULT 500,
    filename_date_pattern TEXT,
    ts_strategy           TEXT NOT NULL DEFAULT 'auto',
    created_at            TEXT DEFAULT (datetime('now'))
  )`


  // -- Analytics dashboards --------------------------------------
  await sql`CREATE TABLE IF NOT EXISTS dashboards (
    id          TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_public   INTEGER NOT NULL DEFAULT 0,
    refresh_sec INTEGER NOT NULL DEFAULT 300,
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
  )`

  await sql`CREATE TABLE IF NOT EXISTS dashboard_panels (
    id           TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
    dashboard_id TEXT NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    subtitle     TEXT NOT NULL DEFAULT '',
    source_type  TEXT NOT NULL DEFAULT 'database',
    source_id    TEXT NOT NULL,
    query        TEXT NOT NULL DEFAULT '',
    chart_type   TEXT NOT NULL DEFAULT 'bar',
    chart_config TEXT NOT NULL DEFAULT '{}',
    refresh_sec  INT,
    col          INTEGER NOT NULL DEFAULT 0,
    row          INTEGER NOT NULL DEFAULT 0,
    w            INTEGER NOT NULL DEFAULT 2,
    h            INTEGER NOT NULL DEFAULT 1,
    sort_order   INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT DEFAULT (datetime('now'))
  )`

  await sql`CREATE INDEX IF NOT EXISTS idx_dashboards_owner ON dashboards(owner_id, updated_at DESC)`.catch(() => {})
  await sql`CREATE INDEX IF NOT EXISTS idx_panels_dashboard ON dashboard_panels(dashboard_id, sort_order)`.catch(() => {})
  await sql`ALTER TABLE dashboards ADD COLUMN superset_embed_uuid TEXT`.catch(() => {})



  // -- Notification recipient groups ----------------------------
  await sql`CREATE TABLE IF NOT EXISTS notification_groups (
    id          TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    members     TEXT NOT NULL DEFAULT '[]',
    created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at  TEXT DEFAULT (datetime('now'))
  )`


  // -- Rule groups -----------------------------------------------
  await sql`CREATE TABLE IF NOT EXISTS rule_groups (
    id               TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
    name             TEXT NOT NULL,
    description      TEXT NOT NULL DEFAULT '',
    active           INTEGER NOT NULL DEFAULT true,
    logic            TEXT NOT NULL DEFAULT 'OR',
    trigger          TEXT NOT NULL DEFAULT '{}',
    conditions       TEXT NOT NULL DEFAULT '[]',
    controls         TEXT NOT NULL DEFAULT '{}',
    actions          TEXT NOT NULL DEFAULT '[]',
    recipients       TEXT NOT NULL DEFAULT '[]',
    message_template TEXT NOT NULL DEFAULT '',
    last_fired_at    TEXT,
    fire_count_today INTEGER NOT NULL DEFAULT 0,
    created_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at       TEXT DEFAULT (datetime('now')),
    updated_at       TEXT DEFAULT (datetime('now'))
  )`

  await sql`CREATE INDEX IF NOT EXISTS idx_rule_groups_active ON rule_groups(active, updated_at DESC)`.catch(() => {})
  await sql`ALTER TABLE rule_groups ADD COLUMN email_channel_id TEXT`.catch(() => {})
  await sql`ALTER TABLE rule_groups ADD COLUMN sms_channel_id   TEXT`.catch(() => {})

  // -- Integration channels --------------------------------------
  await sql`CREATE TABLE IF NOT EXISTS integration_channels (
    id         TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
    name       TEXT NOT NULL,
    type       TEXT NOT NULL,   -- 'slack' | 'teams' | 'email' | 'webhook'
    config     TEXT NOT NULL DEFAULT '{}',
    active     INTEGER NOT NULL DEFAULT true,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`

  // -- Integration rules -----------------------------------------
  await sql`CREATE TABLE IF NOT EXISTS integration_rules (
    id               TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
    name             TEXT NOT NULL,
    active           INTEGER NOT NULL DEFAULT true,
    trigger_type     TEXT NOT NULL,   -- 'threshold' | 'schedule' | 'rca_complete'
    source_type      TEXT NOT NULL,   -- 'dashboard_panel' | 'query' | 'rca'
    source_id        TEXT,
    query            TEXT,
    condition        TEXT NOT NULL DEFAULT '{}',
    channel_id       TEXT NOT NULL REFERENCES integration_channels(id) ON DELETE CASCADE,
    message_template TEXT NOT NULL DEFAULT '',
    last_run_at      TEXT,
    next_run_at      TEXT,
    created_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at       TEXT DEFAULT (datetime('now'))
  )`

  // -- Integration run log ---------------------------------------
  await sql`CREATE TABLE IF NOT EXISTS integration_runs (
    id              TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
    rule_id         TEXT NOT NULL REFERENCES integration_rules(id) ON DELETE CASCADE,
    triggered_at    TEXT DEFAULT (datetime('now')),
    status          TEXT NOT NULL,   -- 'sent' | 'skipped' | 'error'
    value_snapshot  TEXT,
    message_sent    TEXT,
    error           TEXT,
    latency_ms      INT
  )`

  await sql`CREATE INDEX IF NOT EXISTS idx_rules_next_run   ON integration_rules(next_run_at) WHERE active = 1`.catch(() => {})
  await sql`CREATE INDEX IF NOT EXISTS idx_runs_rule        ON integration_runs(rule_id, triggered_at DESC)`.catch(() => {})

  // -- RCA workflow templates ------------------------------------
  await sql`CREATE TABLE IF NOT EXISTS rca_workflows (
    id            TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
    name          TEXT NOT NULL,
    description   TEXT NOT NULL DEFAULT '',
    problem_type  TEXT NOT NULL DEFAULT 'quality_defect',
    active        INTEGER NOT NULL DEFAULT true,
    color         TEXT NOT NULL DEFAULT '#2563eb',
    keywords      TEXT NOT NULL DEFAULT '[]',
    data_steps    TEXT NOT NULL DEFAULT '[]',
    renderers     TEXT NOT NULL DEFAULT '[]',
    output_config TEXT NOT NULL DEFAULT '{}',
    sort_order    INTEGER NOT NULL DEFAULT 0,
    created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at    TEXT DEFAULT (datetime('now')),
    updated_at    TEXT DEFAULT (datetime('now'))
  )`

  // Seed 4 default templates on first deploy
  const wfCount = await sql`SELECT COUNT(*) as cnt FROM rca_workflows`
  if (Number((wfCount[0] as { cnt: string })?.cnt || 0) === 0) {
    const defaults = [
      {
        name: 'Quality Defect RCA',
        description: 'Dimensional, visual, or functional rejection -- traces causes through 6M categories.',
        problem_type: 'quality_defect', active: 1, color: '#c0392b', sort_order: 1,
        keywords: ['defect','rejection','out of tolerance','scrap','rework','quality issue','dimensional','fail'],
        data_steps: [
          { n:1, source_type:'database',    source_label:'ClickHouse (defect_log)',     query_hint:"SELECT 6m_category, sub_cause, count(*) FROM defect_log WHERE batch=? GROUP BY 1,2", required:true,  fallback:'skip' },
          { n:2, source_type:'api',         source_label:'SAP QM . inspection_lots',   query_hint:"$filter=Batch eq '{batch}' and Plant eq '{plant}'&$format=json",                     required:true,  fallback:'skip' },
          { n:3, source_type:'api',         source_label:'SAP PM . maintenance_notifs',query_hint:"$filter=Equipment eq '{gauge_id}'&$format=json",                                     required:false, fallback:'skip' },
          { n:4, source_type:'file_server', source_label:'Shift log CSV',              query_hint:'Latest shift report matching date of event',                                         required:false, fallback:'skip' },
          { n:5, source_type:'database',    source_label:"InfluxDB . spindle_temp",    query_hint:"SELECT mean(temp) FROM spindle WHERE time > '{event_time}'-4h",                     required:false, fallback:'skip' },
        ],
        renderers: [
          { type:'pareto',    label:' Pareto',    required:true,  order:1 },
          { type:'fishbone',  label:' Fishbone',  required:true,  order:2 },
          { type:'subcause',  label:' Sub-cause', required:false, order:3 },
          { type:'five_whys', label:' 5 Whys',    required:true,  order:4 },
          { type:'spc',       label:' SPC',       required:false, order:5 },
          { type:'cap',       label:' CAP',       required:true,  order:6 },
        ],
        output_config: { title:'RCA . Quality Defect . {machine} . {date}', export:'word', save_db:true },
      },
      {
        name: 'Machine Downtime RCA',
        description: 'Unplanned stop or breakdown -- reconstructs the event sequence and traces maintenance history.',
        problem_type: 'machine_downtime', active: 1, color: '#c45c1a', sort_order: 2,
        keywords: ['downtime','breakdown','machine stopped','unplanned stop','failure','fault','alarm'],
        data_steps: [
          { n:1, source_type:'database', source_label:'InfluxDB . machine_events',      query_hint:"SELECT * FROM machine_events WHERE machine='{machine}' AND time > '{event_time}'-2h", required:true,  fallback:'warn' },
          { n:2, source_type:'api',      source_label:'SAP PM . maintenance_notifs',    query_hint:"$filter=Equipment eq '{machine_id}' and NotifType eq 'M1'&$top=10&$format=json",    required:true,  fallback:'skip' },
          { n:3, source_type:'api',      source_label:'SAP Equipment . history',        query_hint:"$filter=Equipment eq '{machine_id}'&$orderby=MaintenanceDate desc&$top=5",          required:false, fallback:'skip' },
          { n:4, source_type:'file_server', source_label:'Shift log CSV',              query_hint:'Operator shift log for date of event',                                               required:false, fallback:'skip' },
        ],
        renderers: [
          { type:'timeline',   label:' Timeline',   required:true,  order:1 },
          { type:'fault_tree', label:' Fault tree', required:false, order:2 },
          { type:'five_whys',  label:' 5 Whys',     required:true,  order:3 },
          { type:'cap',        label:' CAP',        required:true,  order:4 },
        ],
        output_config: { title:'RCA . Downtime . {machine} . {date}', export:'word', save_db:true },
      },
      {
        name: 'OEE Drop Analysis',
        description: 'Availability, performance, or quality degradation -- identifies which pillar is driving the loss.',
        problem_type: 'oee_drop', active: 1, color: '#1d4e89', sort_order: 3,
        keywords: ['oee','oee drop','availability','performance loss','throughput','cycle time','overall equipment'],
        data_steps: [
          { n:1, source_type:'database', source_label:'ClickHouse . oee_weekly',      query_hint:'SELECT week, avg(oee_pct), avg(availability), avg(performance), avg(quality) FROM oee_weekly WHERE machine=? ORDER BY week DESC LIMIT 8', required:true,  fallback:'warn' },
          { n:2, source_type:'database', source_label:'ClickHouse . downtime_log',    query_hint:'SELECT reason, sum(duration_min) FROM downtime_log WHERE machine=? AND date >= ? GROUP BY 1 ORDER BY 2 DESC',                             required:true,  fallback:'skip' },
          { n:3, source_type:'api',      source_label:'SAP Production Orders',        query_hint:"$filter=Plant eq '{plant}' and MfgOrderScheduledStartDate ge '{date}'&$format=json",                                                     required:false, fallback:'skip' },
          { n:4, source_type:'database', source_label:'InfluxDB . OEE_hourly',        query_hint:"SELECT mean(oee_pct) FROM oee_hourly WHERE machine='{machine}' AND time > datetime('now')-7d GROUP BY time(1h)",                                    required:false, fallback:'skip' },
        ],
        renderers: [
          { type:'trend',      label:' Trend',      required:true,  order:1 },
          { type:'pareto',     label:' Pareto',     required:true,  order:2 },
          { type:'comparison', label:' Comparison', required:false, order:3 },
          { type:'cap',        label:' CAP',        required:true,  order:4 },
        ],
        output_config: { title:'OEE Analysis . {machine} . {period}', export:'word', save_db:true },
      },
      {
        name: 'Safety Incident RCA',
        description: 'Near-miss, injury, or unsafe condition -- 8D structured investigation with timeline reconstruction.',
        problem_type: 'safety_incident', active: 0, color: '#2d6a4f', sort_order: 4,
        keywords: ['safety','near miss','injury','incident','unsafe','hazard','accident'],
        data_steps: [
          { n:1, source_type:'file_server', source_label:'Incident report PDF/Excel', query_hint:'Latest incident report for the date and area',                                        required:true,  fallback:'warn' },
          { n:2, source_type:'file_server', source_label:'Shift log CSV',             query_hint:'Operator shift log covering the incident window',                                    required:true,  fallback:'skip' },
          { n:3, source_type:'api',         source_label:'SAP PM . notifications',   query_hint:"$filter=MaintenancePlant eq '{plant}' and NotifType eq 'S1'&$format=json",            required:false, fallback:'skip' },
          { n:4, source_type:'database',    source_label:'InfluxDB . machine_events', query_hint:'Machine alarms in the 2 hours before the incident',                                 required:false, fallback:'skip' },
        ],
        renderers: [
          { type:'timeline',  label:' Timeline', required:true,  order:1 },
          { type:'five_whys', label:' 5 Whys',   required:true,  order:2 },
          { type:'8d',        label:' 8D',        required:true,  order:3 },
          { type:'cap',       label:' CAP',       required:true,  order:4 },
        ],
        output_config: { title:'Safety RCA . {location} . {date}', export:'word', save_db:true },
      },
    ]
    for (const wf of defaults) {
      await sql`
        INSERT INTO rca_workflows
          (name, description, problem_type, active, color, keywords,
           data_steps, renderers, output_config, sort_order)
        VALUES
          (${wf.name}, ${wf.description}, ${wf.problem_type}, ${wf.active},
           ${wf.color}, ${JSON.stringify(wf.keywords)}, ${JSON.stringify(wf.data_steps)},
           ${JSON.stringify(wf.renderers)}, ${JSON.stringify(wf.output_config)}, ${wf.sort_order})`
    }
    console.log('RCA workflow templates seeded (4 defaults)')
  }

  // -- Airbyte integration --------------------------------------
  await sql`CREATE TABLE IF NOT EXISTS kv_settings (
    key        TEXT PRIMARY KEY,
    value_enc  TEXT NOT NULL,
    updated_by TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  )`.catch(() => {})

  await sql`CREATE TABLE IF NOT EXISTS airbyte_instances (
    id          TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
    label       TEXT NOT NULL DEFAULT 'Local Airbyte',
    url         TEXT NOT NULL DEFAULT 'http://localhost:8000',
    username    TEXT NOT NULL DEFAULT 'airbyte',
    password_enc TEXT,
    client_id   TEXT,
    client_secret_enc TEXT,
    workspace_id TEXT,
    active      INTEGER NOT NULL DEFAULT 1,
    last_synced TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
  )`.catch(() => {})

  await sql`CREATE TABLE IF NOT EXISTS connection_schemas (
    connection_id TEXT PRIMARY KEY,
    schema_json   TEXT NOT NULL,
    fetched_at    TEXT DEFAULT (datetime('now'))
  )`.catch(() => {})

  // -- Indexes ---------------------------------------------------
  await sql`CREATE INDEX IF NOT EXISTS idx_messages_conv     ON messages(conversation_id, created_at)`.catch(() => {})
  await sql`CREATE INDEX IF NOT EXISTS idx_convs_user        ON conversations(user_id, updated_at DESC)`.catch(() => {})
  await sql`CREATE INDEX IF NOT EXISTS idx_usage_user        ON usage_events(user_id, created_at DESC)`.catch(() => {})
  await sql`CREATE INDEX IF NOT EXISTS idx_usage_created     ON usage_events(created_at DESC)`.catch(() => {})
  await sql`CREATE INDEX IF NOT EXISTS idx_rca_wf_type       ON rca_workflows(problem_type, active)`.catch(() => {})

  // -- Bootstrap admin -------------------------------------------
  const email    = process.env.ADMIN_EMAIL
  const password = process.env.ADMIN_PASSWORD
  const name     = process.env.ADMIN_NAME || 'Admin'
  if (email && password) {
    const existing = await sql`SELECT id FROM users WHERE email = ${email.toLowerCase()}`
    if (!existing.length) {
      const hash = await bcrypt.hash(password, 12)
      await sql`
        INSERT INTO users(email, name, password_hash, role)
        VALUES(${email.toLowerCase()}, ${name}, ${hash}, 'admin')
        ON CONFLICT(email) DO NOTHING`
      console.log('Admin created:', email)
    }
  }

  // -- Superset: set Public role permissions for embedded dashboards ----
  // Built-in scheduler for self-hosted deployments (replaces Vercel Cron)
  if (typeof process !== 'undefined' && !process.env.VERCEL && !(global as Record<string,unknown>).__mosaicSchedulerStarted) {
    (global as Record<string, unknown>).__mosaicSchedulerStarted = true
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001'
    const cronSecret = process.env.CRON_SECRET
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (cronSecret) headers['Authorization'] = `Bearer ${cronSecret}`
    setInterval(() => {
      fetch(`${appUrl}/api/integrations/scheduler`, { method: 'POST', headers }).catch(() => {})
    }, 60_000)
    console.log('[scheduler] Built-in scheduler started — firing every 60s')
  }

  // Fire-and-forget: never blocks Mosaic startup
  initSupersetPublicRole().catch(() => {})

  // -- Superset: set Public role permissions for embedded dashboards ----
  // Fire-and-forget: never blocks Mosaic startup

  done = true
}

async function initSupersetPublicRole(): Promise<void> {
  const supersetUrl = process.env.SUPERSET_URL
  const supersetUser = process.env.SUPERSET_ADMIN_USER || 'admin'
  const supersetPass = process.env.SUPERSET_ADMIN_PASSWORD
  if (!supersetUrl || !supersetPass) return

  try {
    // Wait up to 30s for Superset to be ready
    let ready = false
    for (let i = 0; i < 6; i++) {
      try {
        const h = await fetch(`${supersetUrl}/health`, { signal: AbortSignal.timeout(5000) })
        if (h.ok) { ready = true; break }
      } catch {}
      await new Promise(r => setTimeout(r, 5000))
    }
    if (!ready) return

    // Login
    const loginRes = await fetch(`${supersetUrl}/api/v1/security/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: supersetUser, password: supersetPass, provider: 'db', refresh: false }),
      signal: AbortSignal.timeout(5000),
    })
    if (!loginRes.ok) return
    const token = (await loginRes.json()).access_token
    if (!token) return

    // Get CSRF + session cookie
    const csrfRes = await fetch(`${supersetUrl}/api/v1/security/csrf_token/`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    })
    if (!csrfRes.ok) return
    const csrf = (await csrfRes.json()).result
    const setCookies = csrfRes.headers.getSetCookie?.() || []
    const sessionCookie = setCookies.map((c: string) => c.split(';')[0]).find((c: string) => c.startsWith('session=')) || null

    // Get Public role ID
    const rolesRes = await fetch(`${supersetUrl}/api/v1/security/roles/?q=(filters:!((col:name,opr:RoleNameFilter,val:Public)))`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const rolesData = await rolesRes.json()
    const publicRole = rolesData.result?.find((r: { name: string }) => r.name === 'Public')
    if (!publicRole) return
    const roleId = publicRole.id

    // Get current permissions on Public role
    const permsRes = await fetch(`${supersetUrl}/api/v1/security/roles/${roleId}/permissions/`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const permsData = await permsRes.json()
    const existing = new Set((permsData.result || []).map((p: { permission_name: string; view_menu_name: string }) => `${p.permission_name}||${p.view_menu_name}`))

    const needed = [
      { permission_name: 'can read', view_menu_name: 'Dashboard' },
      { permission_name: 'can read', view_menu_name: 'Chart' },
      { permission_name: 'can read', view_menu_name: 'Dataset' },
      { permission_name: 'can read', view_menu_name: 'Query' },
      { permission_name: 'all database access', view_menu_name: 'all_database_access' },
    ]

    const missing = needed.filter(p => !existing.has(`${p.permission_name}||${p.view_menu_name}`))
    if (missing.length === 0) {
      console.log('[superset-init] Public role permissions already set')
      return
    }

    // Get all permission-view pairs to find IDs
    const allPermsRes = await fetch(`${supersetUrl}/api/v1/security/permissions-resources/?q=(page_size:1000)`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const allPermsData = await allPermsRes.json()
    const allPerms = allPermsData.result || []

    const toAdd = missing.map(p => {
      const found = allPerms.find((ap: { permission_name: string; view_menu_name: string; id: number }) =>
        ap.permission_name === p.permission_name && ap.view_menu_name === p.view_menu_name
      )
      return found?.id
    }).filter(Boolean)

    if (toAdd.length === 0) return

    // Add missing permissions to Public role
    await fetch(`${supersetUrl}/api/v1/security/roles/${roleId}/permissions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-CSRFToken': csrf,
        'Content-Type': 'application/json',
        Referer: supersetUrl,
        ...(sessionCookie ? { Cookie: sessionCookie } : {}),
      },
      body: JSON.stringify({ permission_view_menu_ids: toAdd }),
      signal: AbortSignal.timeout(10000),
    })
    console.log(`[superset-init] Added ${toAdd.length} permissions to Public role`)
  } catch (err) {
    console.warn('[superset-init] Non-fatal error setting Public role:', err)
  }
}
