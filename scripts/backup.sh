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

# ── Dump volumes ──────────────────────────────────────────────────────────────
log "Dumping Docker volumes..."

dump_volume "mosaic_mosaic-data"       "mosaic-data"
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
