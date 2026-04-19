[README.md](https://github.com/user-attachments/files/26871972/README.md)
# Mosaic — Developer Handoff

Mosaic is a local-first industrial AI platform by UGX Systems. It connects to existing factory data infrastructure (SQL databases, time-series stores, Airbyte pipelines, file servers, REST APIs) and provides a conversational AI interface powered by Anthropic's Claude.

**Core value proposition:** Bring AI to the data, not the data to the cloud. Runs on-premise, connects to what's already there, never requires data to leave the facility.

---

## Handoff Pack Contents

```
mosaic-handoff/
├── README.md               ← you are here
├── source/
│   └── mosaic-v1.0.0.zip   ← complete source code
└── docs/
    ├── ARCHITECTURE.md     ← decisions, patterns, gotchas (read this first)
    ├── SCHEMA.md           ← all 17 database tables documented
    ├── FEATURES.md         ← built / partial / planned inventory
    ├── ENV_TEMPLATE.md     ← every environment variable with purpose
    ├── SETUP.md            ← from zero to running
    ├── SUPERSET.md         ← Superset white-label + embed integration
    └── CHANGELOG.md        ← v1.0.0 release notes
```

---

## Quick Start

```bash
# 1. Extract source
unzip mosaic-v1.0.0.zip && cd mosaic-v1.0.0

# 2. Install
npm install

# 3. Configure (see docs/ENV_TEMPLATE.md)
cp .env.example .env.local
# edit .env.local with your values

# 4. Build and run
npm run build
PORT=3001 npm start
```

Open `http://localhost:3001`

---

## Key Technical Facts

| Thing | Value |
|-------|-------|
| Framework | Next.js 15 App Router |
| AI model | claude-sonnet-4-6 (default) |
| App database | SQLite (local) or Neon Postgres (cloud) |
| Default port | 3001 |
| Update command | `bash ~/mosaic/update.sh` |
| Stop command | `bash ~/mosaic/stop.sh` |
| Logs | `tail -f ~/mosaic/logs/server.log` |

---

## Where to Start

**If you're setting up from scratch:** Read `docs/SETUP.md`

**If you're extending the codebase:** Read `docs/ARCHITECTURE.md` — especially the gotchas section. It will save you hours.

**If you want to understand the data model:** Read `docs/SCHEMA.md`

**If you're deploying to production:** Read `docs/ENV_TEMPLATE.md` and `docs/SETUP.md#production`

**If you're working on the Superset integration:** Read `docs/SUPERSET.md`

---

## Current Status

**Working and deployed:**
- Chat with tool use (DB queries, API calls, file reads, web search)
- Smart database selection (auto-inject + chips + @ mention)
- Airbyte integration (abctl OAuth2 + Docker Compose)
- All settings tabs including File Servers
- Superset auto-sync on DB connection save

**Planned next:**
- Superset embedded dashboards (iframe + guest token)
- OSIsoft PI Web API pre-configured template
- Airbyte source creation via Mosaic UI

See `docs/FEATURES.md` for the complete inventory.

---

## Critical Gotchas (do not skip)

1. **`AUTH_SECRET` changing breaks all encrypted credentials** — regenerating it requires deleting and recreating all DB connections
2. **Never use Postgres-specific SQL syntax** — `::int`, `ANY()`, `now()` break SQLite
3. **JSX in module-level arrays** causes React hydration error #130 — always use a component function
4. **`INP` and `SEL` in ui.tsx are style objects**, not components — use `<input style={INP} />`
5. **`Grid` requires a `cols` prop** — omitting it crashes the component
6. **The tools array stray comma** caused `tools.4: Input should be an object` — never let undefined entries into the TOOLS array

Full details in `docs/ARCHITECTURE.md`.

---

## Contact

Built by Ankur Singh, UGX Systems (ankur@ugx.ai)
