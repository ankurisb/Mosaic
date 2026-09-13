// services/licensing/src/server.js
// Mosaic Licensing Service. Deploy to Railway (needs DATABASE_URL, LICENSE_PRIVATE_KEY,
// LICENSE_PUBLIC_KEY, ADMIN_TOKEN). Endpoints:
//   POST /license/validate   — the Mosaic client phone-home (public, rate-limited)
//   POST /admin/customers    — create a customer            (admin)
//   POST /admin/licenses     — issue a license (returns key)(admin)
//   POST /admin/licenses/:id — update seats/status/expiry   (admin)
//   GET  /admin/licenses     — list                         (admin)
//   GET  /healthz            — liveness
const http = require('http')
const crypto = require('crypto')
const { pool, initSchema, audit } = require('./db')
const { signLicense, verifyLicense, keyHash } = require('./license-crypto')

const PRIVATE_KEY = (process.env.LICENSE_PRIVATE_KEY || '').replace(/\\n/g, '\n')
const PUBLIC_KEY  = (process.env.LICENSE_PUBLIC_KEY  || '').replace(/\\n/g, '\n')
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || ''

// --- tiny helpers -----------------------------------------------------------
function send(res, status, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) })
  res.end(body)
}
function readBody(req, res, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    // Reject early on a declared oversized Content-Length. Respond 413 with
    // Connection: close and drain the incoming stream so the socket ends cleanly
    // (destroying it mid-request corrupts a keep-alive connection -> EPIPE on the
    // next request).
    const finish413 = () => {
      const body = JSON.stringify({ error: 'body too large' })
      if (!res.headersSent) res.writeHead(413, { 'Content-Type': 'application/json', 'Connection': 'close', 'Content-Length': Buffer.byteLength(body) })
      res.end(body)
      req.resume() // drain remaining bytes without buffering
      reject(new Error('__handled__'))
    }
    const declared = Number(req.headers['content-length'] || 0)
    if (declared > maxBytes) return finish413()
    let data = '', total = 0, done = false
    req.on('data', c => {
      if (done) return
      total += c.length
      if (total > maxBytes) { done = true; return finish413() }
      data += c
    })
    req.on('end', () => { if (done) return; try { resolve(data ? JSON.parse(data) : {}) } catch { reject(new Error('invalid json')) } })
    req.on('error', e => { if (!done) reject(e) })
  })
}
// Constant-time admin check (avoids timing attacks on the token).
function isAdmin(req) {
  const h = req.headers['authorization'] || ''
  const tok = h.startsWith('Bearer ') ? h.slice(7) : ''
  if (!ADMIN_TOKEN || !tok || tok.length !== ADMIN_TOKEN.length) return false
  return crypto.timingSafeEqual(Buffer.from(tok), Buffer.from(ADMIN_TOKEN))
}

// --- naive per-IP rate limit for the public validate endpoint ---------------
const hits = new Map()
function rateLimited(ip) {
  const now = Date.now(), win = 60_000, max = 120
  const rec = hits.get(ip) || { n: 0, t: now }
  if (now - rec.t > win) { rec.n = 0; rec.t = now }
  rec.n++; hits.set(ip, rec)
  return rec.n > max
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (now - v.t > 120_000) hits.delete(k) }, 120_000).unref()

// --- the phone-home: authoritative live validation --------------------------
async function handleValidate(req, res, body) {
  const key = String(body.key || '')
  // 1. Signature check first — a forged/tampered key never touches the DB.
  const payload = verifyLicense(key, PUBLIC_KEY)
  if (!payload) return send(res, 200, { valid: false, reason: 'invalid_signature' })

  // 2. Look up the live record by hash.
  const { rows } = await pool.query('SELECT * FROM licenses WHERE key_hash = $1', [keyHash(key)])
  const lic = rows[0]
  if (!lic) return send(res, 200, { valid: false, reason: 'unknown_license' })

  // 3. Status / expiry (DB is authoritative).
  if (lic.status !== 'active') return send(res, 200, { valid: false, reason: lic.status, edition: lic.edition })
  const expired = lic.expires_at && new Date(lic.expires_at).getTime() < Date.now()
  if (expired) return send(res, 200, { valid: false, reason: 'expired', edition: lic.edition, expires_at: lic.expires_at })

  // 4. Seats — SOFT by default: report over-limit, don't invalidate.
  const activeSeats = Number.isFinite(body.active_seats) ? Math.max(0, Math.floor(body.active_seats)) : 0
  const seatsOk = lic.seat_limit <= 0 /* 0 = unlimited */ ? true : activeSeats <= lic.seat_limit

  // 5. Record usage (best-effort) + reply.
  pool.query('INSERT INTO seat_usage (license_id, active_seats, fingerprint, app_version) VALUES ($1,$2,$3,$4)',
    [lic.id, activeSeats, String(body.fingerprint || '').slice(0, 128), String(body.app_version || '').slice(0, 32)]).catch(() => {})

  return send(res, 200, {
    valid: true,
    edition: lic.edition,
    seat_limit: lic.seat_limit,
    active_seats: activeSeats,
    seats_ok: seatsOk,
    expires_at: lic.expires_at,
    grace_days: lic.grace_days,
  })
}

// --- admin: issue a license -------------------------------------------------
async function handleIssue(req, res, body) {
  const customerId = String(body.customer_id || '')
  const edition = ['personal', 'enterprise'].includes(body.edition) ? body.edition : 'enterprise'
  const seatLimit = Number.isFinite(body.seat_limit) ? Math.floor(body.seat_limit) : 5
  const graceDays = Number.isFinite(body.grace_days) ? Math.floor(body.grace_days) : 14
  const expiresAt = body.expires_at ? new Date(body.expires_at) : null
  if (!customerId) return send(res, 400, { error: 'customer_id required' })

  const licId = crypto.randomUUID()
  const now = Math.floor(Date.now() / 1000)
  const key = signLicense({
    cid: licId, edition, seats: seatLimit,
    exp: expiresAt ? Math.floor(expiresAt.getTime() / 1000) : 0,
    iat: now, v: 1,
  }, PRIVATE_KEY)

  await pool.query(
    `INSERT INTO licenses (id, customer_id, key_hash, edition, seat_limit, grace_days, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [licId, customerId, keyHash(key), edition, seatLimit, graceDays, expiresAt])
  await audit(licId, 'issue', { edition, seatLimit, expiresAt }, 'admin')

  // The raw key is returned ONCE here — we only store its hash, so it can't be
  // recovered later. Copy it now.
  return send(res, 200, { id: licId, key, edition, seat_limit: seatLimit, expires_at: expiresAt })
}

// --- admin: update seats / status / expiry (NO reissue needed) ---------------
async function handleUpdate(req, res, id, body) {
  const fields = [], vals = []
  if (Number.isFinite(body.seat_limit)) { fields.push(`seat_limit=$${fields.length + 1}`); vals.push(Math.floor(body.seat_limit)) }
  if (['active', 'revoked', 'suspended'].includes(body.status)) { fields.push(`status=$${fields.length + 1}`); vals.push(body.status) }
  if (body.expires_at !== undefined) { fields.push(`expires_at=$${fields.length + 1}`); vals.push(body.expires_at ? new Date(body.expires_at) : null) }
  if (Number.isFinite(body.grace_days)) { fields.push(`grace_days=$${fields.length + 1}`); vals.push(Math.floor(body.grace_days)) }
  if (!fields.length) return send(res, 400, { error: 'nothing to update' })
  fields.push(`updated_at=now()`)
  vals.push(id)
  const { rowCount } = await pool.query(`UPDATE licenses SET ${fields.join(', ')} WHERE id=$${vals.length}`, vals)
  if (!rowCount) return send(res, 404, { error: 'license not found' })
  await audit(id, 'update', body, 'admin')
  return send(res, 200, { ok: true, id })
}

// --- router -----------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim()
  const url = new URL(req.url, 'http://localhost')
  try {
    if (req.method === 'GET' && url.pathname === '/healthz') return send(res, 200, { ok: true })

    if (req.method === 'POST' && url.pathname === '/license/validate') {
      if (rateLimited(ip)) return send(res, 429, { valid: false, reason: 'rate_limited' })
      const body = await readBody(req, res)
      return handleValidate(req, res, body)
    }

    // Everything under /admin requires the admin token.
    if (url.pathname.startsWith('/admin/')) {
      if (!isAdmin(req)) return send(res, 401, { error: 'unauthorized' })

      if (req.method === 'POST' && url.pathname === '/admin/customers') {
        const b = await readBody(req, res)
        if (!b.name) return send(res, 400, { error: 'name required' })
        const { rows } = await pool.query('INSERT INTO customers (name, email) VALUES ($1,$2) RETURNING id', [b.name, b.email || null])
        return send(res, 200, { id: rows[0].id })
      }
      if (req.method === 'POST' && url.pathname === '/admin/licenses') return handleIssue(req, res, await readBody(req, res))
      if (req.method === 'GET'  && url.pathname === '/admin/licenses') {
        const { rows } = await pool.query(`SELECT l.id, l.customer_id, c.name AS customer, l.edition, l.seat_limit, l.status, l.expires_at, l.grace_days,
          (SELECT active_seats FROM seat_usage s WHERE s.license_id=l.id ORDER BY reported_at DESC LIMIT 1) AS last_seats,
          (SELECT reported_at FROM seat_usage s WHERE s.license_id=l.id ORDER BY reported_at DESC LIMIT 1) AS last_seen
          FROM licenses l JOIN customers c ON c.id=l.customer_id ORDER BY l.created_at DESC`)
        return send(res, 200, { licenses: rows })
      }
      const m = url.pathname.match(/^\/admin\/licenses\/([^/]+)$/)
      if (req.method === 'POST' && m) return handleUpdate(req, res, m[1], await readBody(req, res))
    }

    return send(res, 404, { error: 'not found' })
  } catch (e) {
    // readBody already sent a 413 for oversized bodies — don't double-respond.
    if (e && e.message === '__handled__') return
    if (res.headersSent) return
    return send(res, 400, { error: String(e.message || e).slice(0, 200) })
  }
})

async function start() {
  if (!PRIVATE_KEY || !PUBLIC_KEY) { console.error('FATAL: LICENSE_PRIVATE_KEY / LICENSE_PUBLIC_KEY not set'); process.exit(1) }
  if (!ADMIN_TOKEN || ADMIN_TOKEN.length < 24) { console.error('FATAL: ADMIN_TOKEN missing or too short (>=24 chars)'); process.exit(1) }
  await initSchema()
  const port = process.env.PORT || 8080
  server.listen(port, () => console.log(`licensing service on :${port}`))
}
if (require.main === module) start()
module.exports = { server }
