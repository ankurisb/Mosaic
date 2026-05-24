# Mosaic — Installation Guide

This guide is written for the IT administrator installing Mosaic on a Linux or macOS server.
No prior experience with Docker or Next.js is required.
Estimated time: 20–30 minutes on a server with a working internet connection.

---

## Before you start

### What you need

- A server (physical or VM) running **Linux (Ubuntu 20.04+ recommended) or macOS 12+**
- **8 GB RAM minimum** — 16 GB recommended for production
- **20 GB free disk space** (Docker images total ~5–7 GB on first pull)
- Internet access from the server (outbound HTTPS to `api.anthropic.com` and Docker registries)
- An **Anthropic API key** — get one at [console.anthropic.com](https://console.anthropic.com) → API Keys → Create key

> **Restricted networks:** If the server is behind a firewall or proxy, see [NETWORK.md](NETWORK.md) first.
> Share it with your network team before starting.

### Install Docker

**Linux (Ubuntu/Debian):**
```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
docker compose version   # should print 2.x.x
```

**macOS:**
Download [Docker Desktop](https://www.docker.com/products/docker-desktop/) and install it.
Then: Docker Desktop → Settings → Resources → Memory → set to **8 GB** → Apply & Restart.

Verify:
```bash
docker --version          # Docker version 24.x or later
docker compose version    # Docker Compose version 2.x or later
```

---

## Step 1 — Get the code

```bash
git clone https://github.com/ankurisb/Mosaic.git
cd Mosaic
```

> No `git`? Download the ZIP from GitHub → Code → Download ZIP, then extract it.

---

## Step 2 — Run the installer

```bash
bash install.sh
```

The installer will ask you for:

1. **Anthropic API key** — paste your key (starts with `sk-ant-`)
2. **Admin name** — your name or "Admin"
3. **Admin email** — the email you'll use to log in
4. **Admin password** — minimum 8 characters
5. **Organisation name** — used in compliance documents
6. **SSO with Keycloak?** — answer `n` unless you need AD/LDAP integration (you can add it later)
7. **Tavily web search key** — optional; press Enter to skip (can be added in Settings → API Keys later)

The installer generates all cryptographic secrets automatically.
It creates a `.env` file with everything Mosaic needs.

> After the installer finishes, it prints:
> *"Your secrets are stored in .env — back it up somewhere safe."*
> Do this now. See [SECRETS.md](SECRETS.md) for what each secret does.

---

## Step 3 — Start Mosaic

```bash
docker compose up -d
```

This pulls all Docker images and starts the full Mosaic stack.
**The first run takes 5–15 minutes** depending on your internet speed — it's downloading ~5–7 GB of images.

Watch progress:
```bash
docker compose logs -f mosaic
```

Wait until you see:
```
mosaic  | ▲ Next.js 15.x
mosaic  | - Local: http://localhost:3001
mosaic  | ✓ Ready in Xs
```

Then open **http://localhost:3001** in a browser.

> If the server is remote, replace `localhost` with the server's IP address.

---

## Step 4 — Log in and verify

1. Open **http://your-server:3001**
2. Log in with the admin email and password you set in the installer
3. You should see the Mosaic chat interface

Follow [docs/FIRST_STEPS.md](FIRST_STEPS.md) to verify your installation is working correctly and connect your first data source.

---

## Services and ports

After `docker compose up -d`, the following services are running:

| Service | Port | Access |
|---|---|---|
| **Mosaic** | **3001** | Main application — share this with your users |
| CISO Assistant (GRC) | 8443 | Governance and compliance platform |
| Superset (analytics) | 8088 | Accessed via Mosaic dashboards — not usually accessed directly |
| Airbyte (data sync) | 8000 | Internal use only — Mosaic manages it |
| n8n (workflow automation) | 5678 | Internal use only |
| OpenMeter (usage metering) | 10000 | Internal admin only |
| Keycloak (SSO) | 8080 | Only if you enabled SSO during install |

Only port **3001** needs to be accessible to end users.
All other ports can remain firewalled from external access.

---

## CISO Assistant setup (GRC / ISO 27001)

CISO Assistant is the governance documentation layer that runs alongside Mosaic.

1. Open **http://your-server:8443**
2. Log in with `CISO_SUPERUSER_EMAIL` / `CISO_SUPERUSER_PASSWORD` from your `.env` file
3. Wait 60–90 seconds on first load — the backend initialises on startup
4. **Library → Browse** → search "ISO 27001" → **Load**
5. **Compliance → New Audit** → select ISO 27001 → name your assessment
6. For controls Mosaic handles automatically (A.8.15, A.8.24, A.5.15): mark as "Implemented", evidence note: "Automated — verified via Mosaic compliance panel"

> **Credentials only apply on first run.** If you need to change the CISO Assistant password, do it inside CISO Assistant, not in `.env`.

---

## Enabling SSO (optional, enterprise)

If your organisation uses Active Directory or LDAP, you can enable enterprise SSO after installation.

1. In your `.env` file, uncomment and set:
   ```
   SSO_ENABLED=true
   COMPOSE_PROFILES=sso
   KEYCLOAK_ADMIN_PASSWORD=<strong-password>
   ```
2. Restart: `docker compose up -d`
3. Follow [KEYCLOAK.md](KEYCLOAK.md) to configure the realm and connect AD/LDAP

---

## Resource requirements

| Component | RAM | Disk |
|---|---|---|
| Mosaic core | 512 MB | 1 GB |
| Superset | 1 GB | 2 GB |
| CISO Assistant | 512 MB | 1 GB |
| Airbyte | 2 GB | 2 GB |
| Elasticsearch | 1 GB | 5 GB |
| Other services | 1 GB | 1 GB |
| **Total minimum** | **8 GB** | **20 GB** |

For production with active users, 16 GB RAM and 50 GB disk is recommended.

---

## Firewall / server hardening

If this server is accessible from the internet or your wider corporate network:

```bash
# Allow only Mosaic port from your internal network
ufw allow from 10.0.0.0/8 to any port 3001
ufw allow from 192.168.0.0/16 to any port 3001

# Block all other external access to internal service ports
ufw deny 8000 8088 8080 5678 10000 8443
ufw enable
```

Adjust the IP ranges to match your network.

---

## Troubleshooting

**Mosaic doesn't start — "port already in use"**
```bash
lsof -ti:3001 | xargs kill -9   # free port 3001
docker compose up -d
```

**Out of memory — services keep restarting**
Increase Docker Desktop RAM: Docker Desktop → Settings → Resources → Memory → 10 GB → Apply & Restart.
On Linux: `docker compose up -d` again after adding RAM.

**CISO Assistant shows blank page**
Normal on first run — wait 90 seconds. Watch: `docker compose logs -f ciso-backend`

**Mosaic starts but AI doesn't respond**
Your Anthropic API key may be invalid or not yet active. Go to **Settings → API Keys** and re-enter it.

**Everything stopped after a server reboot**
Docker containers don't restart automatically unless configured to. Add to `docker-compose.yml` or run:
```bash
cd /path/to/Mosaic
docker compose up -d
```
To start automatically on boot (Linux):
```bash
sudo systemctl enable docker
# Then ensure docker compose up -d is in your startup scripts, or use a systemd service
```

**Need more help?**
Run `docker compose logs -f` and share the output with support.

---

## Next steps

- [FIRST_STEPS.md](FIRST_STEPS.md) — verify everything works, connect your first data source
- [SECRETS.md](SECRETS.md) — understand and back up your credentials
- [UPDATING.md](UPDATING.md) — how to apply future updates
- [NETWORK.md](NETWORK.md) — firewall requirements to share with IT/security
