# Mosaic — Master Feature Hit List
**Last updated:** 25 May 2026  
**Baseline:** Session 8 complete (HEAD: c539640)  
**Purpose:** Tick off as you go. Organised by current state → near-term → strategic.

---

## 📊 Scoreboard

| Category | Done | Remaining | Total |
|---|---|---|---|
| Core platform (Part 1) | 76 | 0 | 76 |
| Near-term / blockers (Part 2) | 10 | 8 | 18 |
| Enterprise roadmap (Part 3, Phases A–P) | 62 | 59 | 121 |
| ThingsBoard IoT (Part 4) | 0 | 15 | 15 |
| Predictive Maintenance (Part 5) | 0 | 18 | 18 |
| Reporting (Part 6) | 0 | 9 | 9 |
| Multi-Tenant SaaS (Part 7) | 0 | 7 | 7 |
| Air-Gapped / Local LLM (Part 8) | 0 | 6 | 6 |
| **Total** | **148** | **122** | **270** |

> **Deployment readiness:** Docker Compose validation complete. Mosaic v1.2.0 is customer-deployable on-prem.  
> Remaining blockers: Production Vercel deploy verification (pdf-parse, aws4 serverless behaviour).

---

## Status Key
- `[x]` Done and verified in testing
- `[~]` Built but not yet tested / partially working
- `[ ]` Not built — pending
- `[!]` Known issue / needs fix

---

## Part 1 — Current Build: Verified ✅ (76/76)

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
- [x] Tool result truncation — 3-layer cap (8K string, 500-char cells, 60K history trim) prevents 429 / context overflow
- [x] Lazy-loaded Recharts — chat page chunk 135 kB → 78 kB; bar/line/pie load on demand only

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
<!-- OAuth2 auth helper (lib/api-auth.ts) is implemented and error-propagation is complete. Unit tests tracked in Phase A. -->
- [x] Generic REST (GET/POST/PUT/PATCH/DELETE)
- [x] SAP OData V2/V4 ($filter, $select hints)
- [x] Token expiry warning in connections list
- [x] Mock SAP OData bearer auth + pagination verified
- [x] OAuth2 error fully propagated to UI — upstream provider message (e.g. Zoho invalid_client) surfaces in chat and Try-It panel
- [x] OAuth2 token cache evicted on revocation signals (invalid_grant, invalid_token, token_expired, access_denied)
- [x] SSRF path guard — blocked paths show friendly "Request blocked by security policy" banner in Try-It instead of raw JSON
- [x] SSRF blocklist hardened — removed 'localhost' literal, added '::1' (IPv6 loopback)

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
- [x] Stats Engine in System Health (green/down status, "12 analysis types available")
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
- [x] Saving spinner always clears — setSaving(false) in finally blocks across TabDatabases, TabGuardrails, TabAuth

### Guardrails (8 types — complete)
- [x] T1 AI Output Rules — injected into system prompt, plain-English policies
- [x] T2 Data Access — blocked_columns / row_filter per connection per role
- [x] T3 Action Controls — global read-only toggle + per-tool/method blocks
- [x] T4 Usage Limits — daily/monthly token + request budgets, hard block at limit
- [x] T5 Content Filtering — blocklist/allowlist + regex on user message before Claude
- [x] T6 Egress Audit — every chat logged: user, sources, tokens, model, preview
- [x] T7 Human-in-the-Loop — write API calls pause for human confirmation
- [x] T8 Injection Defense — tool results wrapped with safety delimiter; JSON structure preserved
- [x] Guardrails UI — collapsible sections, count badge, global search, per-section search + pagination
- [x] SQLite JSON auto-parse bug fixed — enforcement was silently failing on all 8 types

### Analysis Capabilities (Stats Engine)
- [x] 12 statistical analyses: control_chart, process_capability, trend, anomaly_detection, changepoint_detection, pareto, correlation, regression, weibull, mtbf, oee_decomposition, hypothesis_test
- [x] Stats sidecar (FastAPI, port 8001) auto-starts with npm run dev via concurrently
- [x] Stats Engine health check in System Health monitor
- [x] Demo modal on every analysis card — live result from sidecar on realistic industrial sample data
- [x] SVG mini-charts in demo modal (sparkline with UCL/LCL, bar chart for Pareto)
- [x] Admin can disable individual analysis types

---

## Part 2 — Immediate Pending (Near-Term)

### Deployment Blockers
- [x] **Docker Compose validation** — validated end-to-end. 6 bugs found and fixed (see commits 76428bf, d140456)
- [ ] Production deploy verification (Vercel — pdf-parse, aws4 serverless quirks, streaming UX)
- [ ] OSIsoft PI Web API connection template (basic auth + bearer; NTLM deferred)

### Testing Gaps — Harness Sources Not Yet Wired
- [x] Wire MySQL ERP Lite (127.0.0.1:3307) — connected and Airbyte-synced
- [x] Wire SQL Server CMMS to Mosaic (127.0.0.1:1434) — validated session 4
- [x] Wire MongoDB Event Logs (127.0.0.1:27018) — validated session 4
- [x] Wire SFTP share (127.0.0.1:2222, path: upload/initial) — validated session 4, 3 bugs fixed
- [x] Cross-source query: "Line B machines with open work orders AND below 70% OEE" (Postgres + SQL Server) — validated session 4
- [x] SFTP smoke test via ssh2 transport — validated session 4
- [x] Mock SAP OData full pagination test — validated session 4

### Known Issues
- [x] SharePoint file server — implemented (Microsoft Graph API transport, commit 68deb1f)
- [x] Airbyte source creation routes to raw Airbyte UI — fixed, full Mosaic-native wizard built
- [x] Sync failure visibility absent — fixed, AbStatusBadge renders failed/running/succeeded inline
- [!] Plant Ops 4.4 Test connection leftover — delete from Settings to clean monitor
- [!] Superset Public role permissions — auto-set on startup but requires Superset to be up first (startup race edge case)

---

## Part 3 — Enterprise Readiness Roadmap

### Phase A — Test Infrastructure
- [x] Vitest setup + test runner (vitest.config.ts, npm test)
- [x] Unit tests: lib/encrypt.ts — roundtrip, edge cases, legacy format, malformed input crash fix
- [x] Unit tests: lib/fetch.ts — all HTTP status codes, error message format, network failure
- [x] Unit tests: lib/rca.ts — isRcaQuery keyword detection, parseRcaOutput block parsing
- [x] Unit tests: lib/guardrails.ts — checkInputForInjection all 9 patterns
- [ ] Unit tests: lib/api-auth.ts — token fetcher, refresh_token branching, RFC 6749 error parsing, cache eviction
- [ ] API route tests: /api/auth, /api/connections, /api/chat
- [ ] SQL injection guard on all raw query paths
- [ ] Read-only enforcement tests
- [x] CI pipeline (GitHub Actions — .github/workflows/test.yml, runs on every push to main)

### Phase B — Observability & Migrations
- [x] Replace console.log with Pino structured logging (commit 1ad3e38)
- [x] Request ID on all log lines — requestId parsed in log viewer (commit 753eb83)
- [x] Expand /api/health (Airbyte, Superset, encryption key status) — 14 services in monitor
- [x] DB migration version table (lib/migrate.ts, schema_migrations table)
- [x] Migration files for existing schema (retroactive baseline)

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
- [x] Add Keycloak to Docker Compose (SSO_ENABLED flag, COMPOSE_PROFILES=sso)
- [ ] Abstract AI provider layer (lib/ai.ts with AnthropicProvider interface)
- [x] next-auth with OIDC/Keycloak provider (commit 6fed649)
- [x] Realm + client setup documentation (docs/KEYCLOAK.md)
- [x] LDAP/AD federation configuration guide
- [x] Role mapping (Keycloak roles → Mosaic admin/user)
- [x] SSO_ISSUER, SSO_CLIENT_ID, SSO_CLIENT_SECRET env vars
- [x] Fallback email/password login preserved for non-SSO deployments
- [x] JIT (just-in-time) SSO user provisioning (commit 406f618)
- [ ] End-to-end SSO login test

### Phase E — Audit Trail (ISO 27001)
- [x] audit_events table with SHA-256 hash chain (commit 37f97e8)
- [x] lib/audit.ts helper — audit(action, resource, outcome, detail)
- [x] Instrument: LOGIN, LOGOUT, LOGIN_FAILED
- [x] Instrument: CONNECTION_CREATE, UPDATE, DELETE, CREDENTIAL_VIEW
- [x] Instrument: USER_CREATE, DELETE, ROLE_CHANGE
- [x] Instrument: QUERY_EXECUTE, RCA_RUN
- [x] Append-only + hash chain (SHA-256 checksum per event, tamper evidence)
- [x] ISO 27001 compliance documents — ISMS Policy + Statement of Applicability, live-generated (commit bfa1a1a)
- [x] ISO 27001 live compliance status panel in Audit Trail tab
- [x] Audit trail viewer with free-text search and pagination (commit 32ba647)
- [x] Audit export (CSV/JSON) in admin Settings
- [ ] Fluent Bit sidecar → OpenSearch log shipping (optional enterprise add-on)
- [ ] OpenSearch + OpenSearch Dashboards in Docker Compose (optional profile)

### Phase F — AI Transparency Ledger
- [x] transparency_log table (one row per assistant response, commit 24fc058)
- [x] lib/transparency.ts — writeTransparencyLog(), resolves friendly connection labels
- [x] Admin ledger view (AI Decision Log in Settings sidebar — filter, search, pagination)
- [x] Cursor-based pagination for scale (commit e94b945)
- [x] Data source names shown in chat tool pill (commit 369ea58, capped at 3 + overflow)
- [ ] SHA-256 hash chain on transparency log (tamper evidence)
- [ ] Per-conversation packet inspector UI (timeline view in chat)
- [ ] Chain integrity verification button
- [ ] Full packet export (encrypted archive, admin only)
- [ ] Data exposure summary (connections, tables, row counts per call)
- [ ] Integration into existing chat route (alongside usage_events insert)

### Phase G — Guardrails & Policy System
- [x] 8-type guardrails system (T1–T8) — shipped session 7
- [x] Guardrails UI with global search, collapsible sections, pagination — shipped session 7
- [ ] Schema allowlists per connection (tables/columns visible to Claude)
- [ ] Column-level exclusions
- [ ] Row-level filter injection (auto-WHERE per connection)
- [ ] Query complexity limits (max rows, max execution time)
- [ ] Topic scope definition (allowed/disallowed subjects)
- [ ] Persona lock (admin-set system prompt, not user-editable)
- [ ] Tool-level permissions per role
- [ ] Query review / approval queue for sensitive operations
- [ ] Policy builder UI in Settings → Policies
- [ ] Policy assignment matrix (roles × policies)
- [ ] Guardrail activity log (blocked queries, redirected topics)
- [ ] Test mode (simulate user's policy context)

### Phase H — Rate Limiting & Session Security
- [x] Per-role query budgets (guardrail_usage_limits table — daily/monthly token + request budgets)
- [ ] Session timeout (auto-logout on inactivity)
- [ ] Concurrent session limits
- [ ] Forced re-auth for sensitive actions (credential view, user delete)
- [ ] Password policy enforcement (min length, complexity)
- [ ] Time-window restrictions (cron-style active/locked schedule)

### Phase I — Granular RBAC
- [x] Extend role system beyond admin/user — RBAC enforcement on all API routes (commit 08cfc71)
- [x] Permission checks on all API routes per role
- [ ] Custom roles beyond admin/user (plant manager, operator, viewer)
- [ ] Role assignment UI in Settings → Users
- [ ] Role-based tool invocation permissions

### Phase J — Developer API
- [ ] lib/ai.ts abstraction layer (AIProvider interface) — prerequisite for Phase N/P8
- [x] /api/v1/* versioned prefix — 7 endpoints shipped (commit 2e1141f)
- [x] API key table + validation middleware (developer_api_keys table, lib/dev-api-auth.ts)
- [ ] Kong API Gateway in Docker Compose
- [x] /api/v1/chat endpoint (machine-to-machine)
- [x] /api/v1/rca endpoint (structured RCA trigger)
- [x] /api/v1/conversations endpoint (read history)
- [x] /api/v1/connections/:id/health endpoint
- [x] /api/v1/query endpoint (natural language query — bonus, not on original list)
- [x] /api/v1/users endpoint
- [x] Outbound webhooks (POST to registered URL — lib/notify.ts webhook channel type)
- [x] openapi.yaml spec (391 lines, public/openapi.yaml)
- [x] Swagger UI documentation (/api/v1/docs — Swagger UI against openapi.yaml)
- [x] API key management UI in Settings → Developer API
- [x] Rate limiting per API key (application-level, per-hour counting with 429 + headers)
- [x] Usage logging per API key (logDevApiUsage() on every v1 endpoint)
- [ ] Rate limiting via Kong (enterprise-grade — deferred, current app-level sufficient for v1)

### Phase K — Usage-Based Billing & Metering
- [ ] AI Credits abstraction (internal token → customer credit mapping)
- [ ] entitlements table (credit_balance, billing_period per customer)
- [ ] OpenMeter integration (emit metering events per chat completion)
- [ ] Overage detection (warn at 80%, soft-block at 110%)
- [ ] Usage tab shows credit consumption vs entitlement (not raw tokens)
- [ ] tenant_id on usage events for billing rollup
- [ ] Lago integration for invoice generation (Phase 2)

### Phase L — Backup & Disaster Recovery
- [x] Backup sidecar in Docker Compose (services/backup/, mosaic-backup container)
- [x] Scheduled automated backups — every 24h default, configurable via UI or .env
- [x] One-command restore procedure (scripts/restore.sh — requires 'yes' confirmation)
- [x] Backup status in System Health tab (status row with last backup time, archive info)
- [x] Backup & restore Settings tab — schedule picker, run-now button, archive list
- [x] docs/BACKUP.md — full reference: what's backed up, what isn't, off-site sync examples
- [x] On-demand manual backup (scripts/backup.sh)

### Phase M — Data Encryption at Rest
- [ ] SQLCipher for SQLite path (encrypted DB file)
- [ ] Document recommended disk encryption posture
- [ ] ai_api_calls.messages_sent column encrypted separately

### Phase N — Data Retention Policies
- [x] Admin-configurable retention per dataset (data_retention_settings table, commit 7ca6f20)
- [x] Nightly auto-purge per policy
- [x] On-demand purge (Settings → Data retention → Run now per dataset or Run all)
- [x] Retention policy UI in Settings → Data retention (connector-only deployment toggle)
- [x] Audit log retention separate from conversation retention

### Phase O — Installer Hardening
- [x] Universal installer bash script (install.sh — Linux + macOS, headless-compatible, commit f4ae47d)
- [x] SSO_ENABLED flag wires Keycloak into Compose automatically (install.sh auto-manages COMPOSE_PROFILES)
- [x] CISO_SUPERUSER credentials substituted by installer (commit bccb46f)
- [x] docs/INSTALL.md — customer-facing install guide (241 lines, no developer content)
- [x] docs/FIRST_STEPS.md — post-install verification checklist
- [ ] Visual pre-flight check UI (RAM, disk, Docker version, ports free)
- [ ] Real-time installation progress (stream docker compose logs to installer)
- [ ] Post-install validation dashboard (all services green before handover)
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
| Stats sidecar auto-starts via concurrently in npm run dev | No manual sidecar management; always available in dev |
| npm run build kills dev server first | Prevents .next cache corruption from concurrent build + dev |
| Developer API rate limiting at app level, not Kong (v1) | Kong deferred — application-level 429 sufficient for first customer |
| Backup sidecar reads config file every 10s loop | UI schedule changes apply without container restart |
| docs/ in repo, rendered as /docs/* in-app | Version-controlled with code; works air-gapped; no external docs site needed |
| lib/fetch.ts safeJson() as shared error utility | 70 call sites standardised; raw JS errors never reach users |

## Part Z — Strategy Session (22 Aug 2026): Decisions & Actions

Consolidated view of a working session covering dashboards, deployment, licensing,
bundle strategy, security, and multi-model inference. Grouped as **Decisions**
(settled), **Actions** (to build, not yet started), and **Open questions**.

### Shipped this session
- `fix(stats)` — disabled-analyses gate enforced at execution + hypothesis_test shape guidance; found/fixed missing `/api/stats/settings` route and the JSON-auto-parse read bug (3 readers).
- `fix(support)` — remote-support audit accuracy (no duplicate START, reconciled END on abnormal death, friendly 503).
- `fix(superset)` — database sync made observable (root cause: `log` never imported -> every log call threw, swallowed by `.catch`); added `/api/superset/sync` backfill/status endpoint.
- `feat(superset)` — programmatic dashboard creation engine (`lib/superset-dashboard.ts`) + `/api/superset/create-dashboard`. Proven E2E: dataset->chart->dashboard, numbers match source exactly.
- Chart-render fix — categorical dimensions need `dist_bar`, NOT `echarts_timeseries_bar` (which requires a temporal x-axis). Metric-definition on dataset for aggregate viz types. Caught by **visual** validation, not API test.
- `docs/SERVICE_CREDENTIALS.md` — how each bundled service authenticates + current dev values.

### DECISIONS (settled)
| Decision | Rationale |
|---|---|
| **Dashboards -> Superset, deprecate native engine** | Native engine (14 files, 7 dashboards) is buggy and duplicates Superset. LLM generates SQL+config -> creates in Superset via API. Proven feasible E2E this session. Don't rip out native until Superset parity proven. |
| **Superset create-flow uses per-viz templates, not free-form LLM params** | Config is version-sensitive; LLM fills field names only. Categorical vs temporal viz-type selection must be type-aware. |
| **Two human-in-the-loop gates** | Gate 1: confirm SQL + returned rows. Gate 2: confirm chart mapping. Skippable-with-defaults for power users. Freeze confirmed SQL for scheduled refresh (never re-run LLM). |
| **Superset SQL-only boundary is acceptable** | Every enterprise BI tool draws this line. Answer = land-then-dashboard via Airbyte. Exploratory (chat/RCA) surface spans ALL sources; persistent-dashboard surface spans all via Airbyte landing. |
| **Deployment: one Node core (`install.js`), 3 surfaces** | Electron DMG/EXE for Mac+Windows demos/PoC; `--headless` for Linux prod. Preflight -> step 1. Profile selection (demo lean ~4-5 containers vs prod full). |
| **Installer mature but payload STALE (April, 7 services vs current 20+)** | Refresh payload before anything else. Move preflight to step 1. Fix broken checks (disk >=2GB too low, macOS RAM no-op, Docker mem threshold). |
| **Licensing: per-instance + per-seat, Ed25519 offline, fail-open** | Instance ID = UUID in kv_settings. Seats = COUNT(users WHERE banned=false), named. Buy licence server (Keygen self-host), build only Mosaic-side verify. Gate downloads + private registry = real protection, not runtime checks. SSO JIT bypasses seat check — both paths need gating. |
| **SSO: Scenario B ONLY (customer registers Mosaic on their IdP)** | Drop bundled-Keycloak-as-primary (Option A). Keycloak = dev/demo only. Real deployments connect to customer Azure AD/Okta/etc. |
| **POC reset: volume nuke (`down -v && up`), not selective script** | Zero leak risk (no judgment about what to keep). Re-seeds managed infra (ES search index, 4 RCA templates) automatically. Must seed admin creds from `.env.demo` (nuke wipes admin account). |
| **Bare Mosaic = empty of customer data, KEEPS managed seeds** | Test harness (`test-data/docker-compose.yml`) stays a SEPARATE on-demand thing, not baked into baseline. |
| **CISO_API_URL field = optional override, not required** | Auto-defaults to bundled `http://ciso-backend:8000`. Relabel hint text. |
| **Don't bundle Data Formulator** | MIT-licensed (CAN bundle legally) but it's a churning 0.x research beta that duplicates the moat AND Superset. BORROW its "concept-binding" UX for the chart-mapping gates; evaluate **Flint** (its chart layer) as a possible inline-chart component. |
| **Superset's real value = its semantic/dataset layer, not just charts** | Data Formulator consumes Superset datasets as a source — proves layer-1 (governed datasets + metrics) is independently valuable. Consider making Mosaic's create-flow produce **durable, named, metric-defined datasets** (manufacturing OEE/MTBF definitions = defensibly ours) rather than throwaway per-chart ones. |
| **Bundle = lean core + optional profiles** | Core: Mosaic + stats + Superset. Optional (profile-gated): Airbyte (ingestion), n8n (automation), CISO (GRC if customer lacks one), Keycloak (SSO, dev only), OpenMeter (when billing live). Serves both demo laptop and enterprise. |
| **Multi-provider inference: build it, but tier by capability** | Add GPT + Meta + customer-hosted (Azure OpenAI / self-hosted) for procurement/sovereignty/leverage. BUT tool-use fidelity (RCA's 25-step chains) diverges by provider — tier models ("validated for full RCA" vs "lighter queries only"), re-validate prompts/guardrails per provider. Extends Phase J `lib/ai.ts`. |
| **Mosaic NOT yet production-ready for unsupervised enterprise deploy** | Demo-ready yes; supervised design-partner pilot nearly. Blockers: fresh-install unverified, hostname/redirect bug, dev-grade security defaults, stale installer, no external security review. |

### ACTIONS (to build — not started)
| Action | Notes / dependency |
|---|---|
| **Bundle audit** | Enumerate every service: resource cost, core/optional/duplicative, dependencies. Wire compose profiles to make Airbyte/n8n/CISO/OpenMeter cleanly optional. Decide OpenMeter (4 heavy containers, pre-revenue) + CISO (whole 2nd product, login still broken) fate. |
| **Render smoke-test in create-flow** | After chart create, call `/chart/data` with the chart's OWN stored params, confirm 200 + rows before declaring success. Converts "created but doesn't render" (today's bug) into a build-time catch. Highest-value single addition. |
| **Chart-spec suggestion helper** | LLM proposes `{vizType, dimension, value}` from confirmed query columns for Gate 2. Must be type-aware (categorical->dist_bar, temporal->echarts). Last backend piece of the dashboard flow. |
| **Dashboard flow UI** | Stitch generate->confirm-rows->confirm-chart->create. Reuse existing `SupersetEmbed.tsx`. (Browser access denied this session — needs visual work.) |
| **Airbyte SQL destination -> Mosaic connection bridge** | Auto-register an Airbyte SQL destination (Postgres/ClickHouse ONLY — NOT Mongo) as a Mosaic connection -> normal Superset-sync. Credentials handling needed. |
| **`demo-reset.sh`** | `down -v && up` + seed admin/API key from `.env.demo`. Verify full nuke-and-reseed produces correct bare instance (may surface `rca_sessions` missing-table on truly fresh boot). |
| **Bundled-services credential panel (admin UI)** | Admin rotates Superset/CISO/Airbyte creds from Mosaic UI, no CLI/env. Writes to kv_settings (source of truth) + calls service admin API + verifies reachability after. Airbyte caveat: env-var cred -> needs restart. Audit as `CREDENTIAL_ROTATED`. Solves the drift footgun by construction. |
| **SSO intake form** (`docs/SSO_INTAKE_FORM.md`) | Bidirectional: Section 1 = what customer needs from us (redirect URI etc.); Section 2 = what we need from them (issuer, client id/secret, tenant id, claim mapping, JIT/role rules). Verify exact callback path + claim names against `app/api/auth/callback` code. Drafted, not yet written to repo. |
| **SSO setup automation** | Scenario-B only: auto-configure Mosaic's side + structured hand-off. Gated on knowing deployment hostname (ties to setup wizard). |
| **Fix `MOSAIC_HOSTNAME` / redirect** | Empty by default -> login/invite/SSO break on real URLs. Belongs in setup wizard "how will people reach Mosaic?" step. Known live bug. |
| **Security review (Claude-driven, internal)** | Structured pass (OWASP + auth + secrets + injection + LLM tool-abuse) building on `claude_mosaic-security-review.md`. Force-multiplier BEFORE external review — NOT a substitute (independence + credibility require external). Suggested: high-risk surface first. |
| **Hardening** | Fail-loud on default creds; audit `0.0.0.0` port bindings (internal-only via Caddy); MFA; session revocation; break-glass local admin; SQL-injection + read-only adversarial tests; dependency/CVE scan; secret-in-logs sweep. |
| **Multi-provider `lib/ai.ts` (Phase J)** | First step: audit where Claude-specific tool-calling assumptions live -> scopes "true multi-provider tool-use" job vs easy "multi-provider chat" job. Per-model capability manifest. |
| **`rca_sessions` missing table** | Referenced in chat route, possibly never created in `setup.ts`. Check on a fresh boot — flagged as first thing to verify. |
| **Stats sidecar Docker healthcheck** | Shows "unhealthy" but serves 200 — misconfigured healthcheck (cosmetic, misleads monitoring). |
| **3 failing Superset connections** | Plant Ops 4.4 Test / ERP Lite / CMMS fail live connection test on backfill (creds/reachability). Now visible thanks to sync fix. |

### OPEN QUESTIONS (need Ankur's input)
- Demo-partner POC (supervised, you stand it up) vs shipped installer (unsupervised)? Determines how much hardening/fresh-install work is prerequisite vs parallel.
- Prospects asking for **dashboards** specifically, or excited about **ask-questions-get-answers**? If latter -> keep dashboarding lean, Superset firmly supporting-role.
- Each POC starts from **bare** or from a **standard demo baseline** (snapshot restore)? Shapes reset design.
- Any real customer/demo data depends on native dashboards (7 exist) or CISO before deprecation/optional-gating?

---

*Tick items as you ship them. Keep the Decisions Log updated when new architectural choices are made.*
