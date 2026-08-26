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

# ── Helper: restore the primary database from its consistent snapshot ─────────
# Backups made by the hardened backup.sh capture the DB as a clean snapshot
# (mosaic-db.sqlite via VACUUM INTO, or mosaic-db.sql via pg_dump) rather than a
# raw volume copy. DB_KIND records which. We reconstruct into the mosaic-data
# volume under the canonical filename mosaic.db.
#
# Back-compat: older archives captured mosaic-data.tar (raw volume). If no DB_KIND
# snapshot is present but that tar is, we fall back to the old volume restore.
restore_database() {
  local vol_name="mosaic_mosaic-data"
  local db_kind=""
  [[ -f "${WORK_DIR}/DB_KIND" ]] && db_kind="$(cat "${WORK_DIR}/DB_KIND")"

  if [[ "${db_kind}" == "sqlite" && -f "${WORK_DIR}/mosaic-db.sqlite" ]]; then
    log "  Restoring SQLite database → ${vol_name} (mosaic.db)"
    docker volume create "${vol_name}" >/dev/null 2>&1 || true
    # Wipe the volume and place the snapshot as the canonical mosaic.db. No WAL/shm
    # is restored — SQLite recreates them cleanly on first open.
    docker run --rm \
      -v "${vol_name}:/dest" \
      -v "${WORK_DIR}:/src:ro" \
      alpine sh -c "rm -rf /dest/* && cp /src/mosaic-db.sqlite /dest/mosaic.db"
    log "  ✓ SQLite database restored as mosaic.db"
  elif [[ "${db_kind}" == "postgres" && -f "${WORK_DIR}/mosaic-db.sql" ]]; then
    log "  Restoring Postgres database via psql replay"
    # Replay the logical dump into the target Postgres named in DATABASE_URL.
    local db_url
    db_url="$(docker exec mosaic sh -c 'echo "$DATABASE_URL"' 2>/dev/null || true)"
    [[ -z "${db_url}" ]] && fail "Cannot restore Postgres dump: DATABASE_URL not resolvable from the mosaic container."
    docker exec -i mosaic sh -c "psql '${db_url}'" < "${WORK_DIR}/mosaic-db.sql" \
      || fail "psql replay failed. The database may be partially restored."
    log "  ✓ Postgres database restored"
  elif [[ -f "${WORK_DIR}/mosaic-data.tar" ]]; then
    warn "  Legacy archive (raw volume) — restoring mosaic-data.tar as-is."
    docker volume create "${vol_name}" >/dev/null 2>&1 || true
    docker run --rm \
      -v "${vol_name}:/dest" \
      -v "${WORK_DIR}:/src:ro" \
      alpine sh -c "rm -rf /dest/* && tar xf /src/mosaic-data.tar -C /dest"
    log "  ✓ Legacy volume restored"
  else
    fail "No database snapshot found in archive (expected mosaic-db.sqlite, mosaic-db.sql, or legacy mosaic-data.tar)."
  fi
}

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

# ── Restore database + volumes ────────────────────────────────────────────────
log "Restoring database..."
restore_database

log "Restoring volumes..."
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
