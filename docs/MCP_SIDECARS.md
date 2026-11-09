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

## Managed servers (in-app provisioning)

The compose pattern above is the **manual** path — still available as *Add custom connection*. For
catalogued servers there is now a first-class flow: **MCP servers → Add managed server → pick a
server → enter credentials → Provision**. Mosaic starts the sidecar and registers the connection;
no shell, env files, or compose edits.

### How it works

```
browser ──POST /api/mcp-connections {action:'provision'}──▶ Mosaic (unprivileged)
                                                              │  encrypts creds (env_enc)
                                                              ▼
                                            POST /provision  mcp-manager (holds docker.sock)
                                                              │  docker create+start, labelled
                                                              ▼
                                                        <sidecar container> on mosaic-net
          Mosaic connection.endpoint_url = http://<sidecar-name>:<port>/sse
```

- **`mcp-manager`** (`mcp-manager/server.mjs`) is a small privileged helper, run as its **own**
  container with `/var/run/docker.sock` mounted. The Mosaic web app never touches Docker; it calls
  the manager over the internal network with a bearer token (`MCP_MANAGER_TOKEN`).
- The manager **fails closed**: it only pulls images on `MCP_ALLOWED_IMAGES`, only manages
  containers it labelled `mosaic.mcp.managed=true`, binds **no** host ports, uses a fixed network
  (`MCP_NETWORK`), and ignores any command / volume / privileged / port-binding in a request.
- **Catalog.** Each managed server is one descriptor in `lib/mcp-catalog.ts` (image, port,
  transport, credential fields). The generic engine renders the form, so adding a server = authoring
  one object **and** adding its image to `MCP_ALLOWED_IMAGES`.
- **Secrets at rest.** The values you enter are encrypted into `mcp_connections.env_enc` (same
  `lib/encrypt.ts` as DB/API secrets), so *Edit → Update & restart* re-provisions without
  re-prompting. Deleting a managed connection stops and removes its sidecar.

### Compose wiring (on the box)

The manager runs from the Mosaic image but as a separate service, added to
`docker-compose.override.yml`:

```yaml
  mcp-manager:
    image: ghcr.io/ankurisb/mosaic:latest     # same image; different entrypoint
    container_name: mcp-manager
    command: ["node", "/app/mcp-manager/server.mjs"]
    restart: unless-stopped
    environment:
      - MCP_MANAGER_TOKEN=${MCP_MANAGER_TOKEN}   # shared secret, ≥16 chars
      - MCP_ALLOWED_IMAGES=thingsboard/mcp
      - MCP_NETWORK=mosaic_mosaic-net
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    networks:
      - mosaic-net
    # NO host ports — only reachable inside the compose network
```

And Mosaic's own service gets `MCP_MANAGER_URL=http://mcp-manager:9100` and the same
`MCP_MANAGER_TOKEN`. When the token is unset, the managed flow is simply hidden/disabled and the
custom path still works.

> **Why a separate container?** Mounting the Docker socket into a container is equivalent to root on
> the host. Keeping it out of the internet-facing web app and inside a tiny, allowlist-only helper
> is the whole point of the split — the blast radius of the socket is one auditable file.
