# Changelog

All notable changes to Mosaic are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

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
