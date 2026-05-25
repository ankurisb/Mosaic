# Mosaic — Backup & Restore Reference

## What gets backed up

A Mosaic backup contains everything needed to fully restore a running instance:

### `mosaic.db` (the SQLite database)

The single most important file. Contains all application state:

| Category | Tables |
|---|---|
| AI conversations | `conversations`, `messages`, `rca_sessions` |
| Data connections | `db_connections`, `api_connections`, `api_services`, `file_servers`, `airbyte_instances`, `prism_instances`, `connection_schemas` |
| Users & auth | `users`, `sso_config`, `smtp_config`, `kv_settings` |
| Dashboards & reports | `dashboards`, `dashboard_panels`, `report_templates`, `report_instances`, `report_deliveries` |
| Rules & workflows | `rule_groups`, `integration_rules`, `integration_channels`, `integration_runs`, `notification_groups`, `rca_workflows` |
| Guardrails | `guardrail_settings`, `guardrail_ai_rules`, `guardrail_content`, `guardrail_data_access`, `guardrail_actions`, `guardrail_usage_limits`, `guardrail_pending_actions` |
| Audit & compliance | `usage_events`, `egress_events`, `data_retention_settings` |

### Docker volumes

| Volume | Contents |
|---|---|
| `mosaic-data` | `mosaic.db` + WAL files |
| `superset-db-data` | Superset Postgres — dashboard chart definitions |
| `superset-data` | Superset home directory |
| `n8n-data` | n8n workflow automations |
| `ciso-data` | CISO Assistant compliance assessments and evidence |
| `airbyte-db-data` | Airbyte source/destination/connection configs |

### `.env` file

All secrets and configuration — `AUTH_SECRET`, `ANTHROPIC_API_KEY`, SMTP credentials, etc.

> ⚠️ **Critical:** `AUTH_SECRET` is used to encrypt all stored credentials. If you restore `mosaic.db` but use a different `AUTH_SECRET`, every saved database password, API key, and credential becomes unreadable. Always restore `.env` from the same backup.

---

## What is NOT backed up

| What | Why |
|---|---|
| Customer operational databases (Postgres, InfluxDB, SQL Server, MongoDB, etc.) | These are source data systems — Mosaic queries them but doesn't own them. They are managed and backed up by the customer's IT team separately. |
| Elasticsearch index (`es-data`) | Logs and search indices. Large, recreatable from source data. |
| Airbyte workspace (`airbyte-workspace`) | Sync working/temp files. Transient. |
| Keycloak data | SSO realm config is re-configurable from the `.env` settings. |
| OpenMeter data | Metering/billing events. Large, analytics-only. |

**A restore from backup gives you back Mosaic itself** — all conversations, all connection configs, all dashboards, all users and rules — but your operational data is not Mosaic's to back up.

---

## Backup methods

### Automated (recommended)

The `mosaic-backup` Docker sidecar runs automatically when `docker compose up -d` is started. It:
- Runs a backup on startup, then on a configurable schedule (default: every 24h)
- Stores archives in `./backups/` on the host
- Prunes old archives automatically (default: keep last 30)
- Writes status to `/backup-status/last.json` for the UI to read

Configure via `.env`:
```bash
BACKUP_SCHEDULE_HOURS=12   # default: 24
BACKUP_KEEP=14             # default: 30
```

Or via the UI: **Settings → Backup & restore** → Schedule & retention.

### Manual (on-demand)

```bash
bash scripts/backup.sh                # backup to ./backups/
bash scripts/backup.sh /mnt/nas       # backup to custom directory
```

Produces: `backups/mosaic-backup-YYYYMMDD-HHMMSS.tar.gz`

---

## Restoring from a backup

```bash
bash scripts/restore.sh backups/mosaic-backup-20260524-120000.tar.gz
```

The script will:
1. Show a warning and require you to type `yes` to confirm
2. Stop the Mosaic container
3. Extract and restore all volumes
4. Restore `.env` (backing up the current one as `.env.pre-restore-*`)
5. Print instructions to restart

After restore, start Mosaic:
```bash
docker compose up -d
```

### Manual restore (without the script)

```bash
# Stop Mosaic
docker compose stop mosaic

# Restore the SQLite database volume
docker run --rm \
  -v mosaic_mosaic-data:/dest \
  -v /path/to/backup:/src:ro \
  alpine sh -c "rm -rf /dest/* && tar xf /src/mosaic-data.tar -C /dest"

# Start Mosaic
docker compose start mosaic
```

---

## Backup archive structure

```
mosaic-backup-YYYYMMDD-HHMMSS.tar.gz
├── MANIFEST.txt          # timestamp, hostname, file sizes, restore command
├── mosaic-data.tar       # mosaic.db + WAL files
├── superset-db-data.tar  # Superset Postgres
├── superset-data.tar     # Superset home
├── n8n-data.tar          # n8n workflows
├── ciso-data.tar         # CISO Assistant data
├── airbyte-db-data.tar   # Airbyte configs (if running)
└── .env                  # secrets file
```

---

## Off-site storage

Archives land in `./backups/` on the host server. For production, sync them off-site:

```bash
# Example: sync to S3
aws s3 sync ./backups/ s3://your-bucket/mosaic-backups/

# Example: sync to another server
rsync -av ./backups/ backup-server:/backups/mosaic/

# Example: add to crontab for nightly sync
0 3 * * * rsync -av /opt/mosaic/backups/ backup-server:/backups/mosaic/
```

---

## Backup status in the UI

**Settings → Backup & restore** shows:
- Last backup time, archive name, size, total archives stored
- Next scheduled backup time
- Run backup now button (triggers immediately, no restart needed)
- Schedule picker (6h / 12h / 24h / 48h)
- Retention picker (7 / 14 / 30 / 60 archives)
- Full archive list with sizes and dates

**Settings → System health** shows a single status row for quick health checks.

---

## Backup size reference

Typical archive sizes (development instance):

| Volume | Typical size |
|---|---|
| `mosaic-data` (SQLite DB) | 1–10 MB |
| `superset-db-data` | 10–50 MB |
| `ciso-data` | 50–100 MB |
| `superset-data` | < 1 MB |
| `n8n-data` | < 1 MB |
| `.env` | < 1 KB |
| **Total compressed** | **15–50 MB typical** |

Size grows with: number of conversations and messages, number of dashboards, CISO assessment evidence attachments.
