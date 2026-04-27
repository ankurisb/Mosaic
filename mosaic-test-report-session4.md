# Mosaic v1.0.0 — Session 4 Test Report

**Date:** 27 April 2026
**Tester:** Ankur Singh
**Environment:** macOS (Apple Silicon, Docker Desktop 29.3.1), Node 20.20.2
**Starting point:** session-3 commit a354003 (origin/main)

---

## 1. Scope

Session-3 report flagged five items not yet validated. This session closed three:

- Cross-source queries exercising multiple data sources in one chat
- File-server SFTP transport (S3 was done in session 3; SFTP had not been)
- OData pagination against the mock SAP API
- Wire up the remaining harness sources: SQL Server CMMS, MySQL ERP Lite, MongoDB Event Logs, SFTP, mock SAP
- Identify and fix any code bugs blocking the above

---

## 2. What was wired and validated

All five remaining harness sources added through Mosaic's settings UI and exercised with smoke prompts.

### 2.1 ERP Lite (MySQL 8.3)
- Connection: mysql://mosaic:mosaic_pw@127.0.0.1:3307/erp_lite
- Schema: 6 tables (customers, orders, order_lines, products, inventory, suppliers)
- Smoke query "customers with open orders over £5,000": 5 customers, £49,575 total, GBP formatting clean

### 2.2 Maintenance CMMS (SQL Server 2022)
- Host 127.0.0.1, port 1434, db cmms, user sa
- Schema: 5 tables (assets, work_orders, pm_schedules, spare_parts, technicians)
- Asset codes (PRESS-01, CNC-03, etc.) aligned with Postgres plant.machines.code — enables clean cross-source joins
- Smoke query "open work orders, highest priority first": 8 results correctly prioritised

### 2.3 Event Logs (MongoDB 7)
- Connection: mongodb://mosaic:mosaic_pw@127.0.0.1:27018/event_logs?authSource=event_logs
- One collection (machine_events) with polymorphic documents
- Smoke query "critical alarms on PRESS-01": returned the engineered PR-001 hydraulic-pressure alarm at 2026-04-20 09:00 UTC, matching InfluxDB anomaly window
- Schema introspection produced clean per-event-type structural breakdown

### 2.4 Plant Files (SFTP) — atmoz/sftp
- Host 127.0.0.1, port 2222, share upload, sub initial, ts_strategy filename
- Three real bugs surfaced and fixed before SFTP could function (see section 3)
- After fixes: CSV result PRESS-01 at 48.84% on 2026-04-22, byte-identical to S3
- PDF result: PRESS-01 manual specs (185 bar nominal, 175-195 range, alarm <170 bar for >30s as PR-001), matching S3

### 2.5 Mock SAP S/4HANA (REST / OData V2)
- Service: base http://127.0.0.1:4001, bearer testtoken, three endpoints (Equipment, Production Orders, Maintenance Notifications)
- UI flow note: SAP Quick-Connect form only accepts HTTPS hostnames + SAP user credentials; switched to "Custom" tab for generic-REST + bearer
- Three smoke tests passed: GET with $top=5, OData filter on equipment ID + status, pagination check (model recognised single-page result via missing __next link)

---

## 3. Bugs found and fixed (all pushed to origin/main)

### 3.1 file-servers UPDATE — bare ? placeholders break SQL (HIGH severity)
**Commit:** 5d55a8a
**File:** app/api/file-servers/route.ts

UPDATE branch used inline conditional fragments for encrypted credentials. Empty fragments concatenated as bare ? placeholders with no column name. SQLite threw "near ?: syntax error".

Impact: every UPDATE through Settings → File servers failed for any transport. UI showed "Failed to execute 'json' on 'Response': Unexpected end of JSON input". Subsequent unhandled rejections wedged the route until restart.

The bug stayed undetected because existing connections hadn't been edited since creation. Only surfaceable on edit.

Fix: split into one unconditional UPDATE for non-credential fields, then three single-column UPDATEs for encrypted fields when supplied.

### 3.2 SFTP listing path used wrong directory (MEDIUM severity)
**Commit:** 4473247
**File:** lib/tools.ts ~line 827

atmoz/sftp chroots user mosaic to /. Code passed only sub_path to readdir, ignoring share_path. So readdir('initial') resolved to /initial/ (empty) instead of /upload/initial/.

Impact: SFTP listing always returned 0 files. Empty result surfaced as "No matching files found", masking the bug as configuration.

Fix: build dirPath by joining trimmed share_path + sub_path, used for both readdir and per-file path.

### 3.3 SFTP content fetch was unimplemented stub (MEDIUM severity)
**Commit:** 4473247 (same)
**File:** lib/tools.ts ~line 989

Stub left over from before ssh2 was added as runtime dep. Even if listing had worked, every read would have errored with "install ssh2 package".

Fix: implemented SFTP branch with Client.connect → sftp → createReadStream → buffer concat. SMB remains unimplemented.

---

## 4. Harness issues found

### 4.1 mock-sap healthcheck — three stacked failures (FIXED)
**Commit:** b8dce38
**File:** test-data/docker-compose.yml

Container had been (unhealthy) since session 3 (FailingStreak >8000). API itself worked from outside.

1. Wrong path: original /health returns 404, mock doesn't implement it. Switched to OData entity-set path.
2. Compose variable interpolation: $top and $format were being substituted to empty strings by docker compose before container start. Escaped as $$top / $$format.
3. localhost vs 127.0.0.1: Alpine wget resolves localhost to ::1 first, mock binds 0.0.0.0 only on IPv4. Switched to explicit 127.0.0.1.

Container flips to (healthy) within ~10s of recreate.

### 4.2 mosaic-minio-seed stuck in Created state (NOT FIXED)
Workaround: manual seeding from session 3 still works.

Sidecar never starts. Session-3 a354003 was meant to address this class of issue but didn't fully take. On a fresh down -v && up the bucket would be empty.

### 4.3 SFTP nested bind mount shadow on first start (NOT FIXED, recreate works)
Workaround: docker compose up -d --force-recreate sftp after files populated.

Outer mount ./sftp-data:/home/mosaic/upload plus inner ./files:/home/mosaic/upload/initial:ro. On Docker Desktop macOS, container starting before ./files/ is populated snapshots the empty state. Recreate forces fresh mount resolution.

### 4.4 Postgres data gap for PRESS-01 (NOT FIXED)
File: test-data/seed/postgres/02_data.sql
Already flagged in session-3 report.

plant.production_runs and plant.downtime_events have no rows for PRESS-01 between 19-22 April, even though InfluxDB, Mongo, CMMS, and SAP all describe the 20 Apr hydraulic seal failure. Materially affects the cross-source test in section 5.

Suggested fix: ~3 rows in seed/postgres/02_data.sql covering 2026-04-20 09:00-11:00 with reason 'hydraulic seal failure' on machine_id=6 (PRESS-01).

---

## 5. Cross-source headline test

Prompt: "Which Line B machines have open CMMS work orders AND below 70% OEE this month?"

The model executed cross-source correctly — hit MSSQL for work orders, Postgres for OEE, joined on machine code, returned union with both dimensions visible. Three open WOs on Line B (two on PRESS-01, one on LATHE-01); LATHE-01 OEE 74.4% (above threshold); PRESS-01 has no OEE data this month due to section 4.4 gap.

Strict AND fails (because PRESS-01 has no OEE row), but model handled it gracefully by calling out PRESS-01 as the practical answer (two open WOs, one high-priority pressure-drop diagnostic, no OEE data which functionally means not running).

Synthesis quality: high. The kind of answer a careful engineer would give in person — strict logic returns nothing, but here is what is concerning. This is the cross-source pitch working as designed.

If section 4.4 data gap were closed, the answer would shift to "PRESS-01 had X% OEE — well below 70% — and has open work orders" — narratively complete. Cross-source mechanism itself works; only harness data is incomplete.

---

## 6. Aside: SAP production order date mismatch

Mock SAP production orders are seeded with 2024 dates (Feb-Mar 2024); rest of harness is 2026. Doesn't break anything but creates a 2-year gap if cross-source queries join SAP production orders with current Postgres data.

Suggested fix: update mock-api production order fixture dates to match 2026.

---

## 7. Status of session-3 follow-up list

- Cross-source queries — VALIDATED (section 5)
- File server parsing — MinIO + SFTP + every file type — VALIDATED for SFTP (S3 done in session 3); 5 file types confirmed end-to-end on both transports
- OData pagination against the mock SAP API — VALIDATED (section 2.5)
- Rules engine and notification scheduler — STILL NOT VALIDATED
- Production Vercel deploy — STILL NOT VALIDATED

Three of five items closed.

---

## 8. Pending work for next session

Priority order:

1. Rotate exposed secrets — Anthropic API key, AUTH_SECRET, Tavily key. AUTH_SECRET rotation requires re-encrypting all stored credentials so should be done before adding more sources or deploying. Cost grows with every additional connection.

2. Apply harness fixes from sections 4.2, 4.3, 4.4, and 6 — minio-seed, SFTP bind mount, Postgres PRESS-01 gap, SAP production order dates. None block functionality but each affects fresh-start reliability or demo quality.

3. Rules engine + notification scheduler — substantial scope. Likely surfaces additional bugs since unexercised path.

4. Production Vercel deploy — should be last. Watch pdf-parse bundling, aws4, streaming UX. Requires secrets rotation first.

---

## 9. Quick-resume commands

    cd ~/projects/Mosaic
    git log --oneline -6

    docker ps --format "table {{.Names}}\t{{.Status}}" | grep mosaic

    PORT=3001 npm start > /tmp/mosaic.log 2>&1 &
    curl -s http://localhost:3001/api/health

    sqlite3 ~/claude-app/data/claude-app.db "SELECT label, dialect FROM db_connections; SELECT label, transport FROM file_servers; SELECT label, base_url FROM api_services;"

Smoke test prompt for resumed session:

> Which Line B machines have open CMMS work orders AND below 70% OEE this month?

If that returns the section 5 result quality (cross-source synthesis with PRESS-01 flagged), the full pipeline from session 4 is intact.

