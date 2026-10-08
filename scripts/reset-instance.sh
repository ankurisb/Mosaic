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

# Health check must hit the configured hostname, not plain localhost: when Caddy
# is bound to a real MOSAIC_HOSTNAME with a real cert, https://localhost returns
# nothing (no matching site), so a localhost probe would always fail and stall
# the reset. Resolve the real hostname to loopback so SNI/cert match locally.
MOSAIC_HOST="${MOSAIC_HOSTNAME:-localhost}"
if [ -f "$INSTALL_DIR/.env" ]; then
  _h="$(grep -E '^MOSAIC_HOSTNAME=' "$INSTALL_DIR/.env" 2>/dev/null | head -1 | cut -d= -f2)"
  [ -n "$_h" ] && MOSAIC_HOST="$_h"
fi
health_code() {
  if [ "$MOSAIC_HOST" = "localhost" ]; then
    curl -sk -o /dev/null -w '%{http_code}' --max-time 8 https://localhost/login 2>/dev/null || echo 000
  else
    curl -sk -o /dev/null -w '%{http_code}' --max-time 8 --resolve "${MOSAIC_HOST}:443:127.0.0.1" "https://${MOSAIC_HOST}/login" 2>/dev/null || echo 000
  fi
}

# ---- edition / DB-backend detection -----------------------------------------
# Works for BOTH editions. Personal = SQLite in the mosaic-data volume (default).
# Enterprise = same bundled SQLite UNLESS the operator set DATABASE_URL to an
# external Postgres (e.g. RDS), in which case the Mosaic data lives OUTSIDE these
# volumes and the seed/verify run over Postgres instead of SQLite. We detect the
# live value from the running container so the reset adapts rather than assuming.
detect_backend() {
  DB_URL="$(docker exec mosaic sh -c 'printf %s "${DATABASE_URL:-}"' 2>/dev/null || true)"
  EDITION_LIVE="$(docker exec mosaic sh -c 'printf %s "${MOSAIC_EDITION:-personal}"' 2>/dev/null || echo personal)"
  case "$DB_URL" in
    postgres://*|postgresql://*) DB_BACKEND="postgres" ;;
    *)                           DB_BACKEND="sqlite" ;;
  esac
}

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

# Which compose profiles are active? Reset must bring back exactly what was
# running — otherwise 'down' (which stops ALL profiles) plus a core-only 'up'
# silently leaves Superset/Keycloak/n8n/ES down after a reset. When the caller
# doesn't pin MOSAIC_PROFILES, DETECT the active profiles from the running
# containers BEFORE teardown, so the post-reset stack matches the pre-reset one.
detect_profiles() {
  local running; running="$(docker compose ps --services 2>/dev/null)"
  local p=""
  # bundled: superset / keycloak / n8n / elasticsearch
  echo "$running" | grep -qE '^(superset|keycloak|n8n|elasticsearch)$' && p="$p bundled"
  # metering: any openmeter-*
  echo "$running" | grep -qE 'openmeter' && p="$p metering"
  # ciso: ciso-*
  echo "$running" | grep -qE '^ciso' && p="$p ciso"
  echo "$p" | xargs
}
PROFILES="${MOSAIC_PROFILES:-$(detect_profiles)}"
PROFILE_ARGS=""
for p in $PROFILES; do PROFILE_ARGS="$PROFILE_ARGS --profile $p"; done
[ -n "$PROFILES" ] && echo "  detected active profiles to restore: $PROFILES"

detect_backend
say "Mosaic trial reset — project '$PROJECT' at $INSTALL_DIR"
echo "  Edition: ${EDITION_LIVE:-personal}   DB backend: ${DB_BACKEND:-sqlite}"
if [ "${DB_BACKEND}" = "postgres" ]; then
  echo ""
  warn "This instance uses an EXTERNAL Postgres (DATABASE_URL=postgres://…)."
  warn "Mosaic's data then lives OUTSIDE the local volumes, so destroying volumes"
  warn "ALONE will NOT clean it. The reset will instead TRUNCATE the Postgres"
  warn "schema via the app's own connection. External Postgres is an Enterprise"
  warn "production pattern, not the trial-reuse pattern — confirm this is intended."
  echo ""
fi
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
# Stop EVERY container in the project, across ALL profiles — a service left
# running (e.g. keycloak, in a profile the caller didn't pass) would hold its
# volume open and the wipe would silently leak that customer's data. We enable
# all known profiles for the down, then hard-stop any stragglers by compose label.
say "Stopping ALL project containers (every profile)"
ALL_PROFILES="--profile bundled --profile metering --profile ciso --profile dev"
docker compose $ALL_PROFILES down --remove-orphans >/dev/null 2>&1 || true
# belt-and-braces: force-remove anything still labelled for this compose project
stragglers="$(docker ps -aq --filter "label=com.docker.compose.project=${PROJECT}" 2>/dev/null)"
if [ -n "$stragglers" ]; then
  warn "force-stopping stragglers that survived compose down"
  docker rm -f $stragglers >/dev/null 2>&1 || true
fi
ok "all containers stopped"

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
# Start CORE first (always pullable) so the app is guaranteed to come back even
# if an OPTIONAL profile image is unavailable upstream. Then best-effort start the
# requested profile services with a timeout, so a broken optional image can never
# hang the whole reset (it logs a warning and the trial is still usable).
say "Starting core services"
docker compose up -d mosaic mosaic-caddy mosaic-stats mosaic-watchdog mosaic-backup >/dev/null 2>&1
ok "core started"
if [ -n "$PROFILE_ARGS" ]; then
  say "Starting profile services (best-effort)"
  if command -v timeout >/dev/null 2>&1; then
    timeout 300 docker compose $PROFILE_ARGS up -d >/dev/null 2>&1 \
      && ok "profile services started" \
      || warn "some profile services did not start (optional image may be unavailable) — core trial is unaffected"
  else
    docker compose $PROFILE_ARGS up -d >/dev/null 2>&1 \
      && ok "profile services started" \
      || warn "some profile services did not start — core trial is unaffected"
  fi
fi

say "Waiting for first boot"
for i in $(seq 1 60); do
  code="$(health_code)"
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
  code="$(health_code)"
  [ "$code" = "200" ] && { ok "app healthy (HTTP 200)"; break; }
  sleep 3
  [ "$i" -eq 60 ] && warn "app did not reach healthy in 180s (code=$code)"
done

# ---- 4b. reset bundled abctl Airbyte (separate k8s cluster) ------------------
# The bundled Airbyte runs via abctl in its OWN kind k8s cluster, outside this
# compose project — so the volume wipe above does NOT touch it. Without this, a
# prior customer's Airbyte sources, connections, custom connector-builder
# projects and SOURCE CREDENTIALS would survive. Primary mode is the fast,
# proven in-place truncate; --airbyte-nuke selects the full teardown deep-clean.
# SAFETY: wiping Airbyte destroys real work on a DEV machine. Only auto-run on a
# designated TRIAL host (touch ~/.mosaic-trial-host to mark the AWS box), or when
# explicitly forced with RESET_AIRBYTE=1. Everywhere else it is skipped with a note.
AIRBYTE_OK=0
if [ -f "$HOME/.mosaic-trial-host" ] || [ "${RESET_AIRBYTE:-0}" = "1" ]; then AIRBYTE_OK=1; fi
if [ "$AIRBYTE_OK" = "1" ] && [ "${SKIP_AIRBYTE:-0}" != "1" ] && command -v abctl >/dev/null 2>&1 \
   && kubectl --kubeconfig "${KUBECONFIG:-$HOME/.airbyte/abctl/abctl.kubeconfig}" get ns airbyte-abctl >/dev/null 2>&1; then
  say "Resetting bundled Airbyte (abctl, mode=${AIRBYTE_MODE:-db})"
  bash "$INSTALL_DIR/scripts/reset-airbyte.sh" --mode "${AIRBYTE_MODE:-db}" 2>&1 | sed 's/^/  /' \
    || warn "Airbyte reset reported issues — check it before handing to a customer"
elif [ "$AIRBYTE_OK" != "1" ]; then
  warn "Airbyte reset NOT run — this is not marked a trial host."
  warn "On the AWS trial box: 'touch ~/.mosaic-trial-host' (once) or run with RESET_AIRBYTE=1."
else
  warn "bundled Airbyte (abctl) not detected on this host — skipping"
fi

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
_login_url="https://${MOSAIC_HOST}/api/auth"; _resolve=""
[ "$MOSAIC_HOST" != "localhost" ] && _resolve="--resolve ${MOSAIC_HOST}:443:127.0.0.1"
login_code="$(curl -sk $_resolve -o /dev/null -w '%{http_code}' -X POST "$_login_url" \
  -H 'Content-Type: application/json' \
  -d "{\"action\":\"signin\",\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\"}" 2>/dev/null || echo 000)"
if [ "$login_code" = "200" ]; then ok "login OK (HTTP 200) — instance is demo-ready"
else warn "login returned HTTP $login_code — investigate before handing to a customer"; fi

# ---- 7. re-register bundled Airbyte (AFTER verify, so verify sees a clean 0)
# so the reset box is immediately demo-ready
# The reset wiped the airbyte_instances row (customer data). On a trial host with
# abctl present, fetch its OAuth creds and re-point Mosaic at the clean Airbyte,
# so no manual re-registration is needed before handing the box to a customer.
if [ "$AIRBYTE_OK" = "1" ] && command -v abctl >/dev/null 2>&1; then
  say "Re-registering bundled Airbyte in Mosaic"
  _ab_creds="$(abctl local credentials 2>/dev/null | sed -r 's/\x1b\[[0-9;]*m//g')"
  _ab_cid="$(printf '%s\n' "$_ab_creds" | grep -i 'client-id' | awk '{print $NF}')"
  _ab_sec="$(printf '%s\n' "$_ab_creds" | grep -i 'client-secret' | awk '{print $NF}')"
  _ab_url="${AIRBYTE_MOSAIC_URL:-http://host.docker.internal:8000}"
  if [ -n "$_ab_cid" ] && [ -n "$_ab_sec" ]; then
    docker cp "$INSTALL_DIR/scripts/reset-register-airbyte.cjs" mosaic:/tmp/reset-reg-ab.cjs 2>/dev/null \
      || docker cp "$(dirname "$0")/reset-register-airbyte.cjs" mosaic:/tmp/reset-reg-ab.cjs 2>/dev/null || true
    docker exec -e AB_URL="$_ab_url" -e AB_CLIENT_ID="$_ab_cid" -e AB_CLIENT_SECRET="$_ab_sec" \
      mosaic node /tmp/reset-reg-ab.cjs 2>&1 | sed 's/^/  /' || warn "Airbyte re-registration reported issues"
    docker exec mosaic sh -c 'rm -f /tmp/reset-reg-ab.cjs' 2>/dev/null || true
  else
    warn "could not read abctl credentials — register Airbyte manually in Settings"
  fi
fi

say "RESET COMPLETE"
echo "  URL:   https://${MOSAIC_HOST}"
echo "  Admin: $ADMIN_EMAIL / $ADMIN_PASS"
echo "  Share these with the next customer; have them change the password on first login."
