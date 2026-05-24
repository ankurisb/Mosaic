#!/bin/bash
# ============================================================
# Mosaic Installer
# Generates .env from .env.example with interactive prompts.
# Usage: bash install.sh
# ============================================================
set -e

BLUE='\033[0;34m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'; BOLD='\033[1m'

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║         Mosaic Installation              ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════╝${NC}"
echo ""

# ── Preflight checks ─────────────────────────────────────────
echo -e "${BLUE}Checking requirements...${NC}"
for cmd in docker openssl; do
  if ! command -v $cmd &>/dev/null; then
    echo -e "${RED}✗ $cmd not found. Please install it and re-run.${NC}"; exit 1
  fi
done
if ! docker compose version &>/dev/null 2>&1; then
  echo -e "${RED}✗ Docker Compose not found. Please install Docker Desktop and re-run.${NC}"; exit 1
fi
echo -e "${GREEN}✓ Docker and Docker Compose found${NC}"
echo ""

# ── Check if .env already exists ─────────────────────────────
if [[ -f .env ]]; then
  echo -e "${YELLOW}⚠ .env already exists.${NC}"
  read -p "  Overwrite? This will reset all settings. (y/N): " overwrite
  [[ "$overwrite" != "y" && "$overwrite" != "Y" ]] && echo "Aborted." && exit 0
fi

# ── Copy template ─────────────────────────────────────────────
cp .env.example .env
echo -e "${GREEN}✓ .env created from .env.example${NC}"

# ── Generate secrets ─────────────────────────────────────────
echo ""
echo -e "${BLUE}Generating secrets...${NC}"
AUTH_SECRET=$(openssl rand -hex 32)
CRON_SECRET=$(openssl rand -hex 32)
SUPERSET_SECRET=$(openssl rand -hex 32)
sed -i.bak "s|AUTH_SECRET=replace-with-openssl-rand-hex-32|AUTH_SECRET=$AUTH_SECRET|" .env
sed -i.bak "s|CRON_SECRET=replace-with-openssl-rand-hex-32|CRON_SECRET=$CRON_SECRET|" .env
sed -i.bak "s|SUPERSET_SECRET_KEY=replace-with-openssl-rand-hex-32|SUPERSET_SECRET_KEY=$SUPERSET_SECRET|" .env
rm -f .env.bak
echo -e "${GREEN}✓ Secrets generated${NC}"

# ── Required: Anthropic key ───────────────────────────────────
echo ""
echo -e "${BOLD}Required: Anthropic API key${NC}"
echo "  Get one at https://console.anthropic.com"
read -p "  ANTHROPIC_API_KEY: " anthropic_key
if [[ -n "$anthropic_key" ]]; then
  sed -i.bak "s|ANTHROPIC_API_KEY=sk-ant-api03-...|ANTHROPIC_API_KEY=$anthropic_key|" .env
  rm -f .env.bak
  echo -e "${GREEN}  ✓ Saved${NC}"
else
  echo -e "${YELLOW}  ⚠ Skipped — add this in Settings → API Keys after first run${NC}"
fi

# ── Required: Admin account ───────────────────────────────────
echo ""
echo -e "${BOLD}Admin account${NC}"
read -p "  Admin name [Admin]: " admin_name
admin_name=${admin_name:-Admin}
read -p "  Admin email [admin@mosaic.local]: " admin_email
admin_email=${admin_email:-admin@mosaic.local}
read -s -p "  Admin password (min 8 chars): " admin_pass
echo ""
while [[ ${#admin_pass} -lt 8 ]]; do
  echo -e "${RED}  Password must be at least 8 characters.${NC}"
  read -s -p "  Admin password: " admin_pass; echo ""
done
sed -i.bak "s|ADMIN_NAME=Your Name|ADMIN_NAME=$admin_name|" .env
sed -i.bak "s|ADMIN_EMAIL=admin@yourcompany.com|ADMIN_EMAIL=$admin_email|" .env
sed -i.bak "s|ADMIN_PASSWORD=choose-a-strong-password|ADMIN_PASSWORD=$admin_pass|" .env
sed -i.bak "s|SUPERSET_ADMIN_PASSWORD=same-as-admin-password|SUPERSET_ADMIN_PASSWORD=$admin_pass|" .env
# CISO Assistant uses the same admin account by default
sed -i.bak "s|CISO_SUPERUSER_EMAIL=admin@yourcompany.com|CISO_SUPERUSER_EMAIL=$admin_email|" .env
sed -i.bak "s|CISO_SUPERUSER_PASSWORD=choose-a-strong-password|CISO_SUPERUSER_PASSWORD=$admin_pass|" .env
rm -f .env.bak
echo -e "${GREEN}  ✓ Admin account configured${NC}"

# ── Organisation name ─────────────────────────────────────────
echo ""
echo -e "${BOLD}Organisation name${NC} (used in compliance documents)"
read -p "  Organisation [UGX Systems Pvt Ltd]: " org_name
org_name=${org_name:-UGX Systems Pvt Ltd}
echo "ORG_NAME=$org_name" >> .env
echo -e "${GREEN}  ✓ Saved${NC}"

# ── Optional: SSO / Keycloak ──────────────────────────────────
echo ""
echo -e "${BOLD}Single Sign-On (Keycloak)${NC}"
echo "  Enables enterprise AD/LDAP federation."
echo "  Adds ~500MB to the Docker image pull. Can be enabled later."
read -p "  Enable SSO with Keycloak? (y/N): " enable_sso

if [[ "$enable_sso" == "y" || "$enable_sso" == "Y" ]]; then
  read -s -p "  Keycloak admin password [admin]: " kc_pass
  echo ""
  kc_pass=${kc_pass:-admin}

  # Uncomment SSO vars and set values
  sed -i.bak "s|# SSO_ENABLED=true|SSO_ENABLED=true|" .env
  sed -i.bak "s|# COMPOSE_PROFILES=sso|COMPOSE_PROFILES=sso|" .env
  sed -i.bak "s|# KEYCLOAK_URL=http://keycloak:8080|KEYCLOAK_URL=http://keycloak:8080|" .env
  sed -i.bak "s|# KEYCLOAK_ADMIN=admin|KEYCLOAK_ADMIN=admin|" .env
  sed -i.bak "s|# KEYCLOAK_ADMIN_PASSWORD=change-me-before-production|KEYCLOAK_ADMIN_PASSWORD=$kc_pass|" .env
  rm -f .env.bak

  echo -e "${GREEN}  ✓ Keycloak will start automatically with Mosaic${NC}"
  echo -e "  After first start: open http://localhost:8080 and follow KEYCLOAK.md"
  SSO_ENABLED=true
else
  echo -e "  Skipped — enable later by editing .env and uncommenting the SSO lines"
  SSO_ENABLED=false
fi

# ── Optional: Tavily ─────────────────────────────────────────
echo ""
echo -e "${BOLD}Optional: Tavily web search key${NC}"
echo "  Enables AI to search the web. Get one at https://tavily.com"
read -p "  TAVILY_API_KEY (or press Enter to skip): " tavily_key
if [[ -n "$tavily_key" ]]; then
  sed -i.bak "s|TAVILY_API_KEY=tvly-...|TAVILY_API_KEY=$tavily_key|" .env
  rm -f .env.bak
  echo -e "${GREEN}  ✓ Saved${NC}"
fi

# ── Summary ───────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║         Setup Complete                   ║${NC}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Admin: ${BOLD}$admin_email${NC}"
echo -e "  SSO:   ${BOLD}$([ "$SSO_ENABLED" = true ] && echo "Keycloak enabled" || echo "Disabled (email/password only)")${NC}"
echo ""
echo -e "${BLUE}To start Mosaic:${NC}"
echo -e "  ${BOLD}docker compose up -d${NC}"
echo ""
echo -e "${BLUE}Then open:${NC} http://localhost:3001"
echo ""
echo -e "${YELLOW}Your secrets are stored in .env — back it up somewhere safe.${NC}"
echo -e "See ${BOLD}SECRETS.md${NC} for what each secret does and how to rotate them."
echo ""
if [[ "$SSO_ENABLED" = true ]]; then
  echo -e "${YELLOW}Keycloak admin:${NC} http://localhost:8080 (admin / $kc_pass)"
  echo -e "Follow ${BOLD}KEYCLOAK.md${NC} to set up your realm and connect AD/LDAP."
  echo ""
fi
