-- migrations/001_baseline.sql
-- Baseline schema for Mosaic v1.2
-- Applied once on fresh installs. Existing installs already have these tables
-- so all statements use CREATE TABLE IF NOT EXISTS / ALTER TABLE ... ADD COLUMN
-- with error handling in the runner.

-- Core auth
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  email         TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL DEFAULT '',
  password_hash TEXT,
  role          TEXT NOT NULL DEFAULT 'user',
  banned        INTEGER DEFAULT 0,
  sso_provider  TEXT,
  sso_sub       TEXT,
  invite_sent_at TEXT,
  last_login_at TEXT,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sso_config (
  id            TEXT PRIMARY KEY DEFAULT 'default',
  provider      TEXT NOT NULL,
  client_id     TEXT NOT NULL,
  client_secret TEXT NOT NULL,
  tenant_id     TEXT,
  enabled       INTEGER DEFAULT 1,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS smtp_config (
  id           TEXT PRIMARY KEY DEFAULT 'default',
  host         TEXT NOT NULL,
  port         INTEGER NOT NULL DEFAULT 587,
  username     TEXT,
  password_enc TEXT,
  from_address TEXT NOT NULL,
  from_name    TEXT NOT NULL DEFAULT 'Mosaic',
  enabled      INTEGER DEFAULT 1,
  created_at   TEXT DEFAULT (datetime('now'))
);

-- Conversations + messages
CREATE TABLE IF NOT EXISTS conversations (
  id         TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL DEFAULT 'New conversation',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,
  content         TEXT NOT NULL DEFAULT '',
  tool_calls      TEXT,
  rca_block       TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);

-- Data connections
CREATE TABLE IF NOT EXISTS db_connections (
  id                TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  label             TEXT NOT NULL,
  dialect           TEXT NOT NULL DEFAULT 'postgres',
  environment       TEXT NOT NULL DEFAULT 'development',
  host              TEXT,
  port              INTEGER DEFAULT 5432,
  database_name     TEXT,
  username          TEXT,
  password_enc      TEXT,
  connection_string TEXT,
  schema_name       TEXT DEFAULT 'public',
  ssl_mode          TEXT DEFAULT 'prefer',
  ssl_ca            TEXT,
  pool_min          INTEGER DEFAULT 1,
  pool_max          INTEGER DEFAULT 5,
  connect_timeout_ms  INTEGER DEFAULT 5000,
  query_timeout_ms    INTEGER DEFAULT 30000,
  read_only           INTEGER DEFAULT 0,
  mcp_endpoint        TEXT,
  mcp_token           TEXT,
  full_text_search    INTEGER DEFAULT 0,
  fts_airbyte_conn_id TEXT,
  description         TEXT,
  managed             INTEGER DEFAULT 0,
  created_at          TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS api_services (
  id                 TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  label              TEXT NOT NULL,
  base_url           TEXT NOT NULL,
  environment        TEXT NOT NULL DEFAULT 'production',
  auth_type          TEXT NOT NULL DEFAULT 'bearer',
  auth_config        TEXT NOT NULL DEFAULT '{}',
  default_headers    TEXT DEFAULT '{}',
  api_version        TEXT,
  version_header     TEXT,
  rate_limit_rpm     INT,
  connect_timeout_ms INTEGER DEFAULT 5000,
  request_timeout_ms INTEGER DEFAULT 30000,
  retry_count        INTEGER DEFAULT 3,
  auth_status        TEXT DEFAULT 'unknown',
  last_auth_error    TEXT,
  last_auth_check    INTEGER,
  created_at         TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS api_connections (
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
);

CREATE TABLE IF NOT EXISTS file_servers (
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
  tenant_id             TEXT,
  client_id             TEXT,
  file_types            TEXT NOT NULL DEFAULT 'csv,xlsx,pdf',
  poll_interval_sec     INTEGER NOT NULL DEFAULT 60,
  max_files             INTEGER NOT NULL DEFAULT 20,
  max_rows              INTEGER NOT NULL DEFAULT 500,
  filename_date_pattern TEXT,
  ts_strategy           TEXT NOT NULL DEFAULT 'auto',
  created_at            TEXT DEFAULT (datetime('now'))
);

-- Usage
CREATE TABLE IF NOT EXISTS usage_events (
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
);

-- Dashboards
CREATE TABLE IF NOT EXISTS dashboards (
  id          TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_public   INTEGER NOT NULL DEFAULT 0,
  refresh_sec INTEGER NOT NULL DEFAULT 300,
  superset_embed_uuid TEXT,
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dashboard_panels (
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
);

-- Notifications
CREATE TABLE IF NOT EXISTS notification_groups (
  id          TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  members     TEXT NOT NULL DEFAULT '[]',
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rule_groups (
  id               TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  name             TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  active           INTEGER NOT NULL DEFAULT 1,
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
  created_at       TEXT DEFAULT (datetime('now')),
  updated_at       TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS integration_channels (
  id         TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  name       TEXT NOT NULL,
  type       TEXT NOT NULL,
  config     TEXT NOT NULL DEFAULT '{}',
  active     INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS integration_rules (
  id               TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  name             TEXT NOT NULL,
  active           INTEGER NOT NULL DEFAULT 1,
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
  created_at       TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS integration_runs (
  id             TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  rule_id        TEXT NOT NULL,
  triggered_at   TEXT DEFAULT (datetime('now')),
  status         TEXT NOT NULL,
  value_snapshot TEXT,
  message_sent   TEXT,
  error          TEXT,
  latency_ms     INT
);

-- RCA
CREATE TABLE IF NOT EXISTS rca_workflows (
  id            TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  problem_type  TEXT NOT NULL DEFAULT 'quality_defect',
  active        INTEGER NOT NULL DEFAULT 1,
  color         TEXT NOT NULL DEFAULT '#2563eb',
  keywords      TEXT NOT NULL DEFAULT '[]',
  data_steps    TEXT NOT NULL DEFAULT '[]',
  renderers     TEXT NOT NULL DEFAULT '[]',
  output_config TEXT NOT NULL DEFAULT '{}',
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rca_sessions (
  id              TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  workflow_id     TEXT REFERENCES rca_workflows(id) ON DELETE SET NULL,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
  problem         TEXT NOT NULL DEFAULT '',
  renderers_used  TEXT NOT NULL DEFAULT '[]',
  rca_block       TEXT NOT NULL DEFAULT '{}',
  created_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT DEFAULT (datetime('now'))
);

-- Reports
CREATE TABLE IF NOT EXISTS report_templates (
  id          TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  name        TEXT NOT NULL,
  description TEXT DEFAULT '',
  type        TEXT NOT NULL DEFAULT 'operational',
  sections    TEXT NOT NULL DEFAULT '[]',
  schedule    TEXT,
  recipients  TEXT NOT NULL DEFAULT '[]',
  active      INTEGER DEFAULT 1,
  last_scheduled_run TEXT,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS report_instances (
  id              TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
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
  generated_at    TEXT DEFAULT (datetime('now')),
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS report_deliveries (
  id         TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  report_id  TEXT NOT NULL REFERENCES report_instances(id) ON DELETE CASCADE,
  recipient  TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending',
  sent_at    TEXT,
  error      TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Key-value settings + integrations
CREATE TABLE IF NOT EXISTS kv_settings (
  key        TEXT PRIMARY KEY,
  value_enc  TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS airbyte_instances (
  id               TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  label            TEXT NOT NULL DEFAULT 'Local Airbyte',
  url              TEXT NOT NULL DEFAULT 'http://localhost:8000',
  username         TEXT NOT NULL DEFAULT 'airbyte',
  password_enc     TEXT,
  client_id        TEXT,
  client_secret_enc TEXT,
  workspace_id     TEXT,
  active           INTEGER NOT NULL DEFAULT 1,
  last_synced      TEXT,
  created_at       TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS connection_schemas (
  connection_id TEXT PRIMARY KEY,
  schema_json   TEXT NOT NULL,
  fetched_at    TEXT DEFAULT (datetime('now'))
);

-- Guardrails
CREATE TABLE IF NOT EXISTS guardrail_ai_rules (
  id         TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  name       TEXT NOT NULL DEFAULT 'Default Policy',
  enabled    INTEGER NOT NULL DEFAULT 1,
  rules_text TEXT NOT NULL DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS guardrail_data_access (
  id              TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  role            TEXT NOT NULL DEFAULT 'user',
  source_id       TEXT,
  source_type     TEXT NOT NULL DEFAULT 'database',
  allowed_tables  TEXT DEFAULT '[]',
  blocked_columns TEXT DEFAULT '[]',
  row_filter      TEXT DEFAULT '',
  enabled         INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS guardrail_actions (
  id              TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  role            TEXT NOT NULL DEFAULT 'user',
  source_id       TEXT,
  read_only       INTEGER NOT NULL DEFAULT 0,
  blocked_tools   TEXT DEFAULT '[]',
  allowed_methods TEXT DEFAULT '["GET","POST","PUT","PATCH","DELETE"]',
  enabled         INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS guardrail_usage_limits (
  id                  TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  role                TEXT NOT NULL DEFAULT 'user',
  user_id             TEXT,
  daily_token_limit   INTEGER,
  monthly_token_limit INTEGER,
  daily_request_limit INTEGER,
  soft_warn_pct       INTEGER NOT NULL DEFAULT 90,
  enabled             INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS guardrail_content (
  id           TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  name         TEXT NOT NULL DEFAULT 'Content Policy',
  enabled      INTEGER NOT NULL DEFAULT 1,
  mode         TEXT NOT NULL DEFAULT 'blocklist',
  patterns     TEXT DEFAULT '[]',
  block_message TEXT NOT NULL DEFAULT 'This topic is outside the scope of Mosaic.',
  created_at   TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS egress_events (
  id                   TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  conversation_id      TEXT,
  user_id              TEXT,
  user_email           TEXT,
  timestamp            TEXT DEFAULT (datetime('now')),
  sources_accessed     TEXT DEFAULT '[]',
  web_search_used      INTEGER NOT NULL DEFAULT 0,
  prompt_tokens        INTEGER DEFAULT 0,
  completion_tokens    INTEGER DEFAULT 0,
  model                TEXT,
  data_classifications TEXT DEFAULT '[]',
  message_preview      TEXT
);

CREATE TABLE IF NOT EXISTS guardrail_pending_actions (
  id              TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
  conversation_id TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  tool_name       TEXT NOT NULL,
  tool_input      TEXT NOT NULL,
  description     TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  created_at      TEXT DEFAULT (datetime('now')),
  resolved_at     TEXT
);

CREATE TABLE IF NOT EXISTS guardrail_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_messages_conv     ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_convs_user        ON conversations(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_user        ON usage_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_created     ON usage_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rca_wf_type       ON rca_workflows(problem_type, active);
CREATE INDEX IF NOT EXISTS idx_dashboards_owner  ON dashboards(owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_panels_dashboard  ON dashboard_panels(dashboard_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_rule_groups_active ON rule_groups(active, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_rules_next_run    ON integration_rules(next_run_at) WHERE active = 1;
CREATE INDEX IF NOT EXISTS idx_runs_rule         ON integration_runs(rule_id, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_rca_sessions_conv ON rca_sessions(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rca_sessions_wf   ON rca_sessions(workflow_id, created_at DESC);

-- Guardrail defaults
INSERT OR IGNORE INTO guardrail_settings (key, value) VALUES
  ('hitl_enabled', 'false'),
  ('hitl_write_methods', '["POST","PUT","PATCH","DELETE"]'),
  ('egress_logging', 'true'),
  ('injection_defense', 'true'),
  ('global_read_only', 'false');
