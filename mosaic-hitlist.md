# Mosaic — Master Feature Hit List
**Last updated:** 30 April 2026  
**Baseline:** Session 6 complete (HEAD: 82922e1)  
**Purpose:** Tick off as you go. Organised by current state → near-term → strategic.

---

## 📊 Scoreboard

| Category | Done | Remaining | Total |
|---|---|---|---|
| Core platform (Part 1) | 75 | 0 | 75 |
| Near-term / blockers (Part 2) | 3 | 15 | 18 |
| Enterprise roadmap (Part 3, Phases A–P) | 6 | 114 | 120 |
| ThingsBoard IoT (Part 4) | 0 | 15 | 15 |
| Predictive Maintenance (Part 5) | 0 | 18 | 18 |
| Reporting (Part 6) | 0 | 9 | 9 |
| Multi-Tenant SaaS (Part 7) | 0 | 7 | 7 |
| Air-Gapped / Local LLM (Part 8) | 0 | 6 | 6 |
| **Total** | **84** | **184** | **268** |

> **Deployment readiness:** 1 blocker remaining — Docker Compose validation from fresh clone.  
> Once cleared, Mosaic v1.0.0 is customer-deployable.

---

## Status Key
- `[x]` Done and verified in testing
- `[~]` Built but not yet tested / partially working
- `[ ]` Not built — pending
- `[!]` Known issue / needs fix

---

## Part 1 — Current Build: Verified ✅ (75/75)

### Core Chat
- [x] Streaming AI chat (claude-sonnet-4-6, haiku, opus selectable)
- [x] Conversation persistence (saved to DB, sidebar load)
- [x] Conversation delete (hover to reveal)
- [x] System prompt per conversation (editable in topbar)
- [x] Model selector (Haiku / Sonnet / Opus)
- [x] Token usage tracking (per conversation, per model)
- [x] Follow-up suggestions (Go deeper, Simplify, Give examples, What next?)
- [x] Tool call visibility (collapsed by default, expandable)
- [x] Dark / light mode (SVG toggle)
- [x] Schema pre-loading into system prompt (getOrFetchSchema() verified)
- [x] RCA keyword detection and workflow trigger
- [x] RCA synthesis producing rca_blocks (verified 3 blocks in DB)

### Smart Database Selection
- [x] Auto-inject all connections into system prompt
- [x] Source chips on empty conversation (click to pin)
- [x] @ mention picker in input bar
- [x] Pinned sources shown as removable chips
- [x] Airbyte sources in @ picker

### Data Connections — Databases
- [x] PostgreSQL (pg driver)
- [x] MySQL (mysql2)
- [x] SQL Server (mssql)
- [x] SQLite (better-sqlite3)
- [x] MongoDB (JSON filter query syntax)
- [x] ClickHouse (HTTP API)
- [x] InfluxDB (InfluxQL)
- [x] Connection string import (.env / paste)
- [x] MCP (Model Context Protocol)
- [x] Connection test (version + latency)
- [x] Read-only mode (blocks INSERT/UPDATE/DELETE)
- [x] Dialect-aware SQL whitelist (SHOW allowed for InfluxDB)
- [x] Sandbox DB (built-in SQLite with manufacturing data)
- [x] Superset auto-sync on connection create (CSRF fix applied)

### Data Connections — Airbyte
- [x] Connect abctl instance (OAuth2)
- [x] Connect Docker Compose instance (basic auth)
- [x] List sources / destinations / connections / jobs
- [x] Trigger sync
- [x] Cancel running job
- [x] Delete source
- [x] Stream schema discovery
- [x] Claude tools: list_sources, trigger_sync, check_jobs
- [x] Airbyte MySQL → Postgres sync verified end-to-end
- [x] Dashboard panels against Airbyte-synced data verified

### Data Connections — REST APIs
- [x] Generic REST (GET/POST/PUT/PATCH/DELETE)
- [x] SAP OData V2/V4 ($filter, $select hints)
- [x] Token expiry warning in connections list
- [x] Mock SAP OData bearer auth + pagination verified

### Data Connections — File Servers
- [x] SFTP (password + SSH key)
- [x] AWS S3 / S3-compatible (SigV4 signing via aws4)
- [x] Local filesystem
- [x] SMB/CIFS shares
- [x] CSV parsing
- [x] Excel (.xlsx) with sheet selection
- [x] PDF text extraction (pdf-parse direct lib import)
- [x] XML parsing (dot-path)
- [x] JSON parsing (dot-path)
- [x] Timestamp strategy (auto / filename / modified / content)

### Dashboards — Native (Mosaic panel builder)
- [x] Create / edit / delete dashboard
- [x] Panel builder (describe → Claude writes query)
- [x] Chart types: line, bar, scatter, pie, stat, table
- [x] Auto-refresh (configurable interval)
- [x] Dashboard time window substitution ({{time_from}} / {{time_to}})

### Dashboards — Superset Embedded (Mosaic Analytics)
- [x] Open in Analytics link on Dashboards list page (admin only)
- [x] Link Mosaic Analytics button on each dashboard card (admin only, one-click dropdown)
- [x] /api/superset/dashboards — lists all published Superset dashboards
- [x] /api/superset/embed — enables embedding, stores embed UUID in Mosaic DB
- [x] /api/superset/guest-token — generates short-lived guest token for authenticated users
- [x] SupersetEmbed component using @superset-ui/embedded-sdk
- [x] Header controls hidden when Superset dashboard is embedded
- [x] superset_embed_uuid column on dashboards table (DB migration)
- [x] Custom Superset Docker image (config baked in, not volume-dependent)
- [x] EMBEDDED_SUPERSET feature flag active, X-Frame-Options: ALLOWALL
- [x] Mosaic startup auto-sets Public role permissions in Superset (idempotent)
- [x] ERP Orders Overview dashboard verified rendering in Mosaic (3 charts, live data)

### RCA Workflows
- [x] Keyword-triggered RCA auto-detection
- [x] Workflow templates (data steps + renderers)
- [x] Pareto chart renderer
- [x] Fishbone diagram renderer
- [x] 5 Whys renderer
- [x] Corrective action plan renderer
- [x] Custom workflow CRUD (create, edit, delete, duplicate, reorder)

### Notifications & Rules
- [x] Slack webhook notifications
- [x] Microsoft Teams (MessageCard format verified)
- [x] Email (SMTP)
- [x] SMS via Twilio (geo-permissions tested)
- [x] WhatsApp via Twilio sandbox
- [x] Schedule triggers (Vercel Cron / cron sidecar)
- [x] Alert / condition-based rules
- [x] Notification groups (multi-channel dispatch verified)
- [x] Rules page with Alerts + Workflow tab switcher

### Monitoring & Analytics
- [x] Usage analytics (token counts, cost, by model, by user)
- [x] System monitoring (14 services, live health + latency)
- [x] Rate limiting (50 req/hr/user)

### Settings & Admin
- [x] Multi-user with roles (admin / user)
- [x] Runtime API key management (no restart)
- [x] Auth configuration tab
- [x] Settings tab persistence (URL hash)
- [x] Data sources tab consolidating Databases + API connections + File servers
- [x] Notifications tab (renamed from Integrations)
- [x] System health tab (renamed from Monitoring)
- [x] TypeScript errors resolved (zero tsc errors)

---

## Part 2 — Immediate Pending (Near-Term)

### Deployment Blockers
- [ ] **Docker Compose validation** — fresh `git clone` + `docker compose up -d` never validated (CRITICAL PATH)
- [ ] Production deploy verification (Vercel — pdf-parse, aws4 serverless quirks, streaming UX)
- [ ] OSIsoft PI Web API connection template (basic auth + bearer; NTLM deferred)

### Testing Gaps — Harness Sources Not Yet Wired
- [x] Wire MySQL ERP Lite (127.0.0.1:3307) — connected and Airbyte-synced
- [ ] Wire SQL Server CMMS to Mosaic (127.0.0.1:1434)
- [ ] Wire MongoDB Event Logs (127.0.0.1:27018)
- [ ] Wire SFTP share (127.0.0.1:2222, path: upload/initial)
- [ ] Cross-source query: "Line B machines with open work orders AND below 70% OEE" (Postgres + SQL Server)
- [ ] SFTP smoke test via ssh2 transport
- [ ] Mock SAP OData full pagination test

### Known Issues
- [!] SharePoint file server — UI option exists, implementation incomplete
- [!] Airbyte source creation routes to raw Airbyte UI (breaks invisible design principle)
- [!] Sync failure visibility absent (no error surfacing in Mosaic UI)
- [!] Plant Ops 4.4 Test connection leftover — delete from Settings to clean monitor
- [!] Superset Public role permissions — auto-set on startup but requires Superset to be up first (startup race edge case)

---

## Part 3 — Enterprise Readiness Roadmap

### Phase A — Test Infrastructure
- [ ] Vitest setup + test runner
- [ ] Unit tests: lib/encrypt.ts, lib/auth.ts, lib/db.ts
- [ ] API route tests: /api/auth, /api/connections, /api/chat
- [ ] SQL injection guard on all raw query paths
- [ ] Read-only enforcement tests
- [ ] CI pipeline (GitHub Actions on every push)

### Phase B — Observability & Migrations
- [ ] Replace console.log with Pino structured logging
- [ ] Request ID on all log lines (trace correlation)
- [ ] Expand /api/health (Airbyte, Superset, encryption key status)
- [ ] DB migration version table
- [ ] Migration files for existing schema (retroactive baseline)

### Phase C — Superset Hardening (embed complete, remaining items)
- [x] Fix Superset CSRF token handling (lib/superset-sync.ts) — fixed session 4
- [x] /api/superset/embed route — shipped session 6
- [x] /api/superset/guest-token route — shipped session 6
- [x] SupersetEmbed component (SDK-based) — shipped session 6
- [x] Wire Dashboards tab to embed — shipped session 6
- [x] End-to-end test: create in Superset → appears in Mosaic — verified session 6
- [ ] RLS filter injection per tenant in guest token payload (multi-tenant path only)
- [ ] Hide SharePoint option until implementation complete
- [ ] Superset volume backup procedure (dashboards/datasets/charts lost on volume wipe)

### Phase D — SSO
- [ ] Add Keycloak to Docker Compose (optional, SSO_ENABLED flag)
- [ ] Abstract AI provider layer (lib/ai.ts with AnthropicProvider interface)
- [ ] next-auth with OIDC/Keycloak provider
- [ ] Realm + client setup documentation
- [ ] LDAP/AD federation configuration guide
- [ ] Role mapping (Keycloak roles → Mosaic admin/user)
- [ ] SSO_ISSUER, SSO_CLIENT_ID, SSO_CLIENT_SECRET env vars
- [ ] Fallback email/password login preserved for non-SSO deployments
- [ ] End-to-end SSO login test

### Phase E — Audit Trail (ISO 27001)
- [ ] audit_events table (id, timestamp, actor_id, actor_email, actor_ip, session_id, action, resource, outcome, detail, checksum)
- [ ] lib/audit.ts helper — audit(action, resource, outcome, detail)
- [ ] Instrument: LOGIN, LOGOUT, LOGIN_FAILED
- [ ] Instrument: CONNECTION_CREATE, UPDATE, DELETE, CREDENTIAL_VIEW
- [ ] Instrument: USER_CREATE, DELETE, ROLE_CHANGE
- [ ] Instrument: QUERY_EXECUTE, RCA_RUN
- [ ] Append-only trigger (Postgres) or checksum chain (SQLite)
- [ ] Fluent Bit sidecar → OpenSearch log shipping
- [ ] OpenSearch + OpenSearch Dashboards in Docker Compose (optional profile)
- [ ] Audit log export (CSV / JSON) in admin Settings

### Phase F — AI Transparency Ledger
- [ ] ai_api_calls table (full schema with hash chain)
- [ ] lib/ai-ledger.ts — capture every outbound/inbound API packet
- [ ] SHA-256 hash chain (tamper evidence)
- [ ] Per-conversation packet inspector UI (timeline view in chat)
- [ ] Admin ledger view (filter by user, date, source — exportable)
- [ ] Chain integrity verification button
- [ ] Full packet export (encrypted archive, admin only)
- [ ] Data exposure summary (connections, tables, row counts per call)
- [ ] Integration into existing chat route (alongside usage_events insert)

### Phase G — Guardrails & Policy System
- [ ] guardrail_policies table
- [ ] policy_assignments table (user/role/connection scope)
- [ ] Schema allowlists per connection (tables/columns visible to Claude)
- [ ] Column-level exclusions
- [ ] Row-level filter injection (auto-WHERE per connection)
- [ ] Query complexity limits (max rows, max execution time)
- [ ] Topic scope definition (allowed/disallowed subjects)
- [ ] Persona lock (admin-set system prompt, not user-editable)
- [ ] Tool-level permissions per role
- [ ] Query review / approval queue for sensitive operations
- [ ] lib/guardrails.ts — resolveGuardrails(userId, connectionId)
- [ ] Policy builder UI in Settings → Policies
- [ ] Policy assignment matrix (roles × policies)
- [ ] Guardrail activity log (blocked queries, redirected topics)
- [ ] Test mode (simulate user's policy context)

### Phase H — Rate Limiting & Session Security
- [ ] Per-role query budgets (not just global 50 req/hr)
- [ ] Session timeout (auto-logout on inactivity)
- [ ] Concurrent session limits
- [ ] Forced re-auth for sensitive actions (credential view, user delete)
- [ ] Password policy enforcement (min length, complexity)
- [ ] Time-window restrictions (cron-style active/locked schedule)

### Phase I — Granular RBAC
- [ ] Extend role system beyond admin/user (plant manager, operator, viewer)
- [ ] Permission checks on all API routes per role
- [ ] Role assignment UI in Settings → Users
- [ ] Role-based tool invocation permissions

### Phase J — Developer API
- [ ] lib/ai.ts abstraction layer (AIProvider interface)
- [ ] /api/v1/* versioned prefix
- [ ] API key table + validation middleware
- [ ] Kong API Gateway in Docker Compose
- [ ] /api/v1/chat endpoint (machine-to-machine)
- [ ] /api/v1/rca endpoint (structured RCA trigger)
- [ ] /api/v1/conversations endpoint (read history)
- [ ] /api/v1/connections/:id/health endpoint
- [ ] Outbound webhooks (POST to registered URL on alert/RCA/sync)
- [ ] openapi.yaml spec
- [ ] Swagger UI documentation
- [ ] API key management UI in Settings
- [ ] Rate limiting per API key (via Kong)
- [ ] Usage metering per API key

### Phase K — Usage-Based Billing & Metering
- [ ] AI Credits abstraction (internal token → customer credit mapping)
- [ ] entitlements table (credit_balance, billing_period per customer)
- [ ] OpenMeter integration (emit metering events per chat completion)
- [ ] Overage detection (warn at 80%, soft-block at 110%)
- [ ] Usage tab shows credit consumption vs entitlement (not raw tokens)
- [ ] tenant_id on usage events for billing rollup
- [ ] Lago integration for invoice generation (Phase 2)

### Phase L — Backup & Disaster Recovery
- [ ] pgBackRest sidecar in Docker Compose
- [ ] Scheduled automated backups (SQLite snapshot + Postgres)
- [ ] One-command restore procedure
- [ ] Backup status in system monitoring tab
- [ ] Documented restore runbook

### Phase M — Data Encryption at Rest
- [ ] SQLCipher for SQLite path (encrypted DB file)
- [ ] Document recommended disk encryption posture
- [ ] ai_api_calls.messages_sent column encrypted separately

### Phase N — Data Retention Policies
- [ ] Admin-configurable conversation retention (auto-delete after N days)
- [ ] On-demand user data purge (GDPR right to erasure)
- [ ] Retention policy UI in Settings → Security
- [ ] Audit log retention separate from conversation retention

### Phase O — Installer Hardening
- [ ] Universal installer (Linux servers, cloud VMs, headless)
- [ ] Visual pre-flight check UI
- [ ] Real-time installation progress
- [ ] Post-install validation dashboard
- [ ] SSO_ENABLED flag wires Keycloak into Compose automatically
- [ ] Audit profile flag wires OpenSearch + Fluent Bit automatically

### Phase P — External Security Review
- [ ] Penetration test (schedule now, calendar time not build time)
- [ ] Fix critical / high findings
- [ ] Security report for enterprise prospects

---

## Part 4 — ThingsBoard IoT Integration

### Layer 1 — Dashboard Embed
- [ ] ThingsBoard in Docker Compose (optional service)
- [ ] thingsboard_instances table + TabIoT settings UI
- [ ] JWT auth client (login, token refresh)
- [ ] IoT tab in main navigation
- [ ] Iframe embed with JWT token exchange
- [ ] Standalone URL param (hide ThingsBoard chrome)
- [ ] CSS injection via Nginx reverse proxy (theme matching)

### Layer 2 — Dashboard Picker
- [ ] thingsboard_dashboards table
- [ ] Admin UI to browse + pin ThingsBoard dashboards
- [ ] Dashboard display name mapping

### Layer 3 — IoT Widget Types (Path 3 — Own Rendering)
- [ ] Gauge widget (radial/linear, value vs min/max range)
- [ ] Status/state widget (online/offline/alarm indicator)
- [ ] Multi-metric real-time feed (multiple sensors, one device)
- [ ] Alarm list widget (active alarms with severity + status)
- [ ] IoT panel builder (device picker, metric selector, refresh interval)
- [ ] IoT dashboard tab (separate from Superset Dashboards tab)

### Layer 4 — Claude Tool
- [ ] query_thingsboard tool in lib/tools.ts
- [ ] Device list + asset list API calls
- [ ] Telemetry fetch (time-series + latest values)
- [ ] Alarm list API
- [ ] WebSocket live updates (v2 — polling for v1)

---

## Part 5 — Predictive Maintenance Intelligence

### Condition-Based Monitoring
- [ ] Background IoT condition monitor (polling loop vs ThingsBoard)
- [ ] trigger_type: 'iot_condition' in integration_rules
- [ ] Condition types: threshold, rate-of-change, duration, composite, baseline deviation
- [ ] Suppress / debounce (avoid false positive floods)
- [ ] Feedback loop ("was this alert useful?" yes/no)

### Automated RCA on Anomaly
- [ ] Auto-RCA trigger when condition fires
- [ ] AI-enriched notification (anomaly context + maintenance history)
- [ ] RCA result included in notification (not just raw alert)
- [ ] Notification includes: pattern match, PM overdue status, estimated repair

### CMMS Integration
- [ ] CMMS connector templates: SAP PM, Maximo, UpKeep, Fiix, Limble
- [ ] Read path: work orders, asset history, PM schedules
- [ ] Write path: create work order in external CMMS
- [ ] Work order pre-populated: asset, fault, priority, AI summary, Mosaic link

### Maintenance Actions Module (for customers without CMMS)
- [ ] maintenance_actions table (asset, description, priority, status, assigned_to, rca_link)
- [ ] Maintenance Actions tab in Mosaic UI
- [ ] Create / assign / close work orders
- [ ] AI-generated work order from RCA output
- [ ] Escalation to external CMMS when connected

### Preventive Maintenance Intelligence
- [ ] PM Analysis workflow template
- [ ] AI-driven interval recommendation from failure history
- [ ] Scheduled PM analysis trigger (weekly/monthly per asset)
- [ ] PM schedule adjustment output (surfaced in UI + optional CMMS write-back)

---

## Part 6 — Reporting

### Report Templates
- [ ] report_templates table (sections, queries, AI steps, schedule, recipients)
- [ ] Template builder UI ("what should Mosaic analyse?" not "what charts?")
- [ ] Section types: AI-written narrative, data query + table, chart, alarm list
- [ ] report_instances table (generated output, timestamp, source template)

### Report Generation
- [ ] Report generation pipeline (query → AI write → assemble)
- [ ] PDF renderer (Puppeteer or HTML-to-PDF)
- [ ] Scheduled delivery (extends existing notification system)
- [ ] Ad-hoc from conversation ("create a report of this analysis")
- [ ] Report library (browse, search, download past reports)
- [ ] Persistent URL per report instance (entry point back into Mosaic)

### Priority Report Types
- [ ] RCA Report (package RCA workflow output as shareable PDF)
- [ ] Maintenance Intelligence Report (weekly/monthly AI summary)
- [ ] Operational Performance Report (OEE, downtime, quality by line)

---

## Part 7 — Multi-Tenant SaaS (Optional Future Path)

- [ ] organizations table + org_id on all resource tables
- [ ] Subdomain routing (acme.mosaicapp.com)
- [ ] Org-scoped admin role
- [ ] Invitation flow (email invite → org join)
- [ ] Billing integration (Stripe or Lago per org)
- [ ] Superset multi-tenant RLS (org_id filter on guest tokens)
- [ ] Shared Airbyte workspace per org (or per-org instance)

---

## Part 8 — Air-Gapped / Local LLM (Defence, Nuclear)

- [ ] lib/ai.ts provider abstraction (prerequisite — see Phase J)
- [ ] OllamaProvider implementation
- [ ] Llama 3.1 70B configuration + documentation
- [ ] Capability statement (honest delta vs Claude for complex RCA)
- [ ] Air-gapped installer profile (no Anthropic API call, all local)
- [ ] Prompt tuning for local models (compensate for weaker tool use)

---

## Decisions Log

| Decision | Rationale |
|---|---|
| One instance per customer, not shared SaaS | Core trust proposition for industrial buyers |
| SQLite for single-tenant, Neon Postgres for cloud | Right tool per deployment model |
| Airbyte invisible to end users | Design principle — all ops proxied via Mosaic API |
| Superset: embed for non-technical (guest token SDK), direct for technical | Two-tier access model — embed complete session 6 |
| Claude as primary AI, not multi-model | Analysis quality is a feature; don't dilute it |
| Keycloak for SSO (not Auth.js alone) | Enterprise AD federation, familiar to IT teams |
| OpenMeter for metering, Lago for billing | Open-source, self-hostable, fits on-premise model |
| Guardrails as policy system, not scattered settings | Enterprise IT familiar pattern, scales with deployments |
| ThingsBoard Path 3 (own rendering) preferred over embed | Aligns with invisible infrastructure principle |
| CMMS: integrate don't replace | "Bring AI to the data" — don't become a CMMS |
| AI Transparency Ledger as trust instrument | Turns security concern into a proof point |
| Superset config baked into Docker image, not volume | Eliminates config loss on volume recreation |
| Superset Public role permissions set via Mosaic startup API | Automated first-run, no manual Superset config steps |

---

*Tick items as you ship them. Keep the Decisions Log updated when new architectural choices are made.*
