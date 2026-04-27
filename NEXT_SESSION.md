# Next Session — Pickup Notes

Last session: 27 April 2026 (session 4). Six bug-fix commits shipped to main; full session report at mosaic-test-report-session4.md.

## State of play

- Five harness sources wired and validated end-to-end: MySQL, MSSQL, MongoDB, SFTP, mock SAP
- Cross-source headline test passing (Postgres + MSSQL on Line B query)
- Rules engine Half A working: Slack channel + dispatch verified end-to-end
- Rules engine Half B blocked on a missing form field (see item 3 below)

## Priority queue

### 1. Rotate leaked secrets (10 min, do first)
Anthropic API key and Tavily key were pasted in early-session diagnostics. Both are zero-disruption to rotate.

- Generate new Anthropic key at console.anthropic.com, update ANTHROPIC_API_KEY in .env.local
- Generate new Tavily key at app.tavily.com, update TAVILY_API_KEY
- Restart Mosaic, confirm chat still works

### 2. AUTH_SECRET rotation — decide and act
Disruptive: rotating AUTH_SECRET invalidates every encrypted credential in the DB. With 7 connections wired, recreating them via UI takes ~10 min. Either rotate now and pay that cost, or accept the leak as low-risk and defer until a fresh deployment.

### 3. Finish rules engine Half B — add data source picker to rules form
The rules form (components/settings/TabIntegrations.tsx) is missing a Source dropdown, so every rule created via UI has source_id = NULL and the scheduler silently skips it.

What is needed:
- Add a grouped Source dropdown populated from db_connections, api_services, file_servers
- For file_servers, filter to row-bearing formats (csv, xlsx) — file thresholds need a column to extract from
- Conditionally render the query field label and placeholder by source type (SQL, API path, file hint)
- Add API-side validation: require source_id on rule create and update in app/api/integrations/rules/route.ts
- Decide product behaviour for threshold over a file — recommended: row count of latest matching file
- End-to-end test: create threshold rule against CMMS, manually invoke POST /api/integrations/scheduler with Authorization Bearer CRON_SECRET, verify Slack message and integration_runs row

Scheduler code already handles all three source types correctly (app/api/integrations/scheduler/route.ts lines 60-72). Form is the only block.

Estimated 2-3 hours focused work. Likely surfaces 1-2 more bugs in the unexercised path.

### 4. Spot-fix sendEmail field mismatch (30 min)
lib/notify.ts sendEmail reads config.to_address; buildConfig writes config.recipients. Email channels will fail with Missing to_address if anyone tries them. Pick one field name, update both sides, atomic commit.

### 5. Apply harness data fixes (1 hour, demo quality)
- Add ~3 rows to seed/postgres/02_data.sql covering 2026-04-20 09:00-11:00 PRESS-01 hydraulic seal failure (closes the cross-source narrative gap)
- Update mock-api production order dates from 2024 to 2026 to match rest of harness
- Diagnose mosaic-minio-seed stuck-in-Created state (session-3 commit a354003 was meant to fix this but did not fully take)
- Document SFTP nested-bind-mount shadow workaround in test-data/README.md

### 6. Docker Compose deployment validation (1 full session)
This is the highest-leverage test for scenario B (customers run Mosaic via Docker Compose on their own infrastructure).

- Run docker compose up -d from a fresh checkout in a clean directory
- Complete first-time admin setup through the deployed stack (not local npm)
- Wire one connection, run a chat
- Test docker compose down -v then up -d for fresh-start reliability
- Document each bug found; commit fixes individually

Session-3 report flagged that the bundled docker-compose.yml had broken Airbyte and Superset services that were sidestepped (Mosaic ran locally instead). Those bugs are still in the repo. Will surface immediately.

### 7. Rules engine — extend testing once Half B form is fixed
- Schedule-trigger rule, every-minute interval, validate scheduler tick processes it
- RCA-complete trigger rule (untested code path)
- Notification groups (integration_groups table) — entire path untested

### 8. Product decisions for scenario B (not engineering)
Need decisions before Phase 3 build work can be sequenced:
- Distribution model: GitHub repo, Docker registry, or signed installer
- Update mechanism: manual git pull, image tag pulls, or in-app updater
- Support model: self-serve docs, community Slack, or paid SLA

## Pending bugs flagged but not fixed

- sendEmail field mismatch (lib/notify.ts) — MEDIUM — Workaround: none, email channels broken until fixed
- Rules form missing source picker (components/settings/TabIntegrations.tsx) — HIGH — Workaround: insert via SQL with source_id set
- minio-seed Created state (test-data/docker-compose.yml) — MEDIUM — Workaround: manual seed (session-3 method)
- SFTP nested bind shadow (test-data/docker-compose.yml) — LOW — Workaround: docker compose up -d --force-recreate sftp after files populated
- Postgres PRESS-01 19-22 Apr gap (seed/postgres/02_data.sql) — LOW (demo) — Workaround: none
- SAP 2024 production order dates (mock-api fixture) — LOW (cosmetic) — Workaround: none

## Quick-resume commands

    cd ~/projects/Mosaic
    git log --oneline -8
    docker ps --format "table {{.Names}}\t{{.Status}}" | grep mosaic
    PORT=3001 npm start > /tmp/mosaic.log 2>&1 &
    curl -s http://localhost:3001/api/health

Smoke test prompt to verify session-4 state still works:

> Which Line B machines have open CMMS work orders AND below 70% OEE this month?

If that returns the cross-source synthesis answer (PRESS-01 flagged with two open WOs), the full pipeline is intact.

