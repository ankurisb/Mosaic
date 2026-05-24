#!/bin/bash
# ============================================================
# Mosaic Doctor — Step-by-step diagnostics
# Run this when Mosaic isn't loading.
# Usage: bash mosaic-doctor.sh
# Output is also saved to mosaic-doctor-<timestamp>.log
# ============================================================

BLUE='\033[0;34m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'; DIM='\033[2m'

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
LOG_FILE="mosaic-doctor-${TIMESTAMP}.log"
ISSUES=0
WARNINGS=0

# Tee all output to log file
exec > >(tee -a "$LOG_FILE") 2>&1

pass()    { echo -e "  ${GREEN}✓${NC} $1"; }
fail()    { echo -e "  ${RED}✗${NC} $1"; ISSUES=$((ISSUES+1)); }
warn()    { echo -e "  ${YELLOW}⚠${NC} $1"; WARNINGS=$((WARNINGS+1)); }
info()    { echo -e "  ${DIM}→${NC} $1"; }
section() { echo ""; echo -e "${BOLD}$1${NC}"; echo "  $(printf '%.0s─' {1..44})"; }
fix()     { echo -e "  ${BLUE}Fix:${NC} $1"; }

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║           Mosaic Doctor  🔍                  ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════╝${NC}"
echo -e "  $(date)"
echo -e "  Log: ${DIM}$LOG_FILE${NC}"

# ── Step 1: OS & Resources ────────────────────────────────────
section "Step 1 — System resources"

OS=$(uname -s)
ARCH=$(uname -m)
pass "OS: $OS ($ARCH)"

# Disk space — need at least 5GB free
if command -v df &>/dev/null; then
  # Works on Linux and macOS
  FREE_KB=$(df -k . | awk 'NR==2 {print $4}')
  FREE_GB=$((FREE_KB / 1024 / 1024))
  TOTAL_KB=$(df -k . | awk 'NR==2 {print $2}')
  TOTAL_GB=$((TOTAL_KB / 1024 / 1024))
  if [[ $FREE_GB -lt 2 ]]; then
    fail "Disk: ${FREE_GB}GB free of ${TOTAL_GB}GB — critically low"
    fix "Free up space: docker system prune -a"
  elif [[ $FREE_GB -lt 5 ]]; then
    warn "Disk: ${FREE_GB}GB free of ${TOTAL_GB}GB — getting low"
    info "Recommended minimum: 5GB free"
  else
    pass "Disk: ${FREE_GB}GB free of ${TOTAL_GB}GB"
  fi
fi

# Memory
if [[ "$OS" == "Linux" ]]; then
  FREE_MEM=$(awk '/MemAvailable/ {printf "%d", $2/1024}' /proc/meminfo)
  TOTAL_MEM=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo)
  if [[ $FREE_MEM -lt 512 ]]; then
    fail "Memory: ${FREE_MEM}MB free of ${TOTAL_MEM}MB — critically low"
    fix "Stop other applications or add more RAM"
  elif [[ $FREE_MEM -lt 1024 ]]; then
    warn "Memory: ${FREE_MEM}MB free of ${TOTAL_MEM}MB — low"
  else
    pass "Memory: ${FREE_MEM}MB free of ${TOTAL_MEM}MB"
  fi
elif [[ "$OS" == "Darwin" ]]; then
  # macOS — best-effort
  FREE_MEM=$(vm_stat | awk '/Pages free/ {printf "%d", $3 * 4096 / 1048576}' | tr -d '.')
  pass "Memory check: run Activity Monitor for details on macOS"
fi

# ── Step 2: Docker ────────────────────────────────────────────
section "Step 2 — Docker"

if ! command -v docker &>/dev/null; then
  fail "Docker not found in PATH"
  fix "Install Docker Desktop from https://docker.com/products/docker-desktop"
  echo ""; echo -e "${RED}Cannot continue without Docker. Exiting.${NC}"
  echo ""; echo -e "Log saved to: ${BOLD}$LOG_FILE${NC}"; exit 1
fi
pass "Docker binary found: $(docker --version 2>/dev/null | head -1)"

# Is the Docker daemon running?
if ! docker info &>/dev/null 2>&1; then
  fail "Docker daemon is not running"
  if [[ "$OS" == "Linux" ]]; then
    fix "sudo systemctl start docker"
    info "Check why it stopped: sudo journalctl -u docker --since '10 minutes ago'"
  else
    fix "Open Docker Desktop and wait for it to start"
  fi
  echo ""; echo -e "${RED}Cannot continue without Docker daemon. Exiting.${NC}"
  echo ""; echo -e "Log saved to: ${BOLD}$LOG_FILE${NC}"; exit 1
fi
pass "Docker daemon is running"

# Docker Compose
if ! docker compose version &>/dev/null 2>&1; then
  fail "Docker Compose not found"
  fix "Update Docker Desktop to the latest version"
  echo ""; echo -e "Log saved to: ${BOLD}$LOG_FILE${NC}"; exit 1
fi
pass "Docker Compose: $(docker compose version --short 2>/dev/null)"

# Docker resources (Linux only via cgroups)
DOCKER_INFO=$(docker info 2>/dev/null)
DOCKER_MEMORY=$(echo "$DOCKER_INFO" | grep "Total Memory" | awk '{print $3, $4}')
[[ -n "$DOCKER_MEMORY" ]] && pass "Docker memory limit: $DOCKER_MEMORY"

# ── Step 3: Mosaic project directory ─────────────────────────
section "Step 3 — Mosaic project files"

# Find docker-compose.yml
if [[ ! -f "docker-compose.yml" ]]; then
  fail "docker-compose.yml not found in current directory"
  fix "cd to your Mosaic folder first, then run this script again"
  echo ""; echo -e "Log saved to: ${BOLD}$LOG_FILE${NC}"; exit 1
fi
pass "docker-compose.yml found"

# .env file
if [[ ! -f ".env" ]] && [[ ! -f ".env.local" ]]; then
  fail "No .env or .env.local file found"
  fix "Run: bash install.sh"
else
  ENV_FILE=".env.local"
  [[ ! -f ".env.local" ]] && ENV_FILE=".env"
  pass "Environment file found: $ENV_FILE"

  # Check critical keys are set (names only — never log values)
  for key in ANTHROPIC_API_KEY AUTH_SECRET SUPERSET_SECRET_KEY ADMIN_EMAIL ADMIN_PASSWORD; do
    val=$(grep "^${key}=" "$ENV_FILE" 2>/dev/null | cut -d'=' -f2-)
    if [[ -z "$val" || "$val" == *"replace-with"* || "$val" == *"choose-a"* || "$val" == *"sk-ant-api03-..."* ]]; then
      fail "Missing or unset: $key"
      fix "Edit $ENV_FILE and set $key"
    else
      pass "$key is set"
    fi
  done
fi

# ── Step 4: Container states ──────────────────────────────────
section "Step 4 — Container states"

# Core containers we always expect running
CORE_CONTAINERS=(
  "mosaic:3001:/api/health"
  "superset:8088:/health"
  "mosaic-elasticsearch:9200:/_cluster/health"
  "ciso-backend:8000:/api/schema/"
  "ciso-caddy:8443:"
)

# Infrastructure containers (supporting — don't check HTTP)
INFRA_CONTAINERS=(
  "superset-db"
  "superset-redis"
  "mosaic-openmeter"
  "mosaic-openmeter-postgres"
  "mosaic-openmeter-redpanda"
  "mosaic-openmeter-clickhouse"
)

# Optional containers — warn if missing, don't count as failure
OPTIONAL_CONTAINERS=(
  "mosaic-stats"
  "mosaic-n8n"
)

for entry in "${CORE_CONTAINERS[@]}"; do
  name="${entry%%:*}"
  rest="${entry#*:}"
  STATE=$(docker inspect "$name" --format '{{.State.Status}}' 2>/dev/null)
  HEALTH=$(docker inspect "$name" --format '{{.State.Health.Status}}' 2>/dev/null)

  if [[ -z "$STATE" ]]; then
    fail "$name — not found (never started or removed)"
    fix "docker compose up -d $name"
  elif [[ "$STATE" != "running" ]]; then
    fail "$name — $STATE"
    EXIT_CODE=$(docker inspect "$name" --format '{{.State.ExitCode}}' 2>/dev/null)
    LAST_ERR=$(docker logs "$name" --tail 3 2>/dev/null | tail -3)
    info "Exit code: $EXIT_CODE"
    [[ -n "$LAST_ERR" ]] && info "Last log: $LAST_ERR"
    fix "docker compose up -d $name"
    fix "docker logs $name --tail 20  (to see full error)"
  elif [[ "$HEALTH" == "unhealthy" ]]; then
    fail "$name — running but unhealthy"
    LAST_ERR=$(docker logs "$name" --tail 3 2>/dev/null | tail -3)
    [[ -n "$LAST_ERR" ]] && info "Last log: $LAST_ERR"
    fix "docker compose restart $name"
  elif [[ "$HEALTH" == "healthy" ]]; then
    pass "$name — healthy"
  elif [[ "$HEALTH" == "starting" ]]; then
    warn "$name — still starting up (wait 60s and re-run)"
  else
    pass "$name — running"
  fi
done

for name in "${INFRA_CONTAINERS[@]}"; do
  STATE=$(docker inspect "$name" --format '{{.State.Status}}' 2>/dev/null)
  HEALTH=$(docker inspect "$name" --format '{{.State.Health.Status}}' 2>/dev/null)
  if [[ -z "$STATE" ]]; then
    warn "$name — not found"
  elif [[ "$STATE" != "running" ]]; then
    fail "$name — $STATE"
    fix "docker compose up -d $name"
  elif [[ "$HEALTH" == "unhealthy" ]]; then
    warn "$name — unhealthy"
  else
    pass "$name — running"
  fi
done

for name in "${OPTIONAL_CONTAINERS[@]}"; do
  STATE=$(docker inspect "$name" --format '{{.State.Status}}' 2>/dev/null)
  if [[ -z "$STATE" ]]; then
    info "$name — not running (optional service)"
  elif [[ "$STATE" != "running" ]]; then
    warn "$name — $STATE (optional)"
  else
    pass "$name — running (optional)"
  fi
done

# ── Step 5: Port availability ─────────────────────────────────
section "Step 5 — Port availability"

PORTS=(3001 8088 8443 3099)
LABELS=("Mosaic" "Superset" "CISO Assistant" "Watchdog")

for i in "${!PORTS[@]}"; do
  port="${PORTS[$i]}"
  label="${LABELS[$i]}"
  # Check if port is in use
  if command -v lsof &>/dev/null; then
    OCCUPANT=$(lsof -iTCP:$port -sTCP:LISTEN -n -P 2>/dev/null | awk 'NR==2 {print $1, "PID:"$2}')
  elif command -v ss &>/dev/null; then
    OCCUPANT=$(ss -tlnp 2>/dev/null | grep ":$port " | head -1)
  fi
  if [[ -n "$OCCUPANT" ]]; then
    pass "Port $port ($label) — in use by: $OCCUPANT"
  else
    warn "Port $port ($label) — nothing listening (service may be down)"
  fi
done

# ── Step 6: Connectivity between containers ───────────────────
section "Step 6 — Internal connectivity"

# Only run if mosaic container is up
MOSAIC_STATE=$(docker inspect mosaic --format '{{.State.Status}}' 2>/dev/null)
if [[ "$MOSAIC_STATE" == "running" ]]; then
  # Test mosaic → superset
  SC=$(docker exec mosaic wget -qO- --timeout=5 http://superset:8088/health 2>/dev/null | head -c 20)
  if [[ "$SC" == *"OK"* ]] || [[ "$SC" == *"ok"* ]]; then
    pass "mosaic → superset: reachable"
  else
    fail "mosaic → superset: unreachable"
    fix "Check both containers are on mosaic-net: docker network inspect mosaic_mosaic-net"
  fi

  # Test mosaic → elasticsearch (internal hostname is 'elasticsearch')
  SC=$(docker exec mosaic wget -qO- --timeout=5 http://elasticsearch:9200/_cluster/health 2>/dev/null | head -c 100)
  if [[ "$SC" == *"status"* ]]; then
    pass "mosaic → elasticsearch: reachable"
  else
    fail "mosaic → elasticsearch: unreachable"
    fix "docker compose up -d elasticsearch"
  fi

  # Test mosaic → ciso-backend
  SC=$(docker exec mosaic wget -qO- --timeout=5 http://ciso-backend:8000/api/schema/ 2>/dev/null | wc -c)
  if [[ "$SC" -gt 100 ]]; then
    pass "mosaic → ciso-backend: reachable"
  else
    fail "mosaic → ciso-backend: unreachable"
    fix "docker compose up -d ciso-backend"
  fi
else
  warn "Skipping connectivity checks — mosaic container is not running"
fi

# ── Step 7: Recent errors ─────────────────────────────────────
section "Step 7 — Recent errors (last 5 minutes)"

SINCE="5m"
for name in mosaic superset ciso-backend; do
  STATE=$(docker inspect "$name" --format '{{.State.Status}}' 2>/dev/null)
  [[ "$STATE" != "running" ]] && continue
  # Filter known benign noise: CISO Assistant OpenAPI schema warnings are not real errors
  ERRORS=$(docker logs "$name" --since "$SINCE" 2>&1 \
    | grep -iE "error|fatal|exception|failed|panic" \
    | grep -v "^#" \
    | grep -v "unable to guess serializer" \
    | grep -v "exception raised while getting serializer" \
    | grep -v "could not derive type of path parameter" \
    | grep -v "could not resolve serializer" \
    | grep -v "unable to resolve type hint" \
    | grep -v "Failed to obtain model through view" \
    | grep -v "could not resolve field on model" \
    | grep -v "Non-fatal error" \
    | grep -iE "^[^W]" \
    | tail -5)
  if [[ -n "$ERRORS" ]]; then
    warn "$name has recent errors:"
    while IFS= read -r line; do
      info "  $line"
    done <<< "$ERRORS"
  else
    pass "$name — no errors in last $SINCE"
  fi
done

# ── Summary ───────────────────────────────────────────────────
echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════╗${NC}"

if [[ $ISSUES -eq 0 && $WARNINGS -eq 0 ]]; then
  echo -e "${GREEN}${BOLD}║  All checks passed ✓                         ║${NC}"
  echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "  Everything looks healthy. If Mosaic still isn't loading,"
  echo -e "  try opening ${BOLD}http://localhost:3099${NC} for the watchdog view,"
  echo -e "  or contact support with this log file."
elif [[ $ISSUES -eq 0 ]]; then
  echo -e "${YELLOW}${BOLD}║  $WARNINGS warning(s), no critical issues               ║${NC}"
  echo -e "${YELLOW}${BOLD}╚══════════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "  Mosaic should be running. If it isn't, wait 60 seconds"
  echo -e "  for services to finish starting, then try again."
else
  echo -e "${RED}${BOLD}║  $ISSUES issue(s) found — see fixes above            ║${NC}"
  echo -e "${RED}${BOLD}╚══════════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "  Fix the issues above in order, then re-run this script."
  echo -e "  If you're stuck, send ${BOLD}$LOG_FILE${NC} to Mosaic support."
fi

echo ""
echo -e "  Log saved to: ${BOLD}$LOG_FILE${NC}"
echo ""
