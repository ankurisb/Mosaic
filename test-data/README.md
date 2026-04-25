# Mosaic Test Data Harness

A complete, self-contained set of test data sources for exercising Mosaic's
features end-to-end. Everything runs locally in Docker — no cloud credentials,
no external services.

## What's inside

| Source | Purpose | Dialect / transport |
|---|---|---|
| **Plant Operations** | Manufacturing shop floor: machines, OEE, downtime, defects — 6 months of data | PostgreSQL 16 |
| **ERP Lite** | Customers, orders, products, inventory | MySQL 8.3 |
| **Maintenance CMMS** | Work orders, assets, spare parts, PM schedules | SQL Server 2022 |
| **Sensor Telemetry** | 7 days of 1-min sensor readings with embedded faults | InfluxDB v1.8 |
| **Event Logs** | Nested JSON event documents | MongoDB 7 |
| **File Server (S3)** | CSVs, Excel, PDF, XML, JSON files | MinIO (S3-compatible) |
| **File Server (SFTP)** | Same files over SSH | atmoz/sftp |
| **Mock SAP OData** | Production Orders, Equipment, Maintenance Notifications | REST / OData V2 |

Asset codes are **aligned across sources** (`CNC-01`, `PRESS-01`, etc.) so you can
test cross-source queries like *"Which machines on Line B have open CMMS work
orders and below 70% OEE this month?"*

## Designed scenarios

Seed data is engineered to surface realistically in Mosaic's features:

- **PRESS-01** is chronically broken — low OEE, frequent hydraulic-seal breakdowns across Postgres, CMMS, SAP notifications, and a sensor fault on 2026-04-20 09:00 UTC visible in InfluxDB. Ideal for testing the **Machine Downtime RCA** workflow.
- **CNC-03** shows recurring `DIM-01` dimensional defects plus a gradual bearing-wear trend in the telemetry. Ideal for the **Quality Defect RCA** workflow.
- **SP-HS-002** (hydraulic seal kit 75mm) and **SP-BR-002** (spindle bearing) are **below min-stock** in CMMS, useful for testing alert rules.

---

## Prerequisites

- Docker Desktop (or Docker Engine) with Docker Compose v2
- Ports free on `127.0.0.1`: 5433, 3307, 1434, 8087, 27018, 9000, 9001, 2222, 4001
- About 3 GB of free disk for container images + data

## Start everything

```bash
cd mosaic-testdata
docker compose up -d
```

First start takes 2–3 minutes: image pulls + seeds run. Watch progress with:

```bash
docker compose logs -f postgres mysql mssql-seed influxdb-seed minio-seed
```

You're ready when `mssql-seed`, `influxdb-seed`, and `minio-seed` have exited
with status 0. Verify:

```bash
docker compose ps
# Everything should be "running (healthy)" or "exited (0)" for the *-seed services.
```

## Stop / reset

```bash
docker compose down           # stop, keep data
docker compose down -v        # stop and wipe volumes (fresh seed next start)
```

---

## Connection details for Mosaic

Paste these into **Settings → Data sources → + Add database** (or the equivalent
API / file-server pages). Every connection uses `127.0.0.1` and non-default
ports to avoid clashing with anything you already run.

### 1. Plant Operations (Postgres)

```
Label:            Plant Operations
Dialect:          postgres
Connection string: postgresql://mosaic:mosaic_pw@127.0.0.1:5433/plant_ops
Schema:           plant
Read-only:        yes (recommended)
```

Try: *"Show me the top 5 machines by OEE in the Plant Operations database for the last 7 days"*

### 2. ERP Lite (MySQL)

```
Label:            ERP Lite
Dialect:          mysql
Connection string: mysql://mosaic:mosaic_pw@127.0.0.1:3307/erp_lite
Read-only:        yes
```

Try: *"Which customers have open orders over £5,000 in ERP Lite?"*

### 3. Maintenance CMMS (SQL Server)

```
Label:            Maintenance CMMS
Dialect:          mssql
Host:             127.0.0.1
Port:             1434
Database:         cmms
Username:         sa
Password:         Mosaic_Strong_Pw_1
SSL mode:         prefer
Read-only:        yes
```

Try: *"List all open work orders in the CMMS, highest priority first"*

### 4. Sensor Telemetry (InfluxDB v1)

```
Label:            Sensor Telemetry
Dialect:          influxdb
Host:             127.0.0.1
Port:             8087
Database:         telemetry
Username:         mosaic
Password:         mosaic_pw
SSL mode:         disable
```

Try: *"Show me the hourly mean pressure for PRESS-01 over the last 3 days from Sensor Telemetry"*

### 5. Event Logs (MongoDB)

```
Label:            Event Logs
Dialect:          mongodb
Connection string: mongodb://mosaic:mosaic_pw@127.0.0.1:27018/event_logs?authSource=event_logs
Database:         event_logs
```

Try: *"Find all critical alarms on PRESS-01 in the Event Logs"*

### 6. File Server — MinIO (S3)

**Settings → File servers → + Add**

```
Label:            Plant Files (S3)
Transport:        s3
Bucket:           mosaic-test
Endpoint URL:     http://127.0.0.1:9000
Access key ID:    mosaic
Secret key:       mosaic_pw_12
File types:       csv,xlsx,pdf,xml,json
Filename date pattern: (\d{4})(\d{2})(\d{2})
Timestamp strategy: filename
```

Try: *"Read the latest OEE daily file from Plant Files and summarise"*

Also accessible via MinIO Console: <http://127.0.0.1:9001> (mosaic / mosaic_pw_12)

### 7. File Server — SFTP

```
Label:            Plant Files (SFTP)
Transport:        sftp
Host:             127.0.0.1
Port:             2222
Username:         mosaic
Password:         mosaic_pw
Share path:       upload
Sub path:         initial
File types:       csv,xlsx,pdf,xml,json
Timestamp strategy: modified
```

### 8. Mock SAP API (REST / OData V2)

**Settings → API services → + Add**

```
Label:            Mock SAP S/4HANA
Base URL:         http://127.0.0.1:4001
Auth type:        bearer
Bearer token:     testtoken
API version:      v2
```

Then add three endpoints (connections) under that service:

| Label | Base path | Pagination |
|---|---|---|
| Production Orders        | `/sap/opu/odata/sap/API_PRODUCTION_ORDER_SRV/A_ProductionOrder` | `$top` / `$skip`, data path `d.results` |
| Equipment                | `/sap/opu/odata/sap/API_EQUIPMENT_SRV/Equipment`                  | same |
| Maintenance Notifications| `/sap/opu/odata/sap/API_MAINTNOTIFICATION_SRV/MaintenanceNotification` | same |

Default headers: `Accept: application/json`

Try: *"From SAP, list all maintenance notifications for equipment 10000006 that are not yet completed"*

---

## Verifying sources with curl

Quick sanity checks without touching Mosaic:

```bash
# Postgres
docker exec mosaic-postgres psql -U mosaic -d plant_ops \
  -c "SELECT COUNT(*) FROM plant.production_runs;"

# MySQL
docker exec mosaic-mysql mysql -umosaic -pmosaic_pw erp_lite \
  -e "SELECT COUNT(*) FROM orders;"

# SQL Server
docker exec mosaic-mssql /opt/mssql-tools18/bin/sqlcmd -S localhost \
  -U sa -P Mosaic_Strong_Pw_1 -C -d cmms \
  -Q "SELECT COUNT(*) FROM work_orders;"

# InfluxDB
curl -sG -u mosaic:mosaic_pw 'http://127.0.0.1:8087/query' \
  --data-urlencode 'db=telemetry' \
  --data-urlencode 'q=SELECT COUNT(temp) FROM sensor'

# MongoDB
docker exec mosaic-mongodb mongosh \
  "mongodb://mosaic:mosaic_pw@localhost:27017/event_logs?authSource=event_logs" \
  --quiet --eval 'db.machine_events.countDocuments()'

# MinIO
curl -s http://127.0.0.1:9000/minio/health/live && echo "MinIO OK"

# Mock SAP
curl -s -H "Authorization: Bearer testtoken" \
  'http://127.0.0.1:4001/sap/opu/odata/sap/API_EQUIPMENT_SRV/Equipment?$top=2&$format=json'
```

---

## Suggested test plan

A rough rollout order that unlocks progressively richer Mosaic features:

1. **Plant Operations (Postgres)** alone → verify chat, @ mention, query_database tool, simple dashboards.
2. **+ Sensor Telemetry (InfluxDB)** → the core industrial pair. Test dual-source queries and the Machine Downtime RCA workflow on PRESS-01.
3. **+ File Server (MinIO)** → read latest OEE CSV, exercise every parser (CSV/XLSX/PDF/XML/JSON).
4. **+ Mock SAP OData** → test OData `$filter` hints, bearer-token auth, pagination envelope.
5. **+ Maintenance CMMS (SQL Server)** → cross-DB selection. Ask *"Which Line B machines have open work orders AND below 70% OEE?"* — Mosaic must query two dialects and correlate.
6. **+ ERP Lite (MySQL) + Event Logs (MongoDB) + SFTP** → dialect coverage, JSON filter path, edge-case transport.

---

## Troubleshooting

**SQL Server seed exits non-zero.** SQL Server needs ~30s to accept connections
on first start. Run `docker compose up -d mssql-seed` again — the healthcheck
gates the seeder, but occasionally it times out on slow hosts.

**InfluxDB seed "401 Unauthorized".** The v1 image only enables auth after the
admin user is created. Wait 10 seconds and `docker compose up -d influxdb-seed`.

**MinIO seed creates empty bucket.** Confirm `./files/` has files — it's mounted
read-only into the seeder.

**Port already in use.** Edit the `ports:` stanza in `docker-compose.yml` to
pick a free port, then update the Mosaic connection to match.

**Mock SAP 401.** You must send `Authorization: Bearer <any-non-empty-token>`.
The server is deliberately lax on the token value to make testing easy.

---

## File layout

```
mosaic-testdata/
├── docker-compose.yml
├── README.md                       ← you are here
├── files/                          ← sample files (mounted into MinIO + SFTP)
│   ├── oee_daily_YYYYMMDD.csv     (×14)
│   ├── quality_report_Q1_2026.xlsx
│   ├── manual_PRESS-01_operating.pdf
│   ├── sensor_config.xml
│   ├── batch_records.json
│   └── shift_log_current.csv
├── mock-api/
│   ├── package.json
│   └── server.js                   ← Mock SAP OData V2
└── seed/
    ├── postgres/       01_schema.sql + 02_data.sql (6 months of prod runs)
    ├── mysql/          01_schema_data.sql
    ├── mssql/          01_schema.sql + 02_data.sql
    ├── influxdb/       telemetry.lp (110k line-protocol points)
    └── mongodb/        01_seed.js
```
