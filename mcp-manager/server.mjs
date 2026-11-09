// mcp-manager — a small, privileged helper that provisions MCP sidecar containers on behalf of the
// (unprivileged) Mosaic web app. It is the ONLY component with the Docker socket mounted, so the
// attack surface is deliberately tiny and auditable:
//
//   * It listens only on the internal mosaic network (no host port), and every request must carry a
//     shared bearer token (MCP_MANAGER_TOKEN), compared in constant time.
//   * It can only create containers whose image is on an explicit allowlist (MCP_ALLOWED_IMAGES).
//   * It only ever starts containers on the fixed MCP_NETWORK, labelled `mosaic.mcp.managed=true`.
//   * It will only stop/remove/recreate containers that carry that label — it can never touch the
//     mosaic app, the database, or anything it did not itself create.
//   * The HTTP API exposes fixed operations only (provision / remove / status) — there is no
//     command, volume, bind-mount, privileged, or host-network field a caller can set.
//
// It talks to Docker through the raw Engine API over /var/run/docker.sock using only Node built-ins
// (http, crypto) — no dependencies — so the exact Docker calls it makes are visible here.

import http from 'node:http'
import crypto from 'node:crypto'

const PORT = parseInt(process.env.MCP_MANAGER_PORT || '9100', 10)
const TOKEN = process.env.MCP_MANAGER_TOKEN || ''
const NETWORK = process.env.MCP_NETWORK || 'mosaic_mosaic-net'
const SOCKET = process.env.DOCKER_SOCKET || '/var/run/docker.sock'
const MANAGED_LABEL = 'mosaic.mcp.managed'
// Allowlist of images this manager may run, e.g. "thingsboard/mcp,ghcr.io/acme/foo-mcp". A bare
// repo matches any tag of it. Empty = nothing allowed (fail closed).
const ALLOWED = (process.env.MCP_ALLOWED_IMAGES || '').split(',').map(s => s.trim()).filter(Boolean)

if (!TOKEN || TOKEN.length < 16) { console.error('mcp-manager: MCP_MANAGER_TOKEN missing or too short; refusing to start'); process.exit(1) }

function timingSafeEq(a, b) {
  const ab = Buffer.from(a || ''), bb = Buffer.from(b || '')
  if (ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}
function imageAllowed(image) {
  const name = String(image || '')
  const bare = name.split('@')[0].replace(/:[^/]+$/, '') // strip :tag and @digest
  return ALLOWED.some(a => { const ab = a.split('@')[0].replace(/:[^/]+$/, ''); return name === a || bare === ab })
}
// Container/sidecar names Mosaic may ask for: DNS-safe, so they double as the hostname on the net.
function validName(n) { return typeof n === 'string' && /^[a-z0-9][a-z0-9_-]{1,62}$/.test(n) }

// --- raw Docker Engine API over the unix socket (unversioned paths use the daemon default) --------
function docker(method, path, body, { stream = false } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body != null ? Buffer.from(JSON.stringify(body)) : null
    const req = http.request({ socketPath: SOCKET, method, path, headers: {
      'Content-Type': 'application/json', ...(payload ? { 'Content-Length': payload.length } : {}),
    } }, res => {
      const chunks = []
      res.on('data', c => { chunks.push(c); if (!stream && Buffer.concat(chunks).length > 8_000_000) { req.destroy(); reject(new Error('docker response too large')) } })
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve({ status: res.statusCode || 0, text })
      })
    })
    req.on('error', reject)
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('docker request timed out')) })
    if (payload) req.write(payload)
    req.end()
  })
}
async function dockerJson(method, path, body) {
  const r = await docker(method, path, body)
  let data = null; try { data = r.text ? JSON.parse(r.text) : null } catch { /* non-JSON */ }
  return { status: r.status, data, text: r.text }
}

// Pull an image if not already present (streams layer progress; we just wait for the stream to end).
async function ensureImage(image) {
  const insp = await docker('GET', `/images/${encodeURIComponent(image)}/json`)
  if (insp.status === 200) return
  const tag = image.includes(':') && !image.endsWith('/') ? image.split(':').pop() : 'latest'
  const fromImage = image.replace(/:[^/]+$/, '')
  const r = await docker('POST', `/images/create?fromImage=${encodeURIComponent(fromImage)}&tag=${encodeURIComponent(tag)}`, null, { stream: true })
  if (r.status >= 400) throw new Error(`image pull failed (HTTP ${r.status})`)
}

async function inspect(name) {
  const r = await dockerJson('GET', `/containers/${encodeURIComponent(name)}/json`)
  return r.status === 200 ? r.data : null
}
function isManaged(info) { return !!(info && info.Config && info.Config.Labels && info.Config.Labels[MANAGED_LABEL] === 'true') }

async function removeIfManaged(name) {
  const info = await inspect(name)
  if (!info) return { removed: false }
  if (!isManaged(info)) throw new Error(`refusing to touch "${name}": not a Mosaic-managed container`)
  await docker('POST', `/containers/${encodeURIComponent(name)}/stop?t=5`)
  await docker('DELETE', `/containers/${encodeURIComponent(name)}?force=true`)
  return { removed: true }
}

// Create + start a sidecar. Idempotent: an existing managed container of the same name is recreated.
async function provision({ name, image, env, port }) {
  if (!validName(name)) throw new Error('invalid sidecar name')
  if (!imageAllowed(image)) throw new Error(`image "${image}" is not on the manager allowlist`)
  if (env && typeof env !== 'object') throw new Error('env must be an object')
  await removeIfManaged(name)          // recreate-safe
  await ensureImage(image)
  const Env = Object.entries(env || {}).map(([k, v]) => `${k}=${String(v)}`)
  const body = {
    Image: image,
    Env,
    Labels: { [MANAGED_LABEL]: 'true', 'mosaic.mcp.port': String(port || '') },
    HostConfig: {
      NetworkMode: NETWORK,                       // fixed network; no host networking
      RestartPolicy: { Name: 'unless-stopped' },  // survive reboots without the manager
      // Deliberately NO Binds / Mounts / Privileged / CapAdd / PortBindings — a sidecar gets no host
      // filesystem, no extra capabilities, and no published host ports.
    },
  }
  const created = await dockerJson('POST', `/containers/create?name=${encodeURIComponent(name)}`, body)
  if (created.status >= 400) throw new Error(`create failed (HTTP ${created.status}): ${created.data?.message || created.text}`)
  const id = created.data.Id
  const started = await docker('POST', `/containers/${id}/start`)
  if (started.status >= 400) throw new Error(`start failed (HTTP ${started.status})`)
  return { ok: true, id, name }
}

async function status(name) {
  const info = await inspect(name)
  if (!info) return { exists: false }
  const logs = await docker('GET', `/containers/${encodeURIComponent(name)}/logs?stdout=true&stderr=true&tail=20`)
  // Docker multiplexes logs with an 8-byte header per frame; strip non-printables for a readable tail.
  const tail = (logs.text || '').replace(/[\x00-\x08\x0e-\x1f]/g, '').split('\n').slice(-20).join('\n')
  return { exists: true, managed: isManaged(info), running: !!info.State?.Running, status: info.State?.Status, startedAt: info.State?.StartedAt, logTail: tail }
}

// --- HTTP API ------------------------------------------------------------------------------------
function send(res, code, obj) { const b = JSON.stringify(obj); res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) }); res.end(b) }
function readBody(req) { return new Promise((resolve) => { let d = ''; req.on('data', c => { d += c; if (d.length > 1_000_000) req.destroy() }); req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}) } catch { resolve(null) } }) }) }

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://mcp-manager')
    if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { ok: true, allowed: ALLOWED.length, network: NETWORK })
    // Auth on everything else.
    const auth = req.headers['authorization'] || ''
    const tok = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    if (!timingSafeEq(tok, TOKEN)) return send(res, 401, { error: 'unauthorized' })

    if (req.method === 'POST' && url.pathname === '/provision') {
      const body = await readBody(req); if (!body) return send(res, 400, { error: 'bad json' })
      const out = await provision(body); return send(res, 200, out)
    }
    if (req.method === 'POST' && url.pathname === '/remove') {
      const body = await readBody(req); if (!body || !validName(body.name)) return send(res, 400, { error: 'invalid name' })
      const out = await removeIfManaged(body.name); return send(res, 200, { ok: true, ...out })
    }
    if (req.method === 'GET' && url.pathname === '/status') {
      const name = url.searchParams.get('name') || ''
      if (!validName(name)) return send(res, 400, { error: 'invalid name' })
      return send(res, 200, await status(name))
    }
    return send(res, 404, { error: 'not found' })
  } catch (e) {
    return send(res, 500, { error: e instanceof Error ? e.message : 'manager error' })
  }
})
server.listen(PORT, () => console.log(`mcp-manager listening on ${PORT}; network=${NETWORK}; allowlist=[${ALLOWED.join(', ')}]`))
