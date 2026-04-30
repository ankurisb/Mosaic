#!/bin/bash
set -e

echo "[superset-init] Running db upgrade..."
superset db upgrade

echo "[superset-init] Creating admin user..."
superset fab create-admin \
  --username "${ADMIN_USERNAME:-admin}" \
  --firstname "${ADMIN_FIRSTNAME:-Mosaic}" \
  --lastname "${ADMIN_LASTNAME:-Admin}" \
  --email "${ADMIN_EMAIL:-admin@mosaic.local}" \
  --password "${ADMIN_PASSWORD:-Admin1234!}" 2>/dev/null || true

echo "[superset-init] Running superset init..."
superset init

echo "[superset-init] Starting Superset..."
superset run -p 8088 -h 0.0.0.0 --with-threads --reload --debugger
