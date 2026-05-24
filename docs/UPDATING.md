# Mosaic — Update Guide

This guide explains how to apply updates to Mosaic.

---

## How to know an update is available

Mosaic checks for new releases automatically.

Go to **Settings → About**. If a newer version is available, you'll see:

> **↑ Update available** — v1.x.x → [View release notes](#)

The release notes link shows you exactly what changed, what was fixed, and whether there are any breaking changes or migration steps required.

> You need a GitHub token configured in **Settings → API Keys → GitHub token** for the update check to work. Without it, the check is silently skipped.

---

## Before you update

1. **Read the release notes** for every version between your current version and the new one — not just the latest. Updates can include database migrations that are order-dependent.

2. **Back up your data:**
   ```bash
   cd /path/to/Mosaic
   docker compose exec mosaic cp /data/mosaic.db /data/mosaic.db.bak-$(date +%Y%m%d)
   ```
   Or copy the Docker volume directly:
   ```bash
   docker run --rm -v mosaic_mosaic-data:/data -v $(pwd):/backup alpine \
     tar czf /backup/mosaic-data-backup-$(date +%Y%m%d).tar.gz /data
   ```

3. **Back up your `.env` file:**
   ```bash
   cp .env .env.bak-$(date +%Y%m%d)
   ```

4. **Pick a low-traffic window.** The update takes 2–5 minutes. Mosaic will be unavailable during the restart.

---

## Applying the update

### Option A — Git (recommended if you cloned the repo)

```bash
cd /path/to/Mosaic

# 1. Pull the latest code
git pull origin main

# 2. Rebuild and restart
docker compose up -d --build
```

That's it. Docker rebuilds the Mosaic image with the new code and restarts all services.
Database migrations run automatically on startup.

### Option B — ZIP download

1. Download the latest release ZIP from GitHub → Releases
2. Extract it to a temporary folder
3. Copy the new files over your existing install, **preserving your `.env` file:**
   ```bash
   rsync -av --exclude='.env' --exclude='node_modules' --exclude='.next' \
     /path/to/new-release/ /path/to/Mosaic/
   ```
4. Rebuild and restart:
   ```bash
   cd /path/to/Mosaic
   docker compose up -d --build
   ```

---

## Verifying the update

After restart, check:

1. **Settings → About** — current version should match the new version number
2. **Settings → System Health** — all services green
3. Test a chat message to confirm AI is responding

---

## If something goes wrong

**Roll back to the previous version:**
```bash
cd /path/to/Mosaic
git stash          # or restore your backup ZIP
docker compose up -d --build
```

**Restore your database from backup:**
```bash
docker compose stop mosaic
docker run --rm -v mosaic_mosaic-data:/data alpine \
  cp /data/mosaic.db.bak-YYYYMMDD /data/mosaic.db
docker compose start mosaic
```

**Get help:** Run `docker compose logs -f mosaic` and share the output with support. Include your current version (Settings → About) and the version you were trying to update to.

---

## Update frequency

Mosaic follows semantic versioning:

| Version type | Example | Contains |
|---|---|---|
| Patch | 1.2.0 → 1.2.1 | Bug fixes, security patches. Safe to apply immediately. |
| Minor | 1.2.x → 1.3.0 | New features, no breaking changes. Read release notes. |
| Major | 1.x → 2.0 | Breaking changes possible. Read migration guide carefully. |

Security patches are marked **[security]** in the changelog and should be applied promptly.
