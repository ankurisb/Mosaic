// Mosaic Tunnel Manager
// Lightweight HTTP API that manages a cloudflared tunnel process.
// Runs on port 3100 (internal Docker network only — never exposed to host).
//
// Endpoints:
//   POST /start   — start tunnel, returns { ok, url, sessionId, expiresAt }
//   POST /stop    — stop tunnel, returns { ok }
//   GET  /status  — returns { running, url, sessionId, startedAt, expiresAt }
'use strict'
const http = require('http')
const { spawn } = require('child_process')

const PORT = 3100
const TARGET_URL = process.env.TUNNEL_TARGET || 'http://mosaic:3001'
const MAX_SESSION_MS = 4 * 60 * 60 * 1000  // 4 hours hard cap

let tunnelProc = null
let state = {
  running: false,
  url: null,
  sessionId: null,
  startedAt: null,
  expiresAt: null,
  expireTimer: null,
}

function generateSessionId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase()
}

function stopTunnel(reason = 'manual') {
  if (state.expireTimer) { clearTimeout(state.expireTimer); state.expireTimer = null }
  if (tunnelProc) {
    console.log(`[tunnel] stopping — reason: ${reason}`)
    tunnelProc.kill('SIGTERM')
    tunnelProc = null
  }
  state = { running: false, url: null, sessionId: null, startedAt: null, expiresAt: null, expireTimer: null }
}

function startTunnel() {
  return new Promise((resolve, reject) => {
    if (state.running) {
      // Already running — hand back the existing session, flagged so the caller
      // knows this was NOT a new session and shouldn't audit a second "start".
      resolve({
        url: state.url,
        sessionId: state.sessionId,
        startedAt: state.startedAt,
        expiresAt: state.expiresAt,
        alreadyRunning: true,
      })
      return
    }

    console.log(`[tunnel] starting → ${TARGET_URL}`)
    const proc = spawn('cloudflared', [
      'tunnel', '--url', TARGET_URL,
      '--no-autoupdate',
      '--loglevel', 'info',
    ], { stdio: ['ignore', 'pipe', 'pipe'] })

    tunnelProc = proc
    let resolved = false
    let output = ''

    const onData = (chunk) => {
      output += chunk.toString()
      // cloudflared prints the URL in a line like:
      //   INF +----------------------------+
      //   INF |  https://xxx.trycloudflare.com  |
      // or just:   https://xxx.trycloudflare.com
      const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i)
      if (match && !resolved) {
        resolved = true
        const url = match[0]
        const sessionId = generateSessionId()
        const startedAt = new Date().toISOString()
        const expiresAt = new Date(Date.now() + MAX_SESSION_MS).toISOString()
        state = {
          running: true, url, sessionId, startedAt, expiresAt,
          expireTimer: setTimeout(() => stopTunnel('expired'), MAX_SESSION_MS),
        }
        console.log(`[tunnel] ready — url=${url} session=${sessionId}`)
        resolve({ url, sessionId, startedAt, expiresAt })
      }
    }

    proc.stdout.on('data', onData)
    proc.stderr.on('data', onData)  // cloudflared logs to stderr

    proc.on('exit', (code) => {
      console.log(`[tunnel] process exited code=${code}`)
      if (!resolved) reject(new Error(`cloudflared exited (code ${code}) before URL was ready`))
      if (state.running) stopTunnel('process_exit')
    })

    // Timeout if URL not seen within 30s
    setTimeout(() => {
      if (!resolved) {
        proc.kill()
        reject(new Error('Timeout waiting for cloudflared URL (30s)'))
      }
    }, 30_000)
  })
}

// ── HTTP server ────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json')

  if (req.method === 'GET' && req.url === '/status') {
    res.end(JSON.stringify({
      running: state.running,
      url: state.url,
      sessionId: state.sessionId,
      startedAt: state.startedAt,
      expiresAt: state.expiresAt,
    }))

  } else if (req.method === 'POST' && req.url === '/start') {
    try {
      const result = await startTunnel()
      res.end(JSON.stringify({ ok: true, ...result }))
    } catch (e) {
      res.writeHead(500)
      res.end(JSON.stringify({ ok: false, error: e.message }))
    }

  } else if (req.method === 'POST' && req.url === '/stop') {
    stopTunnel('admin_request')
    res.end(JSON.stringify({ ok: true }))

  } else {
    res.writeHead(404)
    res.end(JSON.stringify({ error: 'Not found' }))
  }
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[tunnel-manager] listening on :${PORT}`)
  console.log(`[tunnel-manager] target: ${TARGET_URL}`)
})

// Graceful shutdown
process.on('SIGTERM', () => { stopTunnel('shutdown'); process.exit(0) })
process.on('SIGINT',  () => { stopTunnel('shutdown'); process.exit(0) })
