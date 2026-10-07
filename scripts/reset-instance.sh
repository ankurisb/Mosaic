#!/usr/bin/env bash
# =============================================================================
# reset-instance.sh — wipe a Mosaic trial instance clean for the next customer.
#
# WHY: In the single-tenant "show everything, reset between customers" trial
# model, a soft DB-row delete is NOT safe — a departing customer's connection
# credentials, uploaded files, Airbyte sources, Superset dashboards, n8n flows,
# SSO users and metering data live in SEPARATE service volumes. The only
# provably-clean switch is to destroy every customer-data volume and recreate.
#
# WHAT IT DOES:
#   1. (optional) snapshot the instance to a tarball for UGX's own records
#   2. compose down (stop + remove containers)
#   3. remove every customer-data volume (NOT the Caddy TLS cert volumes)
#   4. compose up, wait healthy
#   5. reseed the built-in sandbox + a fresh admin login
#   6. print a verification report proving nothing from the prior customer
#      survived
#
# Usage:
#   ./reset-instance.sh                 # interactive, asks to confirm
#   ./reset-instance.sh --yes           # no prompt (for automation)
#   ./reset-instance.sh --no-backup     # skip the pre-wipe snapshot
#   ./reset-instance.sh --admin-email you@co.com --admin-pass 'Secret123'
# =============================================================================
set -euo pipefail

INSTALL_DIR="${MOSAIC_DIR:-$HOME/Mosaic}"
PROJECT="mosaic"                       # docker compose project name
ADMIN_EMAIL="${RESET_ADMIN_EMAIL:-trial-admin@ugx.ai}"
ADMIN_PASS="${RESET_ADMIN_PASS:-Mosaic@Trial1}"
DO_BACKUP=1
ASSUME_YES=0

# Volumes that hold CUSTOMER data — these get destroyed.
CUSTOMER_VOLUMES=(
  mosaic-data mosaic-logs mosaic-files
  airbyte-db-data airbyte-workspace
  superset-db-data superset-data
  n8n-data es-data keycloak-data ciso-data
  openmeter-postgres-data openmeter-redpanda-data openmeter-clickhouse-data
)
# Volumes PRESERVED across reset — TLS certs + backup status only (no customer data).
PRESERVE_VOLUMES=( caddy-data caddy-config ciso-caddy-data backup-status )

# ---- arg parsing ------------------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    --yes|-y)        ASSUME_YES=1 ;;
    --no-backup)     DO_BACKUP=0 ;;
    --admin-email)   ADMIN_EMAIL="$2"; shift ;;
    --admin-pass)    ADMIN_PASS="$2"; shift ;;
    --dir)           INSTALL_DIR="$2"; shift ;;
    -h|--help)       sed -n '2,33p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
  shift
done

cd "$INSTALL_DIR" || { echo "FATAL: install dir not found: $INSTALL_DIR" >&2; exit 1; }
say(){ printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok(){  printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn(){ printf '  \033[33m!\033[0m %s\n' "$*"; }

# Which compose profiles are active? Reset whatever is actually deployed.
PROFILES="${MOSAIC_PROFILES:-}"
PROFILE_ARGS=""
for p in $PROFILES; do PROFILE_ARGS="$PROFILE_ARGS --profile $p"; done

say "Mosaic trial reset — project '$PROJECT' at $INSTALL_DIR"
echo "  This will PERMANENTLY DESTROY all current-customer data:"
echo "    Mosaic DB + credentials, uploaded files, Airbyte sources,"
echo "    Superset dashboards, n8n flows, SSO users, metering."
echo "  TLS certificates are preserved (no cert warning for next customer)."

if [ "$ASSUME_YES" -ne 1 ]; then
  printf "\n  Type the word RESET to proceed: "
  read -r confirm
  [ "$confirm" = "RESET" ] || { echo "aborted."; exit 1; }
fi

# ---- 1. optional snapshot for UGX records -----------------------------------
if [ "$DO_BACKUP" -eq 1 ]; then
  say "Snapshotting current instance (for UGX records)"
  TS="$(date +%Y%m%d-%H%M%S)"
  BK="$INSTALL_DIR/trial-archives/reset-$TS"
  mkdir -p "$BK"
  for v in "${CUSTOMER_VOLUMES[@]}"; do
    vol="${PROJECT}_${v}"
    if docker volume inspect "$vol" >/dev/null 2>&1; then
      docker run --rm -v "$vol":/src:ro -v "$BK":/dst alpine \
        sh -c "tar czf /dst/${v}.tgz -C /src . 2>/dev/null" || warn "snapshot $v skipped"
    fi
  done
  ok "snapshot at $BK"
else
  warn "skipping snapshot (--no-backup)"
fi

# ---- 2 & 3. tear down + destroy customer volumes ----------------------------
say "Stopping containers"
docker compose $PROFILE_ARGS down --remove-orphans >/dev/null 2>&1 || true
ok "containers stopped"

say "Destroying customer-data volumes"
for v in "${CUSTOMER_VOLUMES[@]}"; do
  vol="${PROJECT}_${v}"
  if docker volume inspect "$vol" >/dev/null 2>&1; then
    docker volume rm -f "$vol" >/dev/null 2>&1 && ok "removed $vol" || warn "could not remove $vol"
  fi
done
say "Preserved (TLS certs, not customer data)"
for v in "${PRESERVE_VOLUMES[@]}"; do
  vol="${PROJECT}_${v}"
  docker volume inspect "$vol" >/dev/null 2>&1 && ok "kept $vol" || true
done

# ---- 4. bring it back up -----------------------------------------------------
say "Starting fresh instance"
docker compose $PROFILE_ARGS up -d >/dev/null 2>&1
ok "containers started"

say "Waiting for first boot"
for i in $(seq 1 60); do
  code="$(curl -sk -o /dev/null -w '%{http_code}' https://localhost/login 2>/dev/null || echo 000)"
  [ "$code" = "200" ] && break
  sleep 3
done
# The freshly-created mosaic-logs volume is root-owned; the app runs non-root, so
# pino's log writer fails with EACCES and that surfaces as a 500 on otherwise-
# successful requests (e.g. login). Fix perms on the fresh volume, THEN restart
# the app so it reopens the log file with the corrected directory ownership.
say "Fixing fresh-volume log permissions + restarting app"
docker exec -u root mosaic sh -c 'mkdir -p /app/logs && chmod -R 777 /app/logs && chown -R 1000:1000 /app/logs' 2>/dev/null || true
docker restart mosaic >/dev/null 2>&1 || true
for i in $(seq 1 60); do
  code="$(curl -sk -o /dev/null -w '%{http_code}' https://localhost/login 2>/dev/null || echo 000)"
  [ "$code" = "200" ] && { ok "app healthy (HTTP 200)"; break; }
  sleep 3
  [ "$i" -eq 60 ] && warn "app did not reach healthy in 180s (code=$code)"
done

# ---- 5. reseed sandbox + fresh admin ----------------------------------------
say "Seeding sandbox + fresh admin login"
docker cp "$INSTALL_DIR/scripts/reset-seed.cjs" mosaic:/tmp/reset-seed.cjs 2>/dev/null \
  || docker cp "$(dirname "$0")/reset-seed.cjs" mosaic:/tmp/reset-seed.cjs 2>/dev/null || true
docker exec -e SEED_EMAIL="$ADMIN_EMAIL" -e SEED_PASS="$ADMIN_PASS" \
  mosaic node /tmp/reset-seed.cjs 2>&1 | sed 's/^/  /' || warn "seed step reported issues"
docker exec mosaic sh -c 'rm -f /tmp/reset-seed.cjs' 2>/dev/null || true

# ---- 6. verification report -------------------------------------------------
say "VERIFICATION — proving the instance is clean"
docker cp "$INSTALL_DIR/scripts/reset-verify.cjs" mosaic:/tmp/reset-verify.cjs 2>/dev/null \
  || docker cp "$(dirname "$0")/reset-verify.cjs" mosaic:/tmp/reset-verify.cjs 2>/dev/null || true
docker exec mosaic node /tmp/reset-verify.cjs 2>&1 | sed 's/^/  /' || warn "verify step failed"
docker exec mosaic sh -c 'rm -f /tmp/reset-verify.cjs' 2>/dev/null || true

# live login smoke-test — proves the seeded admin can actually authenticate
say "Login smoke-test (seeded admin must authenticate)"
login_code="$(curl -sk -o /dev/null -w '%{http_code}' -X POST https://localhost/api/auth \
  -H 'Content-Type: application/json' \
  -d "{\"action\":\"signin\",\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\"}" 2>/dev/null || echo 000)"
if [ "$login_code" = "200" ]; then ok "login OK (HTTP 200) — instance is demo-ready"
else warn "login returned HTTP $login_code — investigate before handing to a customer"; fi

say "RESET COMPLETE"
echo "  URL:   https://localhost"
echo "  Admin: $ADMIN_EMAIL / $ADMIN_PASS"
echo "  Share these with the next customer; have them change the password on first login."
