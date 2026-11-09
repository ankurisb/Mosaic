# MCP sidecars (self-hosted MCP servers)

How Mosaic connects to **self-hosted MCP servers** that ship as a container and hold their own
backend credentials (e.g. the ThingsBoard MCP server). This is the operational pattern behind the
**Settings → Data sources → MCP servers** tab.

## Model

MCP separates the **message layer** (JSON-RPC: `initialize` / `tools/list` / `tools/call`) from the
**transport**, and the server — not the client — is the credential boundary:

- **Mosaic is the MCP client.** It stores only *where* the server is (endpoint URL) plus an optional
  bearer token that authenticates Mosaic **to the MCP server**, not to the backend.
- **The MCP server holds the backend credentials.** A ThingsBoard MCP server authenticates to
  ThingsBoard with *its own* env (`THINGSBOARD_USERNAME`/`PASSWORD` or `THINGSBOARD_API_KEY`).

So backend credentials never go into Mosaic's MCP form — they live in the sidecar's env file.

### Which servers need a sidecar?

| Server shape | Needs a sidecar? | How Mosaic connects |
|---|---|---|
| Remote **Streamable HTTP** (hosted URL) | No | Enter the URL in the MCP tab (transport `http`) |
| Remote **HTTP+SSE** (hosted `/sse` URL) | No | Enter the `/sse` URL (transport `sse`) |
| **stdio** server (`npx`/`node` launcher present on the host) | No — runs as a subprocess | Enter the launch command (transport `stdio`) |
| **Self-hosted container** holding backend creds (ThingsBoard, etc.) | **Yes** | Run it as a sidecar; point Mosaic at its SSE URL |

Mosaic's MCP client supports all three transports (`lib/tools.ts`), so the first three are already
"enter it and go". This doc covers the fourth.

## The pattern (box-managed via compose)

Sidecars are declared in `docker-compose.override.yml` on the box (the same file that holds `cube`/
`cubestore`) — *not* the repo compose, so image releases never clobber them. `deploy.sh` only runs
`docker compose up -d mosaic`, so sidecars are unaffected by Mosaic redeploys; their
`restart: unless-stopped` keeps them up across reboots.

```yaml
# docker-compose.override.yml  (on the box)
services:
  # ... mosaic / cube / cubestore ...

  # --- MCP sidecars ---
  tb-mcp:
    image: thingsboard/mcp
    container_name: tb-mcp          # Mosaic addresses it by this name
    restart: unless-stopped
    env_file:
      - ./tb-mcp.env                # secrets live here (chmod 600, git-ignored)
    networks:
      - mosaic-net                  # same network as mosaic → reachable by name
```

Then in **Mosaic → MCP servers → Add**: transport **HTTP + SSE**, endpoint
`http://tb-mcp:8000/sse`.

> The endpoint is addressed by container name on `mosaic-net` (a private `172.x` IP). Mosaic's MCP
> SSRF check runs in `lan` mode, which allows private IPs but still blocks loopback and
> cloud-metadata — so use the container name, **not** `localhost`.

### ThingsBoard sidecar env (`tb-mcp.env`)

See `tb-mcp.env.example`. SSE mode plus **one** auth method; use a **Tenant Administrator** account
(sysadmin owns no device data). TB 4.3+ can use `THINGSBOARD_API_KEY` instead of user/password.

## Adding another MCP sidecar

1. Create its env file on the box: `~/mosaic/<name>.env` (`chmod 600`), with its backend creds.
2. Copy the `tb-mcp` block in `docker-compose.override.yml`; change `name` / `image` / `env_file`.
3. `docker compose up -d <name>`
4. In Mosaic → MCP servers → Add: the server's SSE (or HTTP) URL, e.g. `http://<name>:<port>/sse`.

## Gotcha: restart vs recreate

`docker restart` does **not** re-read `env_file`. After editing a sidecar's env, run
`docker compose up -d <name>` (compose detects the change and **recreates** the container). A plain
`docker restart` silently keeps the old environment.

## Roadmap

This pattern is reproducible and auditable but still per-server shell config. A first-class in-app
flow — where the MCP tab collects a known server's backend credentials (encrypted at rest like DB/
API connections) and provisions the sidecar — would remove the shell step entirely. Not yet built.
