#!/usr/bin/env bash
# Mosaic backup sidecar — runs inside Docker, triggered by cron schedule.
# Writes status to /backup-status/last.json for the Mosaic API to read.

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backups}"
BACKUP_KEEP="${BACKUP_KEEP:-30}"
SCHEDULE_HOURS="${BACKUP_SCHEDULE_HOURS:-24}"
STATUS_FILE="/backup-status/last.json"

log() { echo "[backup-sidecar] $(date -u '+%Y-%m-%d %H:%M:%S UTC') $*"; }

run_backup() {
  TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
  ARCHIVE="${BACKUP_DIR}/mosaic-backup-${TIMESTAMP}.tar.gz"
  WORK_DIR="$(mktemp -d)"
  START="$(date +%s)"

  log "Starting backup → ${ARCHIVE}"

  # Write in-progress status
  cat > "${STATUS_FILE}" << EOF
{"status":"running","started_at":"$(date -u '+%Y-%m-%dT%H:%M:%SZ')","last_archive":null,"error":null}
EOF

  # Dump each volume into the work dir
  dump_volume() {
    local vol="$1" name="$2"
    if [ -d "/volumes/${name}" ]; then
      tar cf "${WORK_DIR}/${name}.tar" -C "/volumes/${name}" . 2>/dev/null && \
        log "  ✓ ${vol}" || log "  ✗ ${vol} (failed)"
    else
      log "  – ${vol} (not mounted — skipping)"
    fi
  }

  dump_volume "mosaic-data"      "mosaic-data"
  dump_volume "superset-db-data" "superset-db-data"
  dump_volume "n8n-data"         "n8n-data"
  dump_volume "ciso-data"        "ciso-data"

  # Manifest
  cat > "${WORK_DIR}/MANIFEST.txt" << EOF
Mosaic Backup
Timestamp: ${TIMESTAMP}
Created:   $(date -u '+%Y-%m-%d %H:%M:%S UTC')
EOF

  # Create archive
  mkdir -p "${BACKUP_DIR}"
  tar czf "${ARCHIVE}" -C "${WORK_DIR}" .
  rm -rf "${WORK_DIR}"

  SIZE=$(du -sh "${ARCHIVE}" | cut -f1)
  ELAPSED=$(( $(date +%s) - START ))
  log "✓ Backup complete: $(basename "${ARCHIVE}") (${SIZE}, ${ELAPSED}s)"

  # Prune old backups
  COUNT=$(ls -1 "${BACKUP_DIR}"/mosaic-backup-*.tar.gz 2>/dev/null | wc -l)
  if [ "${COUNT}" -gt "${BACKUP_KEEP}" ]; then
    ls -1t "${BACKUP_DIR}"/mosaic-backup-*.tar.gz | tail -n +$((BACKUP_KEEP + 1)) | xargs rm -f
    log "Pruned $((COUNT - BACKUP_KEEP)) old backup(s)"
  fi

  # Latest listing for status
  LATEST=$(ls -1t "${BACKUP_DIR}"/mosaic-backup-*.tar.gz 2>/dev/null | head -1 || echo "")
  LATEST_SIZE=$([ -f "${LATEST}" ] && du -sh "${LATEST}" | cut -f1 || echo "0")
  TOTAL=$(ls -1 "${BACKUP_DIR}"/mosaic-backup-*.tar.gz 2>/dev/null | wc -l)

  cat > "${STATUS_FILE}" << EOF
{"status":"ok","last_backup_at":"$(date -u '+%Y-%m-%dT%H:%M:%SZ')","last_archive":"$(basename "${LATEST}")","archive_size":"${LATEST_SIZE}","total_archives":${TOTAL},"duration_seconds":${ELAPSED},"error":null,"schedule_hours":${SCHEDULE_HOURS}}
EOF
}

# ── Main loop ─────────────────────────────────────────────────────────────────
log "Mosaic backup sidecar started. Schedule: every ${SCHEDULE_HOURS}h. Keeping last ${BACKUP_KEEP}."

# Run immediately on start, then on schedule
while true; do
  run_backup || {
    log "✗ Backup failed"
    cat > "${STATUS_FILE}" << EOF
{"status":"error","last_backup_at":null,"last_archive":null,"error":"Backup script failed — check sidecar logs","schedule_hours":${SCHEDULE_HOURS}}
EOF
  }
  log "Next backup in ${SCHEDULE_HOURS}h. Sleeping..."
  sleep $(( SCHEDULE_HOURS * 3600 ))
done
