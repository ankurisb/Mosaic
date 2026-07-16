# Mosaic — AWS Deployment Runbook (Postgres / RDS)

Deploying Mosaic to a public VM (`mosaic.ugx.ai`) backed by AWS RDS Postgres.

**Audience:** whoever is at the AWS console + SSH'd into the VM. Commands are
copy-paste. Steps that touch credentials or irreversible AWS actions are the
operator's to run — never automate account-level actions.

**Scope of this runbook:** first-time production deployment. It assumes the code
is already Postgres-ready (migration complete, verified) and on GitHub.

---

## 0. Pre-flight — decisions already made

| Thing | Decision |
|---|---|
| VM | EC2 `t3.xlarge` (4 vCPU / 16 GB) — matches the proven ~12 GB stack need. `t3.2xlarge` if heavy concurrent load. |
| OS | Ubuntu 24.04 LTS |
| Disk | 40–50 GB gp3 (Docker images for the full stack are large — Airbyte especially) |
| Database | **AWS RDS for PostgreSQL 15** (managed backups, PITR, optional Multi-AZ). Same PG version as the local dev + what ships to customers containerised. |
| Domain | `mosaic.ugx.ai` |
| TLS | Caddy (already in the stack) via Let's Encrypt |
| Security group | Inbound: **22** (SSH, locked to your IP), **80** + **443** (web/TLS). Nothing else — internal tools are reached through Caddy, not open ports. |

**Portability note:** the app targets standard Postgres, so this same runbook
works against Azure Database for PostgreSQL Flexible Server or GCP Cloud SQL by
changing only `DATABASE_URL`. Nothing here is AWS-specific except the console
steps in §1–§2.

---

## 1. Provision RDS Postgres  *(operator, AWS console)*

1. RDS → Create database → **Standard create** → **PostgreSQL** → version **15.x**.
2. Templates: **Production** (enables Multi-AZ + sensible defaults) — or Dev/Test
   to start cheaper; Multi-AZ can be enabled later.
3. Settings:
   - DB instance identifier: `mosaic-prod`
   - Master username: `mosaic`
   - Master password: generate a strong one — **store it in your password
     manager**, you'll put it in `.env` on the VM.
4. Instance class: `db.t3.medium` is a reasonable start (2 vCPU / 4 GB). Scale up
   later if needed — the app's DB load is metadata, not heavy OLAP.
5. Storage: 20–50 GB gp3, enable **storage autoscaling**.
6. Connectivity:
   - **VPC:** same VPC as the EC2 VM (so they talk over private networking).
   - **Public access: No** (the VM reaches it privately; nothing else should).
   - **VPC security group:** create/choose one that allows inbound **5432 from
     the EC2 VM's security group only** (not `0.0.0.0/0`).
7. Additional config:
   - Initial database name: `mosaic`
   - **Enable automated backups** (retention ≥ 7 days) and **Point-in-time
     recovery** (this is the whole reason we chose RDS — don't skip it).
8. Create. Wait until **Available**, then copy the **endpoint** hostname
   (e.g. `mosaic-prod.abc123.eu-west-2.rds.amazonaws.com`).

**Resulting `DATABASE_URL`:**
```
postgres://mosaic:<PASSWORD>@<RDS_ENDPOINT>:5432/mosaic?sslmode=require
```
`sslmode=require` matters — RDS supports TLS and you want it on. (The `pg` driver
honours `sslmode` in the URL.)

---

## 2. Provision the EC2 VM  *(operator, AWS console)*

1. EC2 → Launch instance.
   - Name: `mosaic-prod`
   - AMI: **Ubuntu Server 24.04 LTS**
   - Type: **t3.xlarge**
   - Key pair: create/select one — **keep the `.pem` safe**, it's your SSH access.
   - Storage: **50 GB gp3**.
2. Network / security group (inbound rules):
   - SSH **22** → Source: **My IP** (your current IP only).
   - HTTP **80** → `0.0.0.0/0` (Let's Encrypt HTTP-01 + redirect to HTTPS).
   - HTTPS **443** → `0.0.0.0/0`.
   - **No other inbound ports.**
3. Ensure this instance's security group is the one allowed inbound to RDS:5432
   (from §1.6).
4. Launch. Note the **public IPv4**.

### 2a. DNS
Point `mosaic.ugx.ai` (A record) at the VM's public IPv4. Let it propagate
before the TLS step (Caddy needs the domain resolving to the box to get a cert).

### 2b. First SSH in
```bash
ssh -i /path/to/key.pem ubuntu@mosaic.ugx.ai
```

---

## 3. Prepare the VM  *(operator, on the VM via SSH)*

```bash
# System update
sudo apt-get update && sudo apt-get upgrade -y

# Docker Engine + Compose plugin (official convenience script)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu       # run docker without sudo
newgrp docker                        # apply group in current shell

# Verify
docker --version
docker compose version

# Postgres client (for running the migration + sanity checks from the VM)
sudo apt-get install -y postgresql-client-15 git
```

### 3a. Confirm the VM can reach RDS
```bash
psql "postgres://mosaic:<PASSWORD>@<RDS_ENDPOINT>:5432/mosaic?sslmode=require" -c "SELECT version();"
```
Expect the PostgreSQL 15 version string. If it hangs → the RDS security group
isn't allowing 5432 from this VM's SG (fix §1.6).

---

## 4. Get the code + configure  *(operator, on the VM)*

```bash
git clone https://github.com/ankurisb/Mosaic.git
cd Mosaic
cp .env.example .env
```

Edit `.env`. **The critical line is `DATABASE_URL` — set it to RDS.** Minimum
required for boot:

```bash
# --- Database (the important one) ---
DATABASE_URL=postgres://mosaic:<PASSWORD>@<RDS_ENDPOINT>:5432/mosaic?sslmode=require

# --- Auth / core (REQUIRED) ---
AUTH_SECRET=<64-hex-char random string>   # openssl rand -hex 32
ANTHROPIC_API_KEY=<your key>

# --- First admin (used on first boot) ---
ADMIN_EMAIL=you@ugx.ai
ADMIN_PASSWORD=<strong password>
ADMIN_NAME=Ankur

# --- Others (set real values before relying on those features) ---
CRON_SECRET=<random>
TAVILY_API_KEY=<optional, for web search>
SUPERSET_SECRET_KEY=<random>
SUPERSET_ADMIN_PASSWORD=<strong>
SUPERSET_DB_PASSWORD=<strong>
# ... (CISO, Airbyte, etc. — set as you enable each tool)
```

Generate secrets:
```bash
openssl rand -hex 32     # AUTH_SECRET
openssl rand -hex 24     # CRON_SECRET / SUPERSET_SECRET_KEY
```

> **Why `DATABASE_URL` matters here:** the compose file now respects
> `${DATABASE_URL}` for the mosaic service (fixed pre-deploy). If you leave it
> unset it falls back to SQLite — so a blank `DATABASE_URL` = accidental SQLite.
> Double-check it's set to the RDS URL.

### 4a. Point the domain in the Caddyfile
Edit `docker/caddy/Caddyfile` — replace the site address at the top with
`mosaic.ugx.ai` so Caddy requests a real Let's Encrypt cert for it. (The file is
structured per-origin; the front-door block is the Mosaic one on 443.)

---

## 5. Schema + data — two paths

### Path A — Fresh install (no existing data to carry over)
The app creates the schema automatically. `setupDatabase()` detects the Postgres
URL and runs `setupDatabasePostgres()` (idempotent, `CREATE TABLE IF NOT EXISTS`)
lazily on the first API request. So just bring the stack up (§6) and the schema
builds itself. First boot also seeds the admin from `ADMIN_EMAIL/PASSWORD`.

### Path B — Migrating existing data (carrying over the current SQLite data)
Do this **before** first user traffic.

1. On the machine that has the current SQLite DB (your Mac), take a **static
   snapshot** (never migrate from a live file):
   ```bash
   sqlite3 /Users/ankursingh/claude-app/data/claude-app.db \
     ".backup /tmp/mosaic-migration-source.db"
   ```
2. Copy the snapshot to the VM:
   ```bash
   scp -i /path/to/key.pem /tmp/mosaic-migration-source.db ubuntu@mosaic.ugx.ai:/tmp/
   ```
3. On the VM, first create the schema (bring the stack up once so
   `setupDatabasePostgres()` runs — see §6 — then stop the mosaic container, or
   run the schema build directly). Then run the migration script
   (`scripts/migration/sqlite-to-postgres.ts`), pointing it at the snapshot and
   the RDS URL. The script:
   - reads only the static snapshot,
   - normalises timestamps to ISO T-format,
   - converts booleans, handles the BIGINT column,
   - bypasses FK ordering with `session_replication_role=replica`.
   > It currently has the snapshot path and PG URL near the top of the file —
   > set them to `/tmp/mosaic-migration-source.db` and the RDS URL, or
   > parameterise via env before running with `npx tsx`.
4. **Verify row counts** match the source before trusting it (the script prints
   per-table `migrated/total`; all should be `N/N`).

---

## 6. Bring up the stack  *(operator, on the VM)*

```bash
cd ~/Mosaic
# Build + start everything (first build is long — the full stack is ~12 GB)
docker compose up -d --build

# Watch mosaic come up
docker compose logs -f mosaic
```

Confirm the app picked up Postgres, not SQLite:
```bash
docker exec mosaic sh -c 'echo $DATABASE_URL'
# must print the postgres:// RDS URL, NOT sqlite://
```

Health check (from the VM):
```bash
curl -sk https://localhost/api/health | head -c 300
# expect {"status":"ok",...,"database":{"status":"ok",...}}
```

---

## 7. TLS + domain verification

Caddy auto-provisions a Let's Encrypt cert for `mosaic.ugx.ai` on first request
(needs DNS resolving + ports 80/443 open — §2). Verify from your laptop:
```bash
curl -sI https://mosaic.ugx.ai/login    # 200, valid cert (no -k needed)
```
If the cert fails: check DNS resolves to the VM, and 80/443 are open in the SG.

---

## 8. Post-deploy verification checklist

- [ ] `https://mosaic.ugx.ai/login` loads over valid TLS
- [ ] Log in as the admin (`ADMIN_EMAIL` / `ADMIN_PASSWORD`)
- [ ] `/api/health` → database `ok`
- [ ] If migrated (Path B): conversations, connections, users all present
- [ ] Send a test chat message → gets a response, persists
- [ ] Settings → System Health → **Backup**: sidecar status `ok`, and it's now
      using `pg_dump` (the sidecar reads the same `DATABASE_URL`)
- [ ] Confirm a backup archive appears in `~/Mosaic/backups/`
- [ ] Spot-check an admin surface (audit log, transparency) loads

---

## 9. Backups — what you now have

- **RDS automated backups + PITR** (the primary safety net — off-box, managed).
- **Mosaic backup sidecar** additionally runs `pg_dump -Fc` on schedule into
  `~/Mosaic/backups/` (a second, logical, restorable copy). Restore with:
  ```bash
  pg_restore -d "postgres://mosaic:<PW>@<RDS_ENDPOINT>:5432/mosaic?sslmode=require" \
    mosaic-postgres.dump
  ```
  > **Recommended:** ship those `pg_dump` archives off the VM too (e.g. sync
  > `~/Mosaic/backups/` to S3 on a cron) so a VM loss doesn't take them. RDS
  > PITR covers the DB itself; this covers the logical dumps.

---

## 10. Rollback / safety

- The deploy doesn't touch your local Mac SQLite setup — it stays intact.
- If first boot goes wrong on RDS, the RDS instance can be wiped + schema
  re-created (`setupDatabasePostgres` is idempotent) without affecting anything
  local.
- Keep the migration snapshot (`/tmp/mosaic-migration-source.db`) until you've
  verified the deployed instance — it's your source of truth for a re-run.

---

## Appendix — gotchas learned during migration prep

- **`DATABASE_URL` unset = silent SQLite.** Always confirm
  `docker exec mosaic sh -c 'echo $DATABASE_URL'` shows the RDS URL.
- **Timestamps are ISO T-format** (`...T...Z`) across DDL defaults, runtime
  writes, and migrated data — consistent, so range queries work. Don't
  hand-insert space-format timestamps.
- **Flag columns are real `BOOLEAN`** in Postgres; the app uses `= true/false`.
- **`pg_dump` client must match server major version** (15). The sidecar image
  pins `postgresql15-client`; if you run `pg_dump` from the VM, use
  `postgresql-client-15`.
- **Never run host `sqlite3`/tools against a live bind-mounted DB** — that's what
  caused corruption during dev. Not relevant on RDS, but noted.
- Pre-existing TypeScript errors in `TabAPIs.tsx`, `TabAuth.tsx`,
  `TabMonitor.tsx`, `superset-sync.ts` are unrelated to the DB and don't block
  the build.
