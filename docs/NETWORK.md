# Mosaic — Network Requirements

This document lists all outbound connections Mosaic and its services make.
Share this with your IT or network security team before deployment.

**Key point: Mosaic requires no inbound ports.** All connections are
outbound-only from the server running Mosaic.

---

## Quick reference — what to whitelist

| Destination | Port | Protocol | Direction | Purpose | Required? |
|---|---|---|---|---|---|
| `api.anthropic.com` | 443 | HTTPS | Outbound | Claude AI API — core Mosaic function | **Required** |
| `ghcr.io`, `*.ghcr.io` | 443 | HTTPS | Outbound | Docker image pulls (Mosaic, CISO Assistant, OpenMeter) | Required on first run & updates |
| `registry-1.docker.io` | 443 | HTTPS | Outbound | Docker Hub image pulls (Superset, Elasticsearch, etc.) | Required on first run & updates |
| `auth.docker.io` | 443 | HTTPS | Outbound | Docker Hub authentication | Required on first run & updates |
| `production.cloudflare.docker.com` | 443 | HTTPS | Outbound | Docker image layer CDN | Required on first run & updates |
| `198.41.219.1–10` | 7844 | TCP + UDP | Outbound | Cloudflare Tunnel control plane (remote support) | Required for support sessions only |
| `*.trycloudflare.com` | 443 | HTTPS | Outbound | Cloudflare ephemeral tunnel URLs (remote support) | Required for support sessions only |
| `github.com`, `*.github.com` | 443 | HTTPS | Outbound | cloudflared auto-update (disabled — safe to block) | Optional |

---

## Service-by-service breakdown

### Mosaic core
- **`api.anthropic.com` — TCP 443**
  Claude AI API. Every chat message, RCA, and tool call goes here.
  This is the only connection required for day-to-day Mosaic operation.

### Docker image registry (first run and updates only)
Mosaic and all its services are distributed as Docker images. These
connections are only needed when images are first pulled or updated.
Once running, no registry connections are made.

- **`ghcr.io` / `*.ghcr.io` — TCP 443**
  GitHub Container Registry. Used by: Mosaic, CISO Assistant
  (ciso-backend, ciso-frontend), OpenMeter.

- **`registry-1.docker.io` / `auth.docker.io` — TCP 443**
  Docker Hub. Used by: Superset, Elasticsearch, Redis, PostgreSQL,
  Redpanda, ClickHouse, Caddy, n8n, Keycloak, Alpine.

- **`production.cloudflare.docker.com` — TCP 443**
  Docker's CDN for image layer distribution.

### Remote support (Cloudflare Tunnel) — only active during support sessions
These connections are only made when an admin explicitly starts a
remote support session from **Settings → Remote Support**. The tunnel
is dormant at all other times.

- **`198.41.219.1` through `198.41.219.10` — TCP/UDP 7844**
  Cloudflare Tunnel control plane. The `cloudflared` daemon connects
  here to establish the outbound tunnel.
  Source: [Cloudflare official firewall docs](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/deploy-tunnels/tunnel-with-firewall/)

  If your firewall supports domain-based rules instead of IPs:
  - `region1.v2.argotunnel.com`
  - `region2.v2.argotunnel.com`

- **`*.trycloudflare.com` — TCP 443**
  The ephemeral public URL generated for each support session
  (e.g. `https://random-words.trycloudflare.com`).
  Customers share this URL with the support team — support accesses
  it from outside; no connection needed from the customer's server.

- **`github.com` — TCP 443** *(optional — safe to block)*
  Used by `cloudflared` to check for software updates. Disabled with
  `--no-autoupdate` in Mosaic's configuration, so this can be blocked
  with no impact.

### All other services — internal only
The following services communicate exclusively within the Docker
internal network (`mosaic-net`) and make no outbound internet
connections after their images are pulled:

- Superset, Superset DB (PostgreSQL), Redis
- Elasticsearch
- OpenMeter, Redpanda, ClickHouse, OpenMeter PostgreSQL
- CISO Assistant backend + frontend + Caddy proxy
- n8n (unless you configure workflows that call external APIs)
- Keycloak (unless federating with an external IdP)
- Stats sidecar
- Watchdog (reads Docker socket only — no network)

---

## Proxy environments

If your server accesses the internet through an HTTP proxy, set these
environment variables in your `.env.local` before starting Mosaic:

```
HTTP_PROXY=http://your-proxy:port
HTTPS_PROXY=http://your-proxy:port
NO_PROXY=localhost,127.0.0.1,mosaic-net
```

For `cloudflared` specifically, the tunnel manager inherits these
automatically from the Docker environment.

---

## Air-gapped / fully isolated deployments

If the server has no internet access at all:

1. Pull all Docker images on a machine with internet access
2. Export them: `docker save mosaic-mosaic | gzip > mosaic.tar.gz`
3. Transfer and load: `docker load < mosaic.tar.gz`
4. Remote support (Cloudflare Tunnel) will not be available — use
   `mosaic-doctor.sh` and the watchdog (`http://localhost:3099`)
   for local diagnostics, and share the support bundle manually.

For the AI layer in air-gapped deployments, contact support about
using a locally-hosted LLM instead of the Anthropic API.

---

*Source for Cloudflare Tunnel IPs: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/deploy-tunnels/tunnel-with-firewall/*
*Last reviewed: May 2026*
