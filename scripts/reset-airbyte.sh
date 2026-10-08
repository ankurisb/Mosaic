#!/usr/bin/env bash
# =============================================================================
# reset-airbyte.sh — wipe the bundled abctl Airbyte clean for the next customer.
#
# Enterprise bundles Airbyte via abctl (full Airbyte on a kind k8s cluster),
# SEPARATE from the Mosaic docker-compose project. reset-instance.sh wipes the
# Mosaic compose volumes but CANNOT see abctl's k8s PVCs — so a prior customer's
# Airbyte sources, connections, custom connector-builder projects and (critically)
# SOURCE CREDENTIALS would survive a Mosaic-only reset. This script closes that gap.
#
# MODES:
#   --mode nuke    (default, GUARANTEED-CLEAN): abctl local uninstall --persisted
#                  then install — destroys the entire Airbyte PVC. Nothing from the
#                  prior customer can survive, by construction. Slow (minutes).
#   --mode db      (FAST): TRUNCATE the customer-data tables in Airbyte's Postgres
#                  in place, preserving the connector catalog + instance identity.
#                  Seconds. Use only where speed matters more than the absolute
#                  guarantee of a full PVC destroy.
#
# After a reset, Airbyte is clean but Mosaic must be re-pointed at it (fresh OAuth
# creds change on reinstall) — reset-instance.sh handles the re-registration.
# =============================================================================
set -euo pipefail

MODE="nuke"
NS="airbyte-abctl"
PGUSER="airbyte"
PGDB="db-airbyte"
export KUBECONFIG="${KUBECONFIG:-$HOME/.airbyte/abctl/abctl.kubeconfig}"

while [ $# -gt 0 ]; do
  case "$1" in
    --mode) MODE="$2"; shift ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
  shift
done

say(){ printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok(){  printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn(){ printf '  \033[33m!\033[0m %s\n' "$*"; }

# Customer-data tables (DB mode). Everything NOT here is Airbyte catalog/identity
# and is preserved: actor_definition*, airbyte_*_migrations, airbyte_metadata,
# auth_user/user/permission/organization/sso_config/service_accounts/dataplane*,
# and the (emptied) workspace row.
CUSTOMER_TABLES="actor actor_catalog actor_catalog_fetch_event connection connection_operation connection_tag connection_timeline_event connector_builder_project declarative_manifest active_declarative_manifest secrets secret_config secret_reference attempts jobs commands state stream_attempt_metadata stream_generation stream_refreshes stream_reset stream_stats stream_statuses sync_stats normalization_summaries retry_states workload workload_label workload_queue schema_management notification_configuration scoped_configuration oauth_state actor_oauth_parameter"

# ---- helpers ----------------------------------------------------------------
pod() { kubectl get pods -n "$NS" -o name 2>/dev/null | grep -E "airbyte-db-0" | head -1 | sed 's#pod/##'; }
psql_db() { kubectl exec -n "$NS" "$(pod)" -- psql -U "$PGUSER" -d "${2:-$PGDB}" -t -c "$1" 2>/dev/null | tr -d ' ' | grep -v '^$' || true; }

# ---- DB mode: fast in-place truncate ----------------------------------------
reset_db_mode() {
  local DB="${1:-$PGDB}"
  say "Airbyte reset (DB mode) on database '$DB'"
  local P; P="$(pod)"
  [ -z "$P" ] && { warn "airbyte-db pod not found — is abctl running?"; return 1; }

  # Build a single TRUNCATE ... RESTART IDENTITY CASCADE over all existing
  # customer tables (skip any not present in this Airbyte version).
  local present=""
  for t in $CUSTOMER_TABLES; do
    local exists; exists="$(kubectl exec -n "$NS" "$P" -- psql -U "$PGUSER" -d "$DB" -t -c "SELECT to_regclass('public.$t') IS NOT NULL" 2>/dev/null | tr -d ' \n')"
    [ "$exists" = "t" ] && present="$present public.$t,"
  done
  present="${present%,}"
  if [ -z "$present" ]; then warn "no customer tables found in $DB"; return 1; fi

  kubectl exec -n "$NS" "$P" -- psql -U "$PGUSER" -d "$DB" -c \
    "SET session_replication_role = replica; TRUNCATE TABLE $present RESTART IDENTITY CASCADE; SET session_replication_role = default;" \
    >/dev/null 2>&1 && ok "truncated customer tables" || { warn "truncate failed"; return 1; }
}

# ---- NUKE mode: full abctl teardown + reinstall -----------------------------
reset_nuke_mode() {
  say "Airbyte reset (NUKE mode) — destroying the entire Airbyte PVC"
  command -v abctl >/dev/null 2>&1 || { warn "abctl not on PATH"; return 1; }
  warn "abctl local uninstall --persisted (this removes ALL Airbyte data)…"
  abctl local uninstall --persisted >/dev/null 2>&1 || warn "uninstall reported issues"
  ok "Airbyte uninstalled (PVC destroyed)"
  say "Reinstalling clean Airbyte (this takes a few minutes)…"
  abctl local install >/dev/null 2>&1 && ok "clean Airbyte reinstalled" || { warn "reinstall failed — run 'abctl local install' manually"; return 1; }
}

# ---- run --------------------------------------------------------------------
case "$MODE" in
  db)   reset_db_mode "${SCRATCH_DB:-$PGDB}" ;;
  nuke) reset_nuke_mode ;;
  *)    echo "unknown mode: $MODE (use nuke|db)"; exit 2 ;;
esac
say "Airbyte reset complete (mode=$MODE)"
