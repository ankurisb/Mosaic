#!/usr/bin/env bash
# ── Mosaic Backup ─────────────────────────────────────────────────────────────
# Creates a timestamped snapshot of all Mosaic data volumes.
#
# Usage:
#   bash scripts/backup.sh              # backup to ./backups/
#   bash scripts/backup.sh /mnt/nas     # backup to custom directory
#
# Output: backups/mosaic-backup-YYYYMMDD-HHMMSS.tar.gz
#
# What is backed up:
#   mosaic-data        → mosaic.db (conversations, connections, users, rules)
#   superset-db-data   → Superset dashboard definitions (Postgres)
#   superset-data      → Superset home directory
#   n8n-data           → n8n workflow definitions
#   ciso-data          → CISO Assistant compliance data
#   .env               → Environment file (secrets — handle with care)
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

BACKUP_DIR="${1:-./backups}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
ARCHIVE_NAME="mosaic-backup-${TIMESTAMP}.tar.gz"
WORK_DIR="$(mktemp -d)"
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Colours
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

log()  { echo -e "${GREEN}[backup]${NC} $*"; }
warn() { echo -e "${YELLOW}[backup]${NC} $*"; }
fail() { echo -e "${RED}[backup]${NC} $*" >&2; exit 1; }

# ── Pre-flight ────────────────────────────────────────────────────────────────
command -v docker >/dev/null 2>&1 || fail "Docker not found. Is Docker installed and running?"

mkdir -p "${BACKUP_DIR}"
BACKUP_DIR="$(cd "${BACKUP_DIR}" && pwd)"

log "Starting Mosaic backup → ${BACKUP_DIR}/${ARCHIVE_NAME}"
log "Working directory: ${WORK_DIR}"

# ── Helper: dump the Mosaic database consistently ─────────────────────────────
# The primary DB must NOT be captured by raw-copying its volume: a live SQLite DB
# in WAL mode can be mid-write, producing a torn/corrupt snapshot (this has
# happened before — see historical .corrupt-* files). Instead we produce a
# guaranteed-consistent single-file dump, driver-aware:
#   SQLite   → VACUUM INTO (atomic, live-only pages, no WAL, no cruft)
#   Postgres → pg_dump      (consistent logical dump)
# The dump lands in the work dir and is included in the archive; restore.sh
# reconstructs the DB from it.
dump_database() {
  # Resolve DATABASE_URL from the running mosaic container (authoritative — it's
  # what the app actually connects to), falling back to .env.
  local db_url
  db_url="$(docker exec mosaic sh -c 'echo "$DATABASE_URL"' 2>/dev/null || true)"
  [[ -z "${db_url}" ]] && db_url="$(grep -E '^DATABASE_URL=' "${SCRIPT_DIR}/.env" 2>/dev/null | head -1 | cut -d= -f2- || true)"

  if [[ "${db_url}" == sqlite://* ]]; then
    # Path inside the container, e.g. sqlite:///data/claude-app.db → /data/claude-app.db
    local db_path="${db_url#sqlite://}"
    log "  Database: SQLite (${db_path}) — consistent snapshot via VACUUM INTO"
    # sqlite3 CLI runs inside the mosaic container (added to its image). VACUUM
    # INTO writes a clean, fully-checkpointed copy with only live data.
    docker exec mosaic sh -c "rm -f /tmp/mosaic-db-snapshot.db && sqlite3 '${db_path}' \"VACUUM INTO '/tmp/mosaic-db-snapshot.db'\"" \
      || fail "SQLite VACUUM INTO failed — is sqlite3 present in the mosaic image?"
    docker cp mosaic:/tmp/mosaic-db-snapshot.db "${WORK_DIR}/mosaic-db.sqlite" \
      || fail "Could not copy the SQLite snapshot out of the container"
    docker exec mosaic sh -c 'rm -f /tmp/mosaic-db-snapshot.db' 2>/dev/null || true
    echo "sqlite" > "${WORK_DIR}/DB_KIND"
    log "  ✓ SQLite snapshot → mosaic-db.sqlite ($(du -h "${WORK_DIR}/mosaic-db.sqlite" | cut -f1))"
  elif [[ "${db_url}" == postgres://* || "${db_url}" == postgresql://* ]]; then
    log "  Database: Postgres — consistent logical dump via pg_dump"
    # pg_dump runs inside the mosaic container (it has psql client libs); output
    # is a plain-SQL dump restore.sh replays. --no-owner/--no-privileges keep it
    # portable across restore targets.
    docker exec mosaic sh -c "pg_dump --no-owner --no-privileges '${db_url}'" > "${WORK_DIR}/mosaic-db.sql" \
      || fail "pg_dump failed — is the Postgres client available in the mosaic image and the URL reachable?"
    echo "postgres" > "${WORK_DIR}/DB_KIND"
    log "  ✓ Postgres dump → mosaic-db.sql ($(du -h "${WORK_DIR}/mosaic-db.sql" | cut -f1))"
  else
    warn "  Could not determine DB type from DATABASE_URL ('${db_url}'). Falling back to raw volume copy (may be inconsistent for a live DB)."
    echo "volume" > "${WORK_DIR}/DB_KIND"
  fi
}

# ── Helper: dump a named Docker volume ────────────────────────────────────────
dump_volume() {
  local vol_name="$1"
  local dest_name="$2"
  local dest="${WORK_DIR}/${dest_name}.tar"

  if docker volume inspect "${vol_name}" >/dev/null 2>&1; then
    log "  Dumping volume: ${vol_name}"
    docker run --rm \
      -v "${vol_name}:/source:ro" \
      -v "${WORK_DIR}:/dest" \
      alpine sh -c "tar cf /dest/${dest_name}.tar -C /source ." 2>/dev/null
    log "  ✓ ${vol_name} → ${dest_name}.tar"
  else
    warn "  Volume ${vol_name} not found — skipping"
  fi
}

# ── Dump the primary database (consistent, driver-aware) ──────────────────────
log "Dumping Mosaic database..."
dump_database

# ── Dump volumes ──────────────────────────────────────────────────────────────
# NOTE: mosaic-data (the primary DB volume) is intentionally NOT tarred here —
# it's captured above as a clean VACUUM INTO / pg_dump snapshot instead, avoiding
# the torn-WAL corruption risk and the accumulated .corrupt-*/.bak-* cruft in the
# volume. The other volumes below are app-state that's safe to raw-copy.
log "Dumping Docker volumes..."

dump_volume "mosaic_superset-db-data"  "superset-db-data"
dump_volume "mosaic_superset-data"     "superset-data"
dump_volume "mosaic_n8n-data"          "n8n-data"
dump_volume "mosaic_ciso-data"         "ciso-data"
dump_volume "mosaic_airbyte-db-data"   "airbyte-db-data"

# ── Copy .env ─────────────────────────────────────────────────────────────────
ENV_FILE="${SCRIPT_DIR}/.env"
if [[ -f "${ENV_FILE}" ]]; then
  log "  Copying .env"
  cp "${ENV_FILE}" "${WORK_DIR}/.env"
else
  warn "  .env not found at ${ENV_FILE} — skipping"
fi

# ── Write backup manifest ─────────────────────────────────────────────────────
cat > "${WORK_DIR}/MANIFEST.txt" << EOF
Mosaic Backup
Timestamp:  ${TIMESTAMP}
Created at: $(date -u '+%Y-%m-%d %H:%M:%S UTC')
Hostname:   $(hostname)
Contents:
$(ls -lh "${WORK_DIR}"/*.tar 2>/dev/null | awk '{print "  " $9 " (" $5 ")"}' || echo "  (no volumes found)")

Restore with:
  bash scripts/restore.sh ${BACKUP_DIR}/${ARCHIVE_NAME}
EOF

# ── Create archive ────────────────────────────────────────────────────────────
log "Creating archive..."
tar czf "${BACKUP_DIR}/${ARCHIVE_NAME}" -C "${WORK_DIR}" .
rm -rf "${WORK_DIR}"

ARCHIVE_SIZE=$(du -sh "${BACKUP_DIR}/${ARCHIVE_NAME}" | cut -f1)
log ""
log "✓ Backup complete: ${BACKUP_DIR}/${ARCHIVE_NAME} (${ARCHIVE_SIZE})"
log ""

# ── Prune old backups (keep last 30) ─────────────────────────────────────────
BACKUP_COUNT=$(ls -1 "${BACKUP_DIR}"/mosaic-backup-*.tar.gz 2>/dev/null | wc -l)
if [[ ${BACKUP_COUNT} -gt 30 ]]; then
  log "Pruning old backups (keeping last 30 of ${BACKUP_COUNT})..."
  ls -1t "${BACKUP_DIR}"/mosaic-backup-*.tar.gz | tail -n +31 | xargs rm -f
  log "✓ Pruned $((BACKUP_COUNT - 30)) old backup(s)"
fi
