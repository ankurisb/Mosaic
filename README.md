# mosaic v2

Industrial AI chat application built with Next.js 15, Anthropic Claude, and Neon Postgres.

## Features

- **AI Chat** — Claude with tool use: query databases (Postgres, ClickHouse, InfluxDB, SQLite), call SAP/REST APIs, read file servers
- **RCA** — Root cause analysis with 14 visualisation types (fishbone, pareto, timeline, CAP, fault tree, 5 whys, scatter, histogram, control chart, correlation, heatmap, boxplot, sankey, comparison)
- **Dashboards** — 9 chart types, 4-column grid, drag-to-resize panels, auto-refresh
- **Rules** — Workflow automation: multi-condition AND/OR logic, 4 action types (notify/API/RCA/query), cooldown/consecutive/active-hours controls
- **Integrations** — Slack, Teams, Email (SMTP), Webhook, Twilio SMS, Twilio WhatsApp, recipient groups
- **Settings** — DB connections, API services, file servers, users, usage analytics, monitoring, RCA workflows

## Stack

- **Frontend**: Next.js 15 (App Router), React 19, inline SVG charts
- **Backend**: Next.js API routes, `runtime = 'nodejs'`
- **Database**: Neon Postgres (serverless), `@neondatabase/serverless`
- **AI**: Anthropic Claude claude-sonnet-4-20250514 via `@anthropic-ai/sdk`
- **Deployment**: Vercel (cron job for scheduler)

## Deploy

### 1. Create a Neon database
Go to [neon.tech](https://neon.tech), create a project, copy the connection string.

### 2. Set environment variables on Vercel

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | Neon connection string |
| `ANTHROPIC_API_KEY` | ✅ | From console.anthropic.com |
| `AUTH_SECRET` | ✅ | `openssl rand -hex 32` |
| `CRON_SECRET` | ✅ | `openssl rand -hex 32` — secures the scheduler endpoint |
| `ADMIN_EMAIL` | ✅ | First admin account email |
| `ADMIN_PASSWORD` | ✅ | First admin account password |
| `ADMIN_NAME` | ✅ | First admin account display name |
| `TAVILY_API_KEY` | optional | Web search (or set in Settings → API Keys) |
| `TWILIO_ACCOUNT_SID` | optional | SMS/WhatsApp (or set in Settings → API Keys) |
| `TWILIO_AUTH_TOKEN` | optional | SMS/WhatsApp (or set in Settings → API Keys) |

### 3. Deploy
```bash
npm install
vercel deploy --prod
```

The database schema is created automatically on first request (idempotent `CREATE TABLE IF NOT EXISTS`).

## Local development
```bash
cp .env.example .env.local
# Fill in .env.local
npm install
npm run dev
```

## Cron job
`vercel.json` configures a cron job at `* * * * *` (every minute) that calls `POST /api/integrations/scheduler`.
This evaluates both `integration_rules` (simple notifications) and `rule_groups` (the full Rules module).
Secure it with `CRON_SECRET` — Vercel passes this automatically to the endpoint.

> **Note**: Every-minute cron requires Vercel Pro. On the free tier, change to `*/5 * * * *` (every 5 minutes).

## Docker Deployment (On-Prem / Self-Hosted)

`docker compose up -d` starts the complete Mosaic stack including CISO Assistant.

### Services

| Service | Port | Purpose |
|---------|------|---------|
| mosaic | 3001 | Main application |
| ciso-caddy | **8443** | CISO Assistant — GRC platform |
| airbyte-proxy | 8000 | Airbyte data sync |
| superset | 8088 | Analytics (accessed via Mosaic) |
| n8n | 5678 | Workflow automation |
| openmeter | 10000 | Usage metering admin |
| keycloak | 8080 | SSO (optional, `COMPOSE_PROFILES=sso`) |

### Resource requirements

Docker Desktop needs **8GB RAM** minimum. First run pulls ~5–7GB of images.

```
Docker Desktop → Settings → Resources → Memory → 8GB
```

### Quick start

```bash
cp .env.example .env.local
# Edit .env.local — set at minimum:
#   ANTHROPIC_API_KEY, AUTH_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
#   CISO_SUPERUSER_EMAIL, CISO_SUPERUSER_PASSWORD

docker compose up -d
```

Access:
- **Mosaic:** http://localhost:3001
- **CISO Assistant:** http://localhost:8443

### CISO Assistant — GRC layer

CISO Assistant is the governance documentation layer alongside Mosaic's automated technical controls:

| Layer | Where |
|-------|-------|
| Technical controls (automated) | Mosaic → Settings → Audit trail → Show live checks |
| Governance documentation (manual) | CISO Assistant → http://localhost:8443 |

Both are required for ISO 27001 certification. Mosaic proves the controls work; CISO Assistant documents the governance around them (risk register, control evidence, Statement of Applicability, SOPs).

**First-run setup for CISO Assistant:**
1. Log in at http://localhost:8443 with `CISO_SUPERUSER_EMAIL` / `CISO_SUPERUSER_PASSWORD`
2. Library → Browse → search "ISO 27001" → Load
3. Compliance → New Audit → select ISO 27001 → name it your assessment
4. For controls covered by Mosaic automatically (A.8.15, A.8.24, A.5.15), mark as "Implemented" with evidence note "Automated — verified via Mosaic compliance panel"
5. For manual SOPs (A.5.24 incident response, A.8.13 backup, A.7.x physical), attach your policy documents as evidence

**Credentials:**

| System | Credential |
|--------|-----------|
| Mosaic | ADMIN_EMAIL / ADMIN_PASSWORD from .env.local |
| CISO Assistant | CISO_SUPERUSER_EMAIL / CISO_SUPERUSER_PASSWORD from .env.local |

> ⚠️ CISO Assistant credentials are only applied on **first run**. Changing them after first start has no effect. To reset: `docker compose down && docker volume rm mosaic_ciso-data && docker compose up -d` (wipes all GRC data — export first).

### Common commands

```bash
# Start all services
docker compose up -d

# View logs
docker compose logs -f mosaic
docker compose logs -f ciso-backend
docker compose logs -f ciso-caddy

# Restart a single service
docker compose restart mosaic

# Stop everything (preserves data volumes)
docker compose down

# Wipe all data (full reset)
docker compose down -v
```

### Data volumes

| Volume | Contents |
|--------|----------|
| mosaic-data | Mosaic SQLite database |
| ciso-data | CISO Assistant database (risk register, audits, controls, evidence) |
| ciso-caddy-data | Caddy proxy TLS data |
| airbyte-db-data | Airbyte sync configurations |
| superset-db-data | Superset dashboards |

### Troubleshooting

**CISO Assistant shows blank page on first load** — the backend takes 60–90 seconds to initialise on first run. Watch progress with `docker compose logs -f ciso-backend` and wait for the healthcheck to pass.

**Port 8443 already in use** — `lsof -ti:8443 | xargs kill -9`

**Out of memory** — increase Docker Desktop RAM to 10GB: Docker Desktop → Settings → Resources → Memory.
