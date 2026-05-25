#!/usr/bin/env bash
# Mosaic backup sidecar — runs inside Docker, triggered by schedule or UI.
# Writes status to /backup-status/last.json for the Mosaic API to read.
# Reads /backup-status/config.json for runtime schedule/retention overrides.
# Watches /backup-status/trigger for on-demand backups from the UI.

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backups}"
STATUS_FILE="/backup-status/last.json"
TRIGGER_FILE="/backup-status/trigger"
CONFIG_FILE="/backup-status/config.json"

# Read config — prefer config file (written by UI), fall back to env vars
read_config() {
  if [ -f "${CONFIG_FILE}" ]; then
    SCHEDULE_HOURS=$(python3 -c "import json; print(json.load(open('${CONFIG_FILE}')).get('schedule_hours',${BACKUP_SCHEDULE_HOURS:-24}))" 2>/dev/null || echo "${BACKUP_SCHEDULE_HOURS:-24}")
    KEEP_COUNT=$(python3 -c "import json; print(json.load(open('${CONFIG_FILE}')).get('keep_count',${BACKUP_KEEP:-30}))" 2>/dev/null || echo "${BACKUP_KEEP:-30}")
  else
    SCHEDULE_HOURS="${BACKUP_SCHEDULE_HOURS:-24}"
    KEEP_COUNT="${BACKUP_KEEP:-30}"
  fi
}

log() { echo "[backup-sidecar] $(date -u '+%Y-%m-%d %H:%M:%S UTC') $*"; }

run_backup() {
  TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
  ARCHIVE="${BACKUP_DIR}/mosaic-backup-${TIMESTAMP}.tar.gz"
  WORK_DIR="$(mktemp -d)"
  START="$(date +%s)"

  log "Starting backup → ${ARCHIVE}"

  # Write in-progress status
  cat > "${STATUS_FILE}" << EOF
{"status":"running","started_at":"$(date -u '+%Y-%m-%dT%H:%M:%SZ')","last_archive":null,"error":null,"schedule_hours":${SCHEDULE_HOURS},"keep_count":${KEEP_COUNT}}
EOF

  # Remove trigger file so we don't re-trigger immediately
  rm -f "${TRIGGER_FILE}"

  # Dump each mounted volume
  dump_volume() {
    local name="$1"
    if [ -d "/volumes/${name}" ] && [ "$(ls -A /volumes/${name} 2>/dev/null)" ]; then
      tar cf "${WORK_DIR}/${name}.tar" -C "/volumes/${name}" . 2>/dev/null && \
        log "  ✓ ${name}" || log "  ✗ ${name} (failed)"
    else
      log "  – ${name} (not mounted or empty — skipping)"
    fi
  }

  dump_volume "mosaic-data"
  dump_volume "superset-db-data"
  dump_volume "n8n-data"
  dump_volume "ciso-data"

  # Manifest
  cat > "${WORK_DIR}/MANIFEST.txt" << EOF
Mosaic Backup
Timestamp: ${TIMESTAMP}
Created:   $(date -u '+%Y-%m-%d %H:%M:%S UTC')
Schedule:  every ${SCHEDULE_HOURS}h, keeping last ${KEEP_COUNT}
EOF

  # Create archive
  mkdir -p "${BACKUP_DIR}"
  tar czf "${ARCHIVE}" -C "${WORK_DIR}" .
  rm -rf "${WORK_DIR}"

  SIZE=$(du -sh "${ARCHIVE}" | cut -f1)
  ELAPSED=$(( $(date +%s) - START ))
  log "✓ Backup complete: $(basename "${ARCHIVE}") (${SIZE}, ${ELAPSED}s)"

  # Prune old backups
  COUNT=$(ls -1 "${BACKUP_DIR}"/mosaic-backup-*.tar.gz 2>/dev/null | wc -l | tr -d ' ')
  if [ "${COUNT}" -gt "${KEEP_COUNT}" ]; then
    ls -1t "${BACKUP_DIR}"/mosaic-backup-*.tar.gz | tail -n +$((KEEP_COUNT + 1)) | xargs rm -f
    log "Pruned $((COUNT - KEEP_COUNT)) old backup(s), keeping ${KEEP_COUNT}"
  fi

  # Get latest for status
  LATEST=$(ls -1t "${BACKUP_DIR}"/mosaic-backup-*.tar.gz 2>/dev/null | head -1 || echo "")
  LATEST_NAME=$(basename "${LATEST}" 2>/dev/null || echo "")
  LATEST_SIZE=$([ -f "${LATEST}" ] && du -sh "${LATEST}" | cut -f1 || echo "0")
  TOTAL=$(ls -1 "${BACKUP_DIR}"/mosaic-backup-*.tar.gz 2>/dev/null | wc -l | tr -d ' ')
  NEXT_AT=$(date -u -d "+${SCHEDULE_HOURS} hours" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u '+%Y-%m-%dT%H:%M:%SZ')

  cat > "${STATUS_FILE}" << EOF
{"status":"ok","last_backup_at":"$(date -u '+%Y-%m-%dT%H:%M:%SZ')","last_archive":"${LATEST_NAME}","archive_size":"${LATEST_SIZE}","total_archives":${TOTAL},"duration_seconds":${ELAPSED},"next_backup_at":"${NEXT_AT}","error":null,"schedule_hours":${SCHEDULE_HOURS},"keep_count":${KEEP_COUNT}}
EOF
}

# ── Main loop ─────────────────────────────────────────────────────────────────
read_config
log "Mosaic backup sidecar started. Schedule: every ${SCHEDULE_HOURS}h. Keeping last ${KEEP_COUNT}."

# Run immediately on first start
run_backup || {
  log "✗ Initial backup failed"
  cat > "${STATUS_FILE}" << EOF
{"status":"error","last_backup_at":null,"last_archive":null,"error":"Backup failed on startup — check sidecar logs","schedule_hours":${SCHEDULE_HOURS},"keep_count":${KEEP_COUNT}}
EOF
}

# Main loop — sleep in 10s increments to catch trigger files quickly
ELAPSED_SINCE=0
while true; do
  sleep 10
  ELAPSED_SINCE=$((ELAPSED_SINCE + 10))

  # Re-read config on every loop iteration (picks up UI changes)
  read_config

  # Check for on-demand trigger from UI
  if [ -f "${TRIGGER_FILE}" ]; then
    log "On-demand trigger detected — running backup now"
    run_backup || log "✗ On-demand backup failed"
    ELAPSED_SINCE=0
    continue
  fi

  # Check if scheduled interval has elapsed
  SCHEDULE_SECS=$((SCHEDULE_HOURS * 3600))
  if [ "${ELAPSED_SINCE}" -ge "${SCHEDULE_SECS}" ]; then
    log "Scheduled backup starting (${SCHEDULE_HOURS}h interval)"
    run_backup || log "✗ Scheduled backup failed"
    ELAPSED_SINCE=0
  fi
done
