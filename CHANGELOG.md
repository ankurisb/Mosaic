# Changelog

All notable changes to Mosaic are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

## [1.3.19] - 2026-10-10

### Fixed
- **API Keys: bundled services no longer offer pointless credential configuration.** For a service that runs in *bundled* mode (its URL is the compose default, not a bring-your-own override), the admin user/password are baked by docker-compose and shared with the running container — "configuring" them in the UI could only desync Mosaic's auth from the bundled container and break the integration. Those fields (Superset service user/password, CISO admin email/password) now show as **managed by Mosaic** with no Set/Override. The moment an admin points a service at their own instance (sets its URL), the credentials become editable again for that BYO instance. A stray override left on a managed credential offers a one-click **Reset to bundled**. (n8n's API key is generated inside n8n and is never bundle-baked, so it stays user-configurable as before.)
- **About tab: corrected inaccurate/irrelevant deployment details.** Mosaic ships as an on-premises Docker stack, but the About panel described a Vercel/serverless vs "Self-hosted (Node.js)" split that never applies (the Vercel path is dead code on-prem) and labelled a non-SQLite database "Cloud · auto-scaling". Platform now reads **On-premises (Docker)**, a server database reads **Server database**, the scheduler sub-text is always the built-in Node timer, and the deployment banner reflects on-premises — no more Vercel-mode branching.

## [1.3.18] - 2026-10-10

### Fixed
- **System Watchdog opens in the browser on hosted boxes.** The watchdog on `:3099` served plain HTTP only. Because the main site is HTTPS, browsers with HTTPS-First upgrade `http://host:3099` to `https://host:3099`, which had no TLS listener — so the page "wouldn't open" even though the service was healthy (curl saw HTTP 200). The watchdog now serves **HTTPS on :3099** using Caddy's existing certificate (read-only from the `caddy-data` volume; it needs only the cert files on disk, so it still works while Caddy is down) and hot-reloads the cert on renewal. Plain HTTP moves to an internal `:3098` for localhost scripts and health checks. Localhost / non-TLS installs (no `MOSAIC_HOSTNAME`) fall back to plain HTTP on `:3099` exactly as before. The in-app "System Watchdog" link is now protocol-relative so it inherits HTTPS on a real deployment.
- **Watchdog no longer cries wolf over edition-gated services.** Components not included on an edition (CISO, the OpenMeter metering stack) were counted as failures when their containers were simply absent, showing a false "6 issues detected" on a healthy trial box. Edition-/add-on-gated services that aren't deployed now render neutrally as "Not deployed" and are never counted as issues; if such a service *is* deployed but crashes, it still flags normally. Required core services (Mosaic, Superset, Elasticsearch, Superset DB, Redis) are unchanged.
- **Watchdog memory reading corrected.** The "Available memory" card parsed `/proc/meminfo` by awk output order, which lists `MemTotal` before `MemAvailable`, so the two were swapped (showing e.g. "31557 MB free of 21950 MB total"). Values are now read by field name.

## [1.3.17] - 2026-10-09

### Changed
- **Prompt caching enabled on the chat path.** The system prompt and tool definitions — identical across every turn of an agentic query's tool-use loop — are now marked cacheable. After the first call, that large prefix is read from cache at ~10% of the input price instead of being re-sent and re-processed each turn. On multi-step queries (which re-send a compounding context) this cuts input cost and latency substantially; usage now populates the Cache Tokens column. Cost accounting already priced cache reads/writes correctly (0.1× / 1.25×), so reported costs reflect the savings automatically.

## [1.3.16] - 2026-10-09

### Fixed
- **Welcome emails and Google SSO now use the real URL.** `NEXT_PUBLIC_APP_URL` was hardcoded to `http://localhost:3001`, so invite/welcome emails linked to localhost and the SSO OAuth redirect URI was wrong (Google sign-in would fail on a real domain with a redirect-URI mismatch). It's now derived from the hostname (`https://<host>` for a real deployment).
- **Data Pipelines (Airbyte) is hidden for non-admin users.** It showed an "Open" that dead-ended for regular users: Airbyte Community has no per-user SSO, and both its entry points (the raw portal and the Data Sources settings tab) are admin-only. The Connected Tools row is now admin-only, matching how Airbyte is actually administered. n8n and Superset are unaffected — they open via SSO for any granted user.

## [1.3.15] - 2026-10-09

### Added
- **Airbyte is gated behind Mosaic login.** Airbyte's port now requires a valid Mosaic session (and the `airbyte` surface grant) before it can be reached: a visitor with no session is redirected to Mosaic login instead of seeing Airbyte's own login page, and every request is authorised against Mosaic (forward_auth / RBAC). This closes the previously public Airbyte login page while keeping the port reachable from any device. Airbyte Community can't do SSO federation, so you still sign in to Airbyte itself after the gate — the gate controls *who can reach it*, not the sign-in.

## [1.3.14] - 2026-10-09

### Fixed
- **Superset opens via single sign-on on real-domain deployments.** The SSO handshake only recognised the bundled Superset at `localhost:8445`, so on a real hostname (e.g. `https://<host>:8445/`) it skipped the auto-login and bounced users to Superset's own login form (which fails over the proxy even with the right password). Now any `:8445` host is recognised — open Superset from Mosaic and you land in it already authenticated.
- **Tool links resolve to the deployment's real hostname.** `MOSAIC_HOSTNAME` (and `CADDY_TLS`) are now passed into the app container, not just used to build the `*_PUBLIC_URL` strings. Without them, the v1.3.13 server-side URL logic fell back to `localhost` — so "Open Airbyte" opened `http://localhost:8000` and edition detection could misfire on a server box.

## [1.3.13] - 2026-10-08

### Fixed
- **Airbyte login over HTTPS.** Bundled Airbyte is now served through Caddy over TLS (port 8446) instead of plain `http://<host>:8000`. On a real domain the browser was dropping Airbyte's `Secure` session cookie, so login failed with "credentials correct, but the server failed to set a cookie." Opening Airbyte from Mosaic now lands you straight in the workspace. (Local/`localhost` installs are unchanged.)
- **Embedded Superset opens without a second login.** The Superset single-sign-on hand-off now sets its session cookie with the correct path, so the dashboard loads instead of bouncing to Superset's own login.
- **System Health reports bundled Superset correctly.** In Enterprise it now probes the bundled Superset directly instead of showing "unknown".
- **Tool links use the deployment's real hostname.** Superset, n8n, Airbyte and the watchdog link now derive from `MOSAIC_HOSTNAME` rather than `localhost`, so they open correctly from any machine, not just the server.

### Added
- **API Keys page tells bundled from unset.** n8n, Superset and CISO running on their built-in (bundled) defaults now show a **"bundled"** badge with the value in use — instead of a misleading "not set" — so you can see at a glance what's already wired up versus what genuinely needs a value (e.g. the n8n API key).
- **Post-install verification.** The installer now runs a reachability check after install and the System Health page probes each tool from the browser's side, naming the exact port to open if one isn't reachable — catching the "healthy server-side but won't open" gap.

### Changed
- **Documented Enterprise inbound ports** (canonical `docs/NETWORK.md`), including Airbyte's new HTTPS port 8446; port 8000 is now internal-only.
- **Trial-box reset tooling** for single-tenant trial reuse: edition-aware reset that stops all profiles, honours `MOSAIC_HOSTNAME`, and re-registers the bundled Airbyte so a box is demo-ready between prospects.

## [1.3.12] - 2026-09-14

### Changed
- **Structured analysis views no longer need magic keywords.** Mosaic now decides for itself when a question is a genuine operational/quality investigation and produces the right structured view (fishbone, Pareto, SPC, Cpk, OEE waterfall, etc.) — you no longer have to say "root cause" or "fishbone" to get one. It stays conservative: casual, conceptual, or non-data questions get a plain answer, not a forced diagram.

### Added
- **"Next best view" suggestions.** When an answer is data-grounded but shown as prose, Mosaic can offer one or two one-tap chips ("View as fishbone", "View Cpk analysis") to open the matching structured view. It only suggests a view it already has the data to fully populate, so tapping always produces a complete diagram — never an empty one.

## [1.3.11] - 2026-09-14

### Added
- **Process capability chart.** Root-cause analyses can now show a Cp/Cpk capability histogram of measured values against the spec limits (LSL/USL/target/mean), with a capability rating — core for CNC/moulding dimensional conformance. (Mosaic already computed Cpk; now it can show it.)
- **OEE loss waterfall.** A cascade from ideal 100% down through availability, performance and quality losses to the achieved OEE, colour-coded by loss type — the standard "where is my OEE going" visual.

### Fixed
- **Fault tree** now renders as a proper indented hierarchy (cause → sub-cause → root) instead of a flat grid that misrepresented the structure.
- **Batch comparison** change indicators are now aligned to the correct column.
- All 14 existing root-cause diagrams re-verified end-to-end with real data.

## [1.3.10] - 2026-09-14

### Fixed
- **RCA diagrams look clean, not messy.** Root-cause analyses now render complete, legible diagrams: the fishbone keeps cause labels short so branches no longer overlap or run off the edge, empty/unpopulated diagrams are omitted entirely (no more blank fishbone/5-whys/CAP shells), and category labels are sized to fit. The AI is also instructed to keep diagram labels terse and only include a diagram when it can fully populate it.

## [1.3.9] - 2026-09-13

### Fixed
- **Changepoint detection now finds real shifts.** It previously reported no changepoints even for an obvious step change (e.g. a metric jumping from 10 to 50); the detection is now seeded correctly and reliably flags genuine shifts while ignoring stable noise.
- **RCA diagrams are robust to incomplete data.** All 14 root-cause visualisations now coerce incomplete AI-produced data to a safe shape and render an empty-but-valid diagram (backed by a per-diagram error boundary), so a single incomplete diagram never disrupts the rest of an analysis.

## [1.3.8] - 2026-09-13

### Fixed
- **RCA analysis no longer crashes the page.** A root-cause-analysis response whose diagram data was incomplete (e.g. a fishbone with a missing branch list) threw an uncaught error that blanked the whole chat with an "Application error" screen. Each RCA visualisation is now wrapped in an error boundary, so a single malformed diagram degrades to a small "couldn't be displayed" notice while the rest of the analysis — charts, insights, tables — renders normally. The fishbone renderer also handles incomplete data gracefully.

## [1.3.7] - 2026-09-13

### Fixed
- **CSV data corruption.** The CSV reader used naive comma-splitting, so any quoted field containing a comma — very common in industrial data (descriptions, downtime reasons, part names like "High-speed, precision lathe") — was split at the internal comma, truncating the field and shifting every column after it, silently producing wrong data. Replaced with a proper RFC-4180 parser that also handles escaped quotes, quoted newlines, and auto-detects comma / semicolon / tab delimiters (for European exports and historians).

## [1.3.6] - 2026-09-13

### Fixed
This release fixes real functional bugs found by end-to-end feature testing (correctness,
not just security):

- **Alerts now fire on Personal installs.** Threshold alerts silently never fired on
  SQLite (Personal edition) — the alert condition is stored as JSON, which SQLite returns
  as a string, so every condition field read as undefined and the alert logged "skipped"
  with no error. Setting "alert me when scrap > 5%" would produce nothing, ever. Both the
  simple alerts and the Rules-module rule groups are fixed; verified end-to-end (alert
  fires and the notification is delivered with the correct computed value).
- **Statistical analyses no longer crash on degenerate data.** Analysing values with zero
  variance (all identical), empty data, or a single point returned NaN/Inf which crashed
  the analysis with an opaque 500. They now return a clear message (e.g. "zero variance —
  no test statistic defined") instead. Normal analyses are unchanged and numerically
  correct.
- **On-prem internal webhooks work.** The webhook security guard now allows a plant's own
  LAN alerting endpoints (while still blocking loopback and cloud metadata), so
  notifications to internal receivers are delivered.

## [1.3.5] - 2026-09-13

### Security
This release is a focused security-hardening pass. Several server-side request-forgery
(SSRF) and authorization issues were found by adversarial testing and fixed:

- **Critical — SSO configuration could be changed without authentication.** The
  save/delete SSO-config actions had no auth check, so an unauthenticated caller could
  inject a malicious identity provider or delete the real SSO config. Both now require
  an administrator.
- **Unauthenticated SSRF in the OpenAPI-spec fetcher** (used by the API-connector
  wizard) — it fetched any URL server-side with no auth or validation. Now admin-only,
  with private/loopback/metadata targets blocked, redirects not followed, and a response
  size cap.
- **SSRF hardening** across the Prism connection test (blocks loopback/cloud-metadata
  while still allowing on-prem plant LAN devices) and the n8n webhook path.
- **Query Runner read-only enforcement** is now bypass-resistant: stacked statements
  (`SELECT …; DROP …`), comment/whitespace-prefixed writes, and `ATTACH` are all blocked
  on read-only connections.
- **Data-access allowed-tables guardrail** now parses the actual `FROM`/`JOIN` tables
  instead of a substring match, so a `JOIN`/`UNION`/CTE to a non-allowed table can no
  longer slip through.
- Report download is path-contained; the Prism connection test is admin-only; internal
  error details are no longer leaked in a few error responses. Removed stray
  experimental files that shouldn't have shipped.

### Fixed
- The last hard-coded `v1.0.0` version strings (user menu and setup page) now show the
  real version.

## [1.3.4] - 2026-09-13

### Added
- **Business definitions.** Define how *your* plant computes its metrics and what your terms mean — OEE, first-pass yield, what counts as a defect, which machines make up "Line A." Mosaic uses these exact definitions in every analysis, so answers reflect your standards, not generic assumptions.
- **Licensing & entitlements (foundation).** Mosaic can now validate a license against a licensing service, with seat-based limits, expiry, offline grace, and a remote kill switch. Disabled by default (no license configured → runs as before), so existing installs are unaffected until you issue keys.

### Changed
- **Current Claude models.** The model picker now offers Claude Sonnet 5 (default), Opus 5, and Haiku 4.5 — the current generation, at lower cost than before. (The picker already existed; the versions were a generation behind.)
- **Private image distribution.** The installer authenticates to a private image registry before pulling, so the compiled app is no longer anonymously downloadable.
- **Personal edition** keeps Dashboards and Rules (both work), with the notification-channel settings they need made available.

### Fixed
- **Security:** closed server-side request-forgery (SSRF) vectors in the MCP connector and in Slack/Teams/webhook/n8n notifications — a crafted URL can no longer reach internal services or cloud metadata. Bounded MCP response sizes and treat MCP output as untrusted data.
- **Reliability:** notifications now retry transient delivery failures (a brief Slack/email blip no longer drops an alert).
- **First-run experience (installer):** fixed a false "Port 443 in use" preflight error, made "Open Mosaic" load in the app window (not a browser), and calmed the download progress display.
- **Fresh install:** the "Mosaic Files" data source now appears immediately on a clean Personal install; System Health shows unconfigured BYO services as "not configured" rather than a misleading "down"; the login page no longer shows a stale hard-coded version.
- Query Builder retries schema loading once to avoid a race right after creating a data source.

## [1.3.3] - 2026-09-07

### Added
- **Local folder analysis (Personal edition).** A `~/Mosaic/files` folder is created at install and mounted into Mosaic; drop documents (or whole subfolders) in and ask about them in chat — no data-source setup. Files are scanned recursively, and each top-level subfolder becomes its own data source, so organised folders (e.g. `production/` vs `compliance/`) are treated as separate scopes and not cross-correlated unless you ask.
- **Rich document reading.** PDF, Word, PowerPoint and Excel are converted to clean, token-efficient Markdown via MarkItDown — crucially preserving tables as real tables (not scrambled text). Applies to local folders and Enterprise file servers alike.
- **Visual chart reading (on request).** When a report's charts are embedded as images that text can't parse, Mosaic offers to read them visually; on your approval it renders the pages and interprets the charts (OEE breakdowns, Pareto, plan-vs-actual, etc.). Each visual read is recorded in the audit log with the consent captured.
- **Cross-source analysis (`combine_sources`).** Mosaic can now join and correlate data across different sources by a shared key — e.g. match API production orders to database quality records by order id — using a real, deterministic SQL join (DuckDB) instead of matching rows by hand. The join engine is sandboxed: it can only see the data explicitly passed to it (no file or database access).
- Query Builder: a **New query** button; Rules and alerts now select the query before the column, matching the natural order.

### Changed
- **Personal edition is now a coherent single-user product.** Features that assume multiple users or a shared server are hidden in Personal: user management, authentication/SSO, teams, notifications, audit trail, data retention, backup, remote support, and the enterprise-only services on System Health (usage metering, Keycloak, the search index). Enterprise is unchanged.
- **Updates.** The in-app update prompt no longer opens an external GitHub page — release notes render inline in Mosaic's own styling. Both editions show clear, reliable guided update steps (the previous one-click auto-update, which could interrupt the app mid-restart, was removed).
- The About screen now lists the **actual installed** dependency versions instead of a hard-coded list, and no longer implies a currency check it wasn't performing.

### Fixed
- Local file reading now reaches the user's real files (the container previously couldn't see host folders), reads PDFs/Office docs that were silently skipped before, and surfaces the complete file list for "summarise everything" requests.
- Migrations and the folder/data-source setup run reliably at boot; edition is detected consistently across the app.
- Various UI polish: the wordmark no longer touches the window edge, and the "create new" buttons are consistent across Query Builder, Alerts and Workflow rules.

## [1.3.2] - 2026-09-04

### Added
- **Query unification** — the Query Builder is now the single place queries are authored and stored (DB-backed `saved_queries`), referenced everywhere else. No free-text SQL outside the Query Builder.
- Dashboards: build a Superset dashboard from a saved query, with live validation of the chart spec against the real result columns before building.
- Multi-chart Superset dashboards — add charts from multiple queries to one dashboard (layout via position_json); refuses to modify dashboards Mosaic didn't create (protects hand-designed layouts).
- Alerts & workflow rule conditions reference saved queries (DB) and pre-configured API connections (API) — no free-text SQL or API paths. Robust API value extraction across common response shapes (flat, arrays, data/results/value/items/records wrappers, OData v2/v4) plus a configurable data path; optional "any row matches" evaluation.
- Report sections use saved queries (DB) and API connections (API); per-section width (full / half / third) with auto-wrapping row layout, rendered identically in-app and in PDF.
- Field pickers show a saved query's actual result columns (dropdown) so a mistyped field can't silently prevent a condition from firing.
- CJK (Noto) fonts in the image so reports with Chinese/Japanese/Korean content render real glyphs.
- Airbyte: workspace selector; Mosaic → n8n workflow triggering (outbound).
- Persisted, paginated "Queries & dashboards" view of everything Mosaic built in Superset.

### Fixed
- **Migrations now run in production.** The Dockerfile never copied `migrations/`, so the migration runner silently skipped in every built image; migrations also only ran on a home-page render. Now migrations (schema + data) run at server boot via `instrumentation.ts`, before any request, with per-statement additive-migration support.
- **PDF report generation works on ARM (Apple Silicon).** Switched from the x86-only `@sparticuz/chromium` to the arch-native Alpine `chromium` package, fixing the `rosetta error` on arm64; added a writable reports directory.
- Superset BYO consistency: status, dashboards list, embed, sync, user-sync and the launch button all resolve configuration settings-first (BYO wins over bundled defaults); honest `unconfigured` / `error` / `healthy` status states across Airbyte, n8n, Superset and CISO.
- Bar/line charts no longer duplicate the dimension (the "Duplicate column/metric labels" error); empty-result queries no longer falsely flagged as non-numeric.
- Report template editor: connection dropdown selection sticks; edit page no longer crashes; saving keeps you on the page; multi-section templates stay compact.
- Numerous BYO auth fixes where a service read credentials env-first instead of settings-first.

### Notes
- Both editions share one image; the browser certificate warning on `https://localhost` (Personal) is expected for a self-signed cert and does not appear on a real domain (Enterprise, with `CADDY_TLS` set for a public certificate).

## [1.2.1] - 2026-05-24

### Added
- CISO Assistant GRC platform integrated into Mosaic stack (docker-compose.yml — 3 services: ciso-backend, ciso-frontend, ciso-caddy)
- Caddy reverse proxy routing for CISO Assistant on port 8443 (plain HTTP, on-prem safe)
- Custom backend Dockerfile patches Django cookie security flags so login works over plain HTTP without TLS
- ISO 27001:2022 library (264 frameworks available; 123 requirements, 93 Annex A SoA controls)
- "Open CISO Assistant" button in Settings → Audit tab with two-layer compliance explanation
- .env.example — CISO_SUPERUSER_EMAIL / CISO_SUPERUSER_PASSWORD entries

### Fixed
- Caddy auto-adds X-Forwarded-Proto: https which caused Django to set Secure cookies over HTTP, silently breaking login — fixed by stripping header in Caddyfile and patching SESSION_COOKIE_SECURE / CSRF_COOKIE_SECURE in Dockerfile.backend
- Removed orphaned docker/ciso/mosaic_settings.py and docker/ciso/local_settings.py

## [1.2.0] - 2026-05-18

### Added
- Report template builder — section types (KPI, table, chart, AI narrative, static text), data bindings, schedule, recipients
- Report scheduler — cron-based generation, PDF via Puppeteer, email delivery with attachment
- Report history — downloadable PDF instances, run log
- Friendly schedule builder — Daily/Weekly/Monthly picker with day/time selectors, human summary (no cron strings exposed)
- Structured recipients — notification group pills + individual email input, matching Rules page pattern
- Elasticsearch database connector — Query DSL + GET discovery, API key and Basic auth
- Elasticsearch test harness — 4 indices (maintenance_logs, alarm_events, quality_events, operator_logbook), 372 documents aligned with PRESS-01/CNC-03 RCA scenarios
- SharePoint file server transport — Microsoft Graph API, OAuth2 client credentials (tenant_id, client_id, client secret)
- SharePoint test handler — validates credentials against Azure AD, surfaces AADSTS errors in UI
- n8n webhook action type in Workflow rules — configurable URL + payload template with {{variables}}, _mosaic context block appended
- rca_sessions table — records every RCA completion with workflow_id, problem, renderers_used, rca_block
- Backfill migration for historical rca_sessions from messages table

### Fixed
- rca_sessions write gated on matchedWorkflow (generic RCA path never wrote sessions)
- integration_runs FK constraint — rule_id referenced integration_rules only, blocking rule_groups (workflow rules) from logging
- integration_runs schema migration — drops FK on boot for existing SQLite DBs
- TabAPIs.tsx — 13 pre-existing TypeScript errors (ImportConnection missing 4 fields, ApiService missing auth_status/last_auth_error, Alert style prop)
- app/api/export/word/route.ts — Buffer not assignable to BodyInit (→ Uint8Array), Parameters<typeof Document> DOM type conflict
- cron-parser API change — parseExpression → CronExpressionParser.parse
- Collapsed sidebar — Dashboards/Reports/Rules labels truncated; now shows icon-only rail with tooltips when collapsed
- User row collapsed state — avatar only, name/role/version hidden; ThemeToggle hidden when collapsed
- About page — version badge, build date and footer all hardcoded; now read from package.json and git log
- appUrl default was localhost:3001 — corrected to localhost:3000
- react-markdown version in deps list showed 9.x — corrected to 10.1.0

## [1.1.0] - 2026-05-11

### Added
- SSO authentication — Microsoft Entra ID and Google Workspace (OIDC)
- SMTP configuration UI with test button and encrypted password storage
- Welcome emails sent on user invite with branded HTML template
- User management — stats dashboard, search, filter, pagination, last login tracking
- OpenAPI 3.0 importer with toggle button UI (Import Postman + Import OpenAPI)
- Postman variable substitution and smarter auth detection
- Pagination and data-path inference at import time
- Endpoint catalog injected into chat system prompt
- Import polish — dedup detection, fold toggle, better error messages
- API response hard cap at 200 records to prevent context window overflow
- Chat + menu replacing toolbar clutter (data sources, RCA workflows, model, system prompt)
- File attachment support in chat (image, PDF, CSV)
- Stop/cancel button while streaming
- Sidebar collapse with smooth animation on all pages
- Conversation search in sidebar
- Markdown rendering in chat responses
- Self-hosted scheduler — built-in 60s Node timer (no Vercel dependency)
- Deployment info page in Settings → About
- Search and pagination on all three settings connection tabs

### Fixed
- API system prompt token bloat — descriptions truncated, default limits added
- Conversation delete button changed from red to subtle grey
- Chat response formatting — no markdown tables, no emoji, no duplicate headings

## [1.0.0] - 2026-04-08

### Added
- AI chat with streaming responses and tool use
- Web search via Tavily API
- Database connections — PostgreSQL, MySQL, SQL Server, InfluxDB, MongoDB, SQLite
- REST API service workspaces with OAuth2, bearer, basic, API key auth
- SAP OData V2/V4 connector with automatic format injection
- File server connections — SFTP, S3, SMB/CIFS, local filesystem
- Postman v2.1 collection importer with folder tree and checkboxes
- RCA Workflows — Pareto, Fishbone, 5 Whys, corrective action plan renderers
- 4 seeded RCA templates — Quality Defect, Machine Downtime, OEE Drop, Safety Incident
- Notifications — Slack, Teams, Email (SMTP), SMS and WhatsApp via Twilio
- Alert rules with threshold, schedule, and RCA complete triggers
- Dashboard builder with panel types — bar, line, KPI, table, donut, gauge
- User management with admin/user roles and ban/unban
- JWT authentication with bcrypt password hashing
- Usage analytics with per-user token cost tracking
- Light and dark mode with system preference detection
