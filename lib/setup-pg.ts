// lib/setup-pg.ts
// Postgres-compatible schema setup (used on Vercel / Neon)
// Called from lib/setup.ts when isPostgres() === true

import { getDb } from './db'
import bcrypt from 'bcryptjs'
import { log } from './logger'

export async function setupDatabasePostgres(): Promise<void> {
  const sql = getDb()

  await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`

  await sql`CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    email         TEXT UNIQUE NOT NULL,
    name          TEXT NOT NULL DEFAULT '',
    password_hash TEXT,
    role          TEXT NOT NULL DEFAULT 'user',
    banned        BOOLEAN DEFAULT false,
    sso_provider  TEXT,
    sso_sub       TEXT,
    invite_sent_at TEXT,
    last_login_at  TEXT,
    created_at    TEXT DEFAULT now()::text
  )`

  // Per-user access grants for external interfaces (n8n, Superset, Airbyte, CISO).
  // Absence of a row = no access (default deny). Admins get all surfaces in code.
  await sql`CREATE TABLE IF NOT EXISTS user_surface_permissions (
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    surface    TEXT NOT NULL,
    allowed    BOOLEAN NOT NULL DEFAULT false,
    updated_at TEXT DEFAULT now()::text,
    PRIMARY KEY (user_id, surface)
  )`

  await sql`CREATE TABLE IF NOT EXISTS sso_config (
    id            TEXT PRIMARY KEY DEFAULT 'default',
    provider      TEXT NOT NULL,
    client_id     TEXT NOT NULL,
    client_secret TEXT NOT NULL,
    tenant_id     TEXT,
    enabled       BOOLEAN DEFAULT true,
    created_at    TEXT DEFAULT now()::text
  )`

  await sql`CREATE TABLE IF NOT EXISTS smtp_config (
    id           TEXT PRIMARY KEY DEFAULT 'default',
    host         TEXT NOT NULL,
    port         INTEGER NOT NULL DEFAULT 587,
    username     TEXT,
    password_enc TEXT,
    from_address TEXT NOT NULL,
    from_name    TEXT NOT NULL DEFAULT 'Mosaic',
    enabled      BOOLEAN DEFAULT true,
    created_at   TEXT DEFAULT now()::text
  )`

  await sql`CREATE TABLE IF NOT EXISTS conversations (
    id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      TEXT NOT NULL DEFAULT 'New conversation',
    created_at TEXT DEFAULT now()::text,
    updated_at TEXT DEFAULT now()::text
  )`

  await sql`CREATE TABLE IF NOT EXISTS messages (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role            TEXT NOT NULL,
    content         TEXT NOT NULL DEFAULT '',
    tool_calls      TEXT,
    rca_block       TEXT,
    created_at      TEXT DEFAULT now()::text
  )`

  await sql`CREATE TABLE IF NOT EXISTS db_connections (
    id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
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
    read_only           BOOLEAN DEFAULT false,
    mcp_endpoint        TEXT,
    mcp_token           TEXT,
    full_text_search    INTEGER DEFAULT 0,
    fts_airbyte_conn_id TEXT,
    description         TEXT,
    managed             INTEGER DEFAULT 0,
    created_at          TEXT DEFAULT now()::text
  )`

  await sql`CREATE TABLE IF NOT EXISTS api_services (
    id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
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
    auth_status         TEXT DEFAULT 'unknown',
    last_auth_error     TEXT,
    last_auth_check     INTEGER,
    created_at          TEXT DEFAULT now()::text
  )`

  await sql`CREATE TABLE IF NOT EXISTS api_connections (
    id                      TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
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
    created_at              TEXT DEFAULT now()::text
  )`

  await sql`CREATE TABLE IF NOT EXISTS usage_events (
    id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id       TEXT NOT NULL,
    user_email    TEXT,
    type          TEXT NOT NULL,
    model         TEXT,
    input_tokens  INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    cost_usd      NUMERIC(10,6) DEFAULT 0,
    latency_ms    INT,
    created_at    TEXT DEFAULT now()::text
  )`

  await sql`CREATE TABLE IF NOT EXISTS file_servers (
    id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
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
    tenant_id             TEXT,
    client_id             TEXT,
    file_types            TEXT NOT NULL DEFAULT 'csv,xlsx,pdf',
    poll_interval_sec     INTEGER NOT NULL DEFAULT 60,
    max_files             INTEGER NOT NULL DEFAULT 20,
    max_rows              INTEGER NOT NULL DEFAULT 500,
    filename_date_pattern TEXT,
    ts_strategy           TEXT NOT NULL DEFAULT 'auto',
    created_at            TEXT DEFAULT now()::text
  )`

  await sql`CREATE TABLE IF NOT EXISTS dashboards (
    id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_public   INTEGER NOT NULL DEFAULT 0,
    refresh_sec INTEGER NOT NULL DEFAULT 300,
    superset_embed_uuid TEXT,
    created_at  TEXT DEFAULT now()::text,
    updated_at  TEXT DEFAULT now()::text
  )`

  await sql`CREATE TABLE IF NOT EXISTS dashboard_panels (
    id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
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
    created_at   TEXT DEFAULT now()::text
  )`

  await sql`CREATE TABLE IF NOT EXISTS notification_groups (
    id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    members     TEXT NOT NULL DEFAULT '[]',
    created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at  TEXT DEFAULT now()::text
  )`

  await sql`CREATE TABLE IF NOT EXISTS rule_groups (
    id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name             TEXT NOT NULL,
    description      TEXT NOT NULL DEFAULT '',
    active           BOOLEAN NOT NULL DEFAULT true,
    logic            TEXT NOT NULL DEFAULT 'OR',
    trigger          TEXT NOT NULL DEFAULT '{}',
    conditions       TEXT NOT NULL DEFAULT '[]',
    controls         TEXT NOT NULL DEFAULT '{}',
    actions          TEXT NOT NULL DEFAULT '[]',
    recipients       TEXT NOT NULL DEFAULT '[]',
    message_template TEXT NOT NULL DEFAULT '',
    last_fired_at    TEXT,
    fire_count_today INTEGER NOT NULL DEFAULT 0,
    email_channel_id TEXT,
    sms_channel_id   TEXT,
    created_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at       TEXT DEFAULT now()::text,
    updated_at       TEXT DEFAULT now()::text
  )`

  await sql`CREATE TABLE IF NOT EXISTS integration_channels (
    id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name       TEXT NOT NULL,
    type       TEXT NOT NULL,
    config     TEXT NOT NULL DEFAULT '{}',
    active     BOOLEAN NOT NULL DEFAULT true,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT DEFAULT now()::text
  )`

  await sql`CREATE TABLE IF NOT EXISTS integration_rules (
    id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name             TEXT NOT NULL,
    active           BOOLEAN NOT NULL DEFAULT true,
    trigger_type     TEXT NOT NULL,
    source_type      TEXT NOT NULL,
    source_id        TEXT,
    query            TEXT,
    condition        TEXT NOT NULL DEFAULT '{}',
    channel_id       TEXT NOT NULL REFERENCES integration_channels(id) ON DELETE CASCADE,
    message_template TEXT NOT NULL DEFAULT '',
    last_run_at      TEXT,
    next_run_at      TEXT,
    created_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at       TEXT DEFAULT now()::text
  )`

  await sql`CREATE TABLE IF NOT EXISTS integration_runs (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    rule_id         TEXT NOT NULL,
    triggered_at    TEXT DEFAULT now()::text,
    status          TEXT NOT NULL,
    value_snapshot  TEXT,
    message_sent    TEXT,
    error           TEXT,
    latency_ms      INT
  )`

  await sql`CREATE TABLE IF NOT EXISTS rca_workflows (
    id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name          TEXT NOT NULL,
    description   TEXT NOT NULL DEFAULT '',
    problem_type  TEXT NOT NULL DEFAULT 'quality_defect',
    active        BOOLEAN NOT NULL DEFAULT true,
    color         TEXT NOT NULL DEFAULT '#2563eb',
    keywords      TEXT NOT NULL DEFAULT '[]',
    data_steps    TEXT NOT NULL DEFAULT '[]',
    renderers     TEXT NOT NULL DEFAULT '[]',
    output_config TEXT NOT NULL DEFAULT '{}',
    sort_order    INTEGER NOT NULL DEFAULT 0,
    created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at    TEXT DEFAULT now()::text,
    updated_at    TEXT DEFAULT now()::text
  )`

  await sql`CREATE TABLE IF NOT EXISTS rca_sessions (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    workflow_id     TEXT REFERENCES rca_workflows(id) ON DELETE SET NULL,
    conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
    problem         TEXT NOT NULL DEFAULT '',
    renderers_used  TEXT NOT NULL DEFAULT '[]',
    rca_block       TEXT NOT NULL DEFAULT '{}',
    created_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at      TEXT DEFAULT now()::text
  )`

  await sql`CREATE INDEX IF NOT EXISTS idx_rca_sessions_conv ON rca_sessions(conversation_id, created_at DESC)`.catch(() => {})
  await sql`CREATE INDEX IF NOT EXISTS idx_rca_sessions_wf   ON rca_sessions(workflow_id, created_at DESC)`.catch(() => {})

  await sql`ALTER TABLE file_servers ADD COLUMN IF NOT EXISTS tenant_id TEXT`.catch(() => {})
  await sql`ALTER TABLE file_servers ADD COLUMN IF NOT EXISTS client_id TEXT`.catch(() => {})

  // -- MCP connections (Postgres) --------------------------------
  await sql`CREATE TABLE IF NOT EXISTS mcp_connections (
    id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    label         TEXT NOT NULL,
    endpoint_url  TEXT NOT NULL,
    transport     TEXT NOT NULL DEFAULT 'http',
    token_enc     TEXT,
    description   TEXT,
    enabled       BOOLEAN NOT NULL DEFAULT true,
    created_at    TEXT DEFAULT (NOW()::text),
    updated_at    TEXT DEFAULT (NOW()::text)
  )`.catch(() => {})

  // -- Prism instances (Postgres) --------------------------------
  await sql`CREATE TABLE IF NOT EXISTS prism_instances (
    id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    label             TEXT NOT NULL,
    base_url          TEXT NOT NULL,
    ui_url            TEXT,
    environment       TEXT NOT NULL DEFAULT 'production',
    username          TEXT NOT NULL,
    password_enc      TEXT NOT NULL,
    token_enc         TEXT,
    refresh_token_enc TEXT,
    token_expiry      BIGINT,
    active            BOOLEAN NOT NULL DEFAULT true,
    created_at        TEXT DEFAULT (NOW()::text),
    updated_at        TEXT DEFAULT (NOW()::text)
  )`.catch(() => {})

  // -- Data retention settings (Postgres) ------------------------
  await sql`CREATE TABLE IF NOT EXISTS data_retention_settings (
    dataset          TEXT PRIMARY KEY,
    enabled          BOOLEAN NOT NULL DEFAULT true,
    retention_days   INTEGER NOT NULL DEFAULT 90,
    last_purge_at    TEXT,
    last_purge_count INTEGER NOT NULL DEFAULT 0,
    updated_at       TEXT DEFAULT (NOW()::text)
  )`.catch(() => {})


  await sql`CREATE TABLE IF NOT EXISTS report_templates (
    id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name        TEXT NOT NULL,
    description TEXT DEFAULT '',
    type        TEXT NOT NULL DEFAULT 'operational',
    sections    TEXT NOT NULL DEFAULT '[]',
    schedule    TEXT,
    recipients  TEXT NOT NULL DEFAULT '[]',
    active      BOOLEAN DEFAULT true,
    created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at  TEXT DEFAULT now()::text,
    updated_at  TEXT DEFAULT now()::text
  )`

  await sql`CREATE TABLE IF NOT EXISTS report_instances (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    template_id     TEXT REFERENCES report_templates(id) ON DELETE SET NULL,
    name            TEXT NOT NULL,
    type            TEXT NOT NULL DEFAULT 'operational',
    trigger         TEXT NOT NULL DEFAULT 'manual',
    triggered_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
    conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    pdf_path        TEXT,
    pdf_size        INTEGER,
    page_count      INTEGER,
    error           TEXT,
    generated_at    TEXT DEFAULT now()::text,
    created_at      TEXT DEFAULT now()::text
  )`

  await sql`CREATE TABLE IF NOT EXISTS report_deliveries (
    id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    report_id  TEXT NOT NULL REFERENCES report_instances(id) ON DELETE CASCADE,
    recipient  TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'pending',
    sent_at    TEXT,
    error      TEXT,
    created_at TEXT DEFAULT now()::text
  )`

  await sql`CREATE TABLE IF NOT EXISTS kv_settings (
    key        TEXT PRIMARY KEY,
    value_enc  TEXT NOT NULL,
    updated_by TEXT,
    updated_at TEXT DEFAULT now()::text
  )`

  await sql`CREATE TABLE IF NOT EXISTS airbyte_instances (
    id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    label             TEXT NOT NULL DEFAULT 'Local Airbyte',
    url               TEXT NOT NULL DEFAULT 'http://localhost:8000',
    username          TEXT NOT NULL DEFAULT 'airbyte',
    password_enc      TEXT,
    client_id         TEXT,
    client_secret_enc TEXT,
    workspace_id      TEXT,
    active            BOOLEAN NOT NULL DEFAULT true,
    last_synced       TEXT,
    created_at        TEXT DEFAULT now()::text
  )`

  await sql`CREATE TABLE IF NOT EXISTS connection_schemas (
    connection_id TEXT PRIMARY KEY,
    schema_json   TEXT NOT NULL,
    fetched_at    TEXT DEFAULT now()::text
  )`


  // ── Guardrails (T1–T8) ─────────────────────────────────────────────────────
  await sql`CREATE TABLE IF NOT EXISTS guardrail_ai_rules (
    id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name        TEXT NOT NULL DEFAULT 'Default Policy',
    enabled     BOOLEAN NOT NULL DEFAULT true,
    rules_text  TEXT NOT NULL DEFAULT '',
    created_at  TEXT DEFAULT now()::text,
    updated_at  TEXT DEFAULT now()::text
  )`.catch(() => {})

  await sql`CREATE TABLE IF NOT EXISTS guardrail_data_access (
    id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    role             TEXT NOT NULL DEFAULT 'user',
    source_id        TEXT,
    source_type      TEXT NOT NULL DEFAULT 'database',
    allowed_tables   TEXT DEFAULT '[]',
    blocked_columns  TEXT DEFAULT '[]',
    row_filter       TEXT DEFAULT '',
    enabled          BOOLEAN NOT NULL DEFAULT true,
    created_at       TEXT DEFAULT now()::text
  )`.catch(() => {})

  await sql`CREATE TABLE IF NOT EXISTS guardrail_actions (
    id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    role             TEXT NOT NULL DEFAULT 'user',
    source_id        TEXT,
    read_only        BOOLEAN NOT NULL DEFAULT false,
    blocked_tools    TEXT DEFAULT '[]',
    allowed_methods  TEXT DEFAULT '["GET","POST","PUT","PATCH","DELETE"]',
    enabled          BOOLEAN NOT NULL DEFAULT true,
    created_at       TEXT DEFAULT now()::text
  )`.catch(() => {})

  await sql`CREATE TABLE IF NOT EXISTS guardrail_usage_limits (
    id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    role                  TEXT NOT NULL DEFAULT 'user',
    user_id               TEXT,
    daily_token_limit     INTEGER,
    monthly_token_limit   INTEGER,
    daily_request_limit   INTEGER,
    soft_warn_pct         INTEGER NOT NULL DEFAULT 90,
    enabled               BOOLEAN NOT NULL DEFAULT true,
    created_at            TEXT DEFAULT now()::text
  )`.catch(() => {})

  await sql`CREATE TABLE IF NOT EXISTS guardrail_content (
    id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name             TEXT NOT NULL DEFAULT 'Content Policy',
    enabled          BOOLEAN NOT NULL DEFAULT true,
    mode             TEXT NOT NULL DEFAULT 'blocklist',
    patterns         TEXT DEFAULT '[]',
    block_message    TEXT NOT NULL DEFAULT 'This topic is outside the scope of Mosaic.',
    created_at       TEXT DEFAULT now()::text
  )`.catch(() => {})

  await sql`CREATE TABLE IF NOT EXISTS egress_events (
    id                   TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    conversation_id      TEXT,
    user_id              TEXT,
    user_email           TEXT,
    timestamp            TEXT DEFAULT now()::text,
    sources_accessed     TEXT DEFAULT '[]',
    web_search_used      BOOLEAN NOT NULL DEFAULT false,
    prompt_tokens        INTEGER DEFAULT 0,
    completion_tokens    INTEGER DEFAULT 0,
    model                TEXT,
    data_classifications TEXT DEFAULT '[]',
    message_preview      TEXT
  )`.catch(() => {})

  await sql`CREATE TABLE IF NOT EXISTS guardrail_pending_actions (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    conversation_id TEXT NOT NULL,
    user_id         TEXT NOT NULL,
    tool_name       TEXT NOT NULL,
    tool_input      TEXT NOT NULL,
    description     TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    created_at      TEXT DEFAULT now()::text,
    resolved_at     TEXT
  )`.catch(() => {})

  await sql`CREATE TABLE IF NOT EXISTS guardrail_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`.catch(() => {})

  await sql`INSERT INTO guardrail_settings (key, value) VALUES
    ('hitl_enabled', 'false'),
    ('hitl_write_methods', '["POST","PUT","PATCH","DELETE"]'),
    ('egress_logging', 'true'),
    ('injection_defense', 'true'),
    ('global_read_only', 'false')
  ON CONFLICT(key) DO NOTHING`.catch(() => {})

  // Indexes
  await sql`CREATE INDEX IF NOT EXISTS idx_messages_conv   ON messages(conversation_id, created_at)`.catch(() => {})
  await sql`CREATE INDEX IF NOT EXISTS idx_convs_user      ON conversations(user_id, updated_at DESC)`.catch(() => {})
  await sql`CREATE INDEX IF NOT EXISTS idx_usage_user      ON usage_events(user_id, created_at DESC)`.catch(() => {})
  await sql`CREATE INDEX IF NOT EXISTS idx_usage_created   ON usage_events(created_at DESC)`.catch(() => {})
  await sql`CREATE INDEX IF NOT EXISTS idx_rca_wf_type     ON rca_workflows(problem_type, active)`.catch(() => {})
  await sql`CREATE INDEX IF NOT EXISTS idx_dashboards_owner ON dashboards(owner_id, updated_at DESC)`.catch(() => {})
  await sql`CREATE INDEX IF NOT EXISTS idx_panels_dashboard ON dashboard_panels(dashboard_id, sort_order)`.catch(() => {})
  await sql`CREATE INDEX IF NOT EXISTS idx_rule_groups_active ON rule_groups(active, updated_at DESC)`.catch(() => {})
  await sql`CREATE INDEX IF NOT EXISTS idx_rules_next_run  ON integration_rules(next_run_at) WHERE active = true`.catch(() => {})
  await sql`CREATE INDEX IF NOT EXISTS idx_runs_rule       ON integration_runs(rule_id, triggered_at DESC)`.catch(() => {})

  // Seed RCA workflow defaults
  const wfCount = await sql`SELECT COUNT(*) as cnt FROM rca_workflows`
  if (Number((wfCount[0] as { cnt: string })?.cnt || 0) === 0) {
    const defaults = [
      { name: 'Quality Defect RCA', description: 'Dimensional, visual, or functional rejection -- traces causes through 6M categories.', problem_type: 'quality_defect', active: 1, color: '#c0392b', sort_order: 1, keywords: ['defect','rejection','scrap'], data_steps: [], renderers: [], output_config: { export: 'word' } },
      { name: 'Machine Downtime RCA', description: 'Unplanned stop or breakdown -- reconstructs the event sequence.', problem_type: 'machine_downtime', active: 1, color: '#c45c1a', sort_order: 2, keywords: ['downtime','breakdown','fault'], data_steps: [], renderers: [], output_config: { export: 'word' } },
      { name: 'OEE Drop Analysis', description: 'Availability, performance, or quality degradation analysis.', problem_type: 'oee_drop', active: 1, color: '#1d4e89', sort_order: 3, keywords: ['oee','availability','performance'], data_steps: [], renderers: [], output_config: { export: 'word' } },
      { name: 'Safety Incident RCA', description: 'Near-miss, injury, or unsafe condition -- 8D structured investigation.', problem_type: 'safety_incident', active: 0, color: '#2d6a4f', sort_order: 4, keywords: ['safety','near miss','incident'], data_steps: [], renderers: [], output_config: { export: 'word' } },
    ]
    for (const wf of defaults) {
      await sql`INSERT INTO rca_workflows (name, description, problem_type, active, color, keywords, data_steps, renderers, output_config, sort_order)
        VALUES (${wf.name}, ${wf.description}, ${wf.problem_type}, ${wf.active}, ${wf.color},
                ${JSON.stringify(wf.keywords)}, ${JSON.stringify(wf.data_steps)},
                ${JSON.stringify(wf.renderers)}, ${JSON.stringify(wf.output_config)}, ${wf.sort_order})`
    }
    log.info({ service: 'setup-pg' }, 'RCA workflow defaults seeded')
  }

  // Bootstrap admin
  const email    = process.env.ADMIN_EMAIL
  const password = process.env.ADMIN_PASSWORD
  const name     = process.env.ADMIN_NAME || 'Admin'
  if (email && password) {
    const existing = await sql`SELECT id FROM users WHERE email = ${email.toLowerCase()}`
    if (!existing.length) {
      const hash = await bcrypt.hash(password, 12)
      await sql`INSERT INTO users(email, name, password_hash, role)
        VALUES(${email.toLowerCase()}, ${name}, ${hash}, 'admin')
        ON CONFLICT(email) DO NOTHING`
      log.info({ service: 'setup-pg', email }, 'Admin account created from env vars')
    }
  }

  log.info({ service: 'setup-pg' }, 'Postgres schema ready')
}
