# Changelog

All notable changes to Mosaic are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

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
