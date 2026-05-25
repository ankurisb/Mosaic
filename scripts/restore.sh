#!/usr/bin/env bash
# ── Mosaic Restore ────────────────────────────────────────────────────────────
# Restores Mosaic from a backup archive created by backup.sh.
#
# Usage:
#   bash scripts/restore.sh backups/mosaic-backup-20260524-120000.tar.gz
#
# ⚠️  WARNING: This OVERWRITES all current Mosaic data.
#     Run this on a stopped or fresh stack only.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

ARCHIVE="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

log()  { echo -e "${GREEN}[restore]${NC} $*"; }
warn() { echo -e "${YELLOW}[restore]${NC} $*"; }
fail() { echo -e "${RED}[restore]${NC} $*" >&2; exit 1; }

# ── Validate ──────────────────────────────────────────────────────────────────
[[ -z "${ARCHIVE}" ]]       && fail "Usage: bash scripts/restore.sh <backup-archive.tar.gz>"
[[ ! -f "${ARCHIVE}" ]]     && fail "Archive not found: ${ARCHIVE}"
command -v docker >/dev/null || fail "Docker not found."

ARCHIVE="$(cd "$(dirname "${ARCHIVE}")" && pwd)/$(basename "${ARCHIVE}")"

# ── Confirmation ──────────────────────────────────────────────────────────────
echo ""
echo -e "${RED}⚠️  WARNING${NC}: This will OVERWRITE all current Mosaic data."
echo "   Archive: ${ARCHIVE}"
echo "   Target:  $(hostname)"
echo ""
read -r -p "Type 'yes' to confirm restore: " CONFIRM
[[ "${CONFIRM}" != "yes" ]] && { echo "Restore cancelled."; exit 0; }

# ── Stop Mosaic if running ─────────────────────────────────────────────────────
log "Stopping Mosaic services..."
cd "${SCRIPT_DIR}"
docker compose stop mosaic 2>/dev/null || true

# ── Extract archive ───────────────────────────────────────────────────────────
WORK_DIR="$(mktemp -d)"
log "Extracting archive to ${WORK_DIR}..."
tar xzf "${ARCHIVE}" -C "${WORK_DIR}"

# Show manifest if present
if [[ -f "${WORK_DIR}/MANIFEST.txt" ]]; then
  echo ""
  cat "${WORK_DIR}/MANIFEST.txt"
  echo ""
fi

# ── Helper: restore a volume ──────────────────────────────────────────────────
restore_volume() {
  local tar_file="${WORK_DIR}/$1.tar"
  local vol_name="$2"

  if [[ ! -f "${tar_file}" ]]; then
    warn "  ${tar_file} not in archive — skipping ${vol_name}"
    return
  fi

  log "  Restoring → ${vol_name}"
  # Create volume if it doesn't exist
  docker volume create "${vol_name}" >/dev/null 2>&1 || true
  # Clear and restore
  docker run --rm \
    -v "${vol_name}:/dest" \
    -v "${WORK_DIR}:/src:ro" \
    alpine sh -c "rm -rf /dest/* && tar xf /src/$1.tar -C /dest"
  log "  ✓ ${vol_name}"
}

# ── Restore volumes ───────────────────────────────────────────────────────────
log "Restoring volumes..."
restore_volume "mosaic-data"      "mosaic_mosaic-data"
restore_volume "superset-db-data" "mosaic_superset-db-data"
restore_volume "superset-data"    "mosaic_superset-data"
restore_volume "n8n-data"         "mosaic_n8n-data"
restore_volume "ciso-data"        "mosaic_ciso-data"
restore_volume "airbyte-db-data"  "mosaic_airbyte-db-data"

# ── Restore .env ──────────────────────────────────────────────────────────────
if [[ -f "${WORK_DIR}/.env" ]]; then
  TARGET_ENV="${SCRIPT_DIR}/.env"
  if [[ -f "${TARGET_ENV}" ]]; then
    cp "${TARGET_ENV}" "${TARGET_ENV}.pre-restore-$(date +%Y%m%d-%H%M%S)"
    warn "  Existing .env backed up as .env.pre-restore-*"
  fi
  cp "${WORK_DIR}/.env" "${TARGET_ENV}"
  log "  ✓ .env restored"
fi

rm -rf "${WORK_DIR}"

# ── Restart ───────────────────────────────────────────────────────────────────
log ""
log "Restore complete."
log ""
log "Start Mosaic with:"
log "  docker compose up -d"
log ""
warn "If AUTH_SECRET changed between backup and now, stored credentials"
warn "will not decrypt. Use the .env from the backup in that case."
