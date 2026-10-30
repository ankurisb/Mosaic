#!/usr/bin/env bash
# ============================================================
# Mosaic test-data harness control
# ------------------------------------------------------------
# Starts / stops / inspects the optional demo data estate defined in
# docker-compose.demo.yml (Postgres, MySQL, SQL Server, InfluxDB, MongoDB,
# Elasticsearch, SFTP, S3/MinIO). Images are mirrored to GHCR, so this pulls
# from the same registry Mosaic itself uses — no Docker Hub / air-gap issues.
#
# After `on`, register the sources in Mosaic: Settings → Data sources →
# "Add test harness" (admin). They turn green once the containers are healthy.
#
# Usage:
#   ./scripts/mosaic-harness.sh on       # start the harness (~3 GB RAM)
#   ./scripts/mosaic-harness.sh off      # stop it (keeps seeded data)
#   ./scripts/mosaic-harness.sh off -v   # stop it and wipe seeded volumes
#   ./scripts/mosaic-harness.sh status   # show container status
# ============================================================
set -euo pipefail

# Run from the install root (where docker-compose.yml lives). In the repo the
# script sits in scripts/; on an installed host it sits next to the compose.
cd "$(dirname "$0")"
[ -f docker-compose.yml ] || cd ..
if [ ! -f docker-compose.yml ] || [ ! -f docker-compose.demo.yml ]; then
  echo "error: run this from the Mosaic install root (docker-compose.yml + docker-compose.demo.yml must be present)." >&2
  exit 1
fi

FILES=(-f docker-compose.yml)
[ -f docker-compose.override.yml ] && FILES+=(-f docker-compose.override.yml)
FILES+=(-f docker-compose.demo.yml)
PROFILE=(--profile demo)

# Explicit service list so `up` never reconciles the main stack.
# NOTE: minio / minio-seed are intentionally omitted — MinIO gated its upstream
# image distribution in 2025, so the S3 source image isn't mirrored yet (see the
# MinIO note in docker-compose.demo.yml). The other 7 sources start cleanly.
SERVICES=(postgres mysql mssql mssql-seed influxdb influxdb-seed mongodb \
          sftp elasticsearch elasticsearch-seed mock-sap-api)

cmd="${1:-}"; shift || true
case "$cmd" in
  on|up|start)
    echo "Starting the Mosaic test-data harness (demo profile)…"
    docker compose "${FILES[@]}" "${PROFILE[@]}" up -d "${SERVICES[@]}"
    echo "Done. Now register them in Mosaic: Settings → Data sources → Add test harness."
    ;;
  off|down|stop)
    echo "Stopping the Mosaic test-data harness…"
    docker compose "${FILES[@]}" "${PROFILE[@]}" down "$@"
    ;;
  status|ps)
    docker compose "${FILES[@]}" "${PROFILE[@]}" ps
    ;;
  *)
    echo "usage: $(basename "$0") {on|off|status}   (off -v also wipes seeded data)" >&2
    exit 2
    ;;
esac
