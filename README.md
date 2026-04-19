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
