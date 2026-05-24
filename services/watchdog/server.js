// Mosaic Watchdog — always-on health sidecar
// Runs on port 3099, reads Docker socket, serves a diagnostic UI
// Works even when Mosaic itself is completely down
'use strict'
const http = require('http')
const { execSync } = require('child_process')

const PORT = 3099
const VERSION = '1.0.0'

// ── Service definitions ────────────────────────────────────────
const CORE_SERVICES = [
  { name: 'mosaic',              label: 'Mosaic',             port: 3001, healthUrl: 'http://mosaic:3001/api/health' },
  { name: 'superset',            label: 'Superset Analytics', port: 8088, healthUrl: 'http://superset:8088/health' },
  { name: 'ciso-backend',        label: 'CISO Assistant',     port: null, healthUrl: 'http://ciso-backend:8000/api/schema/' },
  { name: 'ciso-caddy',          label: 'CISO Proxy',         port: 8443, healthUrl: null },
  { name: 'mosaic-elasticsearch',label: 'Elasticsearch',      port: null, healthUrl: 'http://elasticsearch:9200/_cluster/health' },
]
const INFRA_SERVICES = [
  { name: 'superset-db',                label: 'Superset DB' },
  { name: 'superset-redis',             label: 'Redis' },
  { name: 'mosaic-openmeter',           label: 'OpenMeter' },
  { name: 'mosaic-openmeter-postgres',  label: 'OpenMeter DB' },
  { name: 'mosaic-openmeter-redpanda',  label: 'Redpanda' },
  { name: 'mosaic-openmeter-clickhouse',label: 'ClickHouse' },
]
const OPTIONAL_SERVICES = [
  { name: 'mosaic-stats', label: 'Stats Sidecar' },
  { name: 'mosaic-n8n',   label: 'n8n Automation' },
]

// ── Known error patterns that are benign (suppress from UI) ───
const BENIGN_PATTERNS = [
  'unable to guess serializer',
  'exception raised while getting serializer',
  'could not derive type of path parameter',
  'could not resolve serializer',
  'could not resolve field on model',
  'unable to resolve type hint',
  'Failed to obtain model through view',
  'Non-fatal error',
]

// ── Docker helpers ─────────────────────────────────────────────
function dockerInspect(name, format) {
  try {
    return execSync(`docker inspect ${name} --format '${format}'`, { timeout: 3000 }).toString().trim()
  } catch { return '' }
}

function dockerLogs(name, since = '5m') {
  try {
    const raw = execSync(`docker logs ${name} --since ${since} 2>&1`, { timeout: 5000 }).toString()
    return raw.split('\n')
      .filter(l => /error|fatal|exception|failed|panic/i.test(l))
      .filter(l => !BENIGN_PATTERNS.some(p => l.includes(p)))
      .filter(l => !/^W\s/.test(l)) // strip Warning-prefixed lines
      .slice(-5)
  } catch { return [] }
}

function getContainerStatus(name) {
  const state  = dockerInspect(name, '{{.State.Status}}')
  const health = dockerInspect(name, '{{.State.Health.Status}}')
  const exit   = dockerInspect(name, '{{.State.ExitCode}}')
  if (!state) return { state: 'missing', health: '', exit: '' }
  return { state, health, exit }
}

function diskInfo() {
  try {
    const out = execSync("df -k / | awk 'NR==2 {print $2, $4}'", { timeout: 2000 }).toString().trim()
    const [total, free] = out.split(' ').map(Number)
    return {
      freeGB: Math.round(free / 1024 / 1024),
      totalGB: Math.round(total / 1024 / 1024),
      pctFree: Math.round((free / total) * 100),
    }
  } catch { return null }
}

function memInfo() {
  try {
    if (process.platform === 'linux') {
      const out = execSync("awk '/MemAvailable/ {print $2} /MemTotal/ {print $2}' /proc/meminfo", { timeout: 2000 }).toString().trim()
      const [avail, total] = out.split('\n').map(Number)
      return { freeMB: Math.round(avail / 1024), totalMB: Math.round(total / 1024) }
    }
    return null
  } catch { return null }
}

// ── Status badge helper ────────────────────────────────────────
function badge(state, health) {
  if (state === 'missing')    return { label: 'not found',  cls: 'missing' }
  if (state !== 'running')    return { label: state,        cls: 'down' }
  if (health === 'healthy')   return { label: 'healthy',    cls: 'healthy' }
  if (health === 'unhealthy') return { label: 'unhealthy',  cls: 'unhealthy' }
  if (health === 'starting')  return { label: 'starting…',  cls: 'starting' }
  return { label: 'running', cls: 'running' }
}

// ── Known failure → fix mapping ────────────────────────────────
function suggestFix(name, state, health, errors) {
  if (state === 'missing')    return `docker compose up -d ${name}`
  if (state === 'exited')     return `docker compose up -d ${name}  (then: docker logs ${name} --tail 20)`
  if (health === 'unhealthy') return `docker compose restart ${name}`
  if (errors.some(e => /SUPERSET_SECRET_KEY/i.test(e))) return 'Check SUPERSET_SECRET_KEY in .env — value must match the one used at first boot'
  if (errors.some(e => /no space left/i.test(e)))       return 'Disk full — run: docker system prune -a'
  if (errors.some(e => /port.*already/i.test(e)))       return 'Port conflict — another process is using this port'
  return null
}

// ── Build snapshot ─────────────────────────────────────────────
function buildSnapshot() {
  const ts = new Date().toISOString()
  const services = []
  let issues = 0

  for (const svc of [...CORE_SERVICES, ...INFRA_SERVICES, ...OPTIONAL_SERVICES]) {
    const { state, health, exit } = getContainerStatus(svc.name)
    const b = badge(state, health)
    const errors = (state === 'running') ? dockerLogs(svc.name) : []
    const fix = suggestFix(svc.name, state, health, errors)
    const optional = OPTIONAL_SERVICES.some(o => o.name === svc.name)
    const isIssue = !optional && (state === 'missing' || state === 'exited' || health === 'unhealthy')
    if (isIssue) issues++
    services.push({ ...svc, state, health, exit, badge: b, errors, fix, optional })
  }

  const disk = diskInfo()
  const mem  = memInfo()
  return { ts, services, issues, disk, mem }
}

// ── HTML renderer ──────────────────────────────────────────────
function renderBadge(b) {
  const colors = {
    healthy:   '#16a34a', running: '#2563eb', starting: '#d97706',
    unhealthy: '#dc2626', down: '#dc2626',    missing: '#6b7280',
  }
  const bg = colors[b.cls] || '#6b7280'
  return `<span style="background:${bg};color:#fff;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:600">${b.label}</span>`
}

function renderHTML(snap) {
  const { ts, services, issues, disk, mem } = snap
  const overall = issues === 0
    ? `<div class="banner ok">✓ All systems running</div>`
    : `<div class="banner err">⚠ ${issues} issue${issues > 1 ? 's' : ''} detected — see below</div>`

  const rows = services.map(svc => {
    const b = renderBadge(svc.badge)
    const fixHtml = svc.fix ? `<div class="fix">→ Fix: <code>${svc.fix}</code></div>` : ''
    const errHtml = svc.errors.length ? `<div class="errors">${svc.errors.map(e => `<div class="err-line">${e}</div>`).join('')}</div>` : ''
    const optTag  = svc.optional ? ` <span class="opt">optional</span>` : ''
    return `
      <tr class="${svc.badge.cls === 'healthy' || svc.badge.cls === 'running' ? '' : 'row-issue'}">
        <td><strong>${svc.label}</strong>${optTag}<br><small class="dim">${svc.name}</small></td>
        <td>${b}</td>
        <td>${fixHtml}${errHtml}</td>
      </tr>`
  }).join('')

  const resourceHtml = [
    disk ? `<div class="res-item ${disk.pctFree < 10 ? 'res-warn' : ''}">💾 Disk: <strong>${disk.freeGB}GB</strong> free of ${disk.totalGB}GB</div>` : '',
    mem  ? `<div class="res-item ${mem.freeMB < 512 ? 'res-warn' : ''}">🧠 Memory: <strong>${mem.freeMB}MB</strong> free of ${mem.totalMB}MB</div>` : '',
  ].filter(Boolean).join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="15">
<title>Mosaic Watchdog</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f1117;color:#e2e8f0;padding:24px;line-height:1.5}
  h1{font-size:20px;font-weight:700;margin-bottom:4px}
  .sub{font-size:12px;color:#64748b;margin-bottom:20px}
  .banner{padding:10px 16px;border-radius:8px;font-weight:600;font-size:13px;margin-bottom:20px}
  .banner.ok{background:#052e16;color:#4ade80;border:1px solid #166534}
  .banner.err{background:#450a0a;color:#f87171;border:1px solid #991b1b}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{text-align:left;padding:8px 12px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#64748b;border-bottom:1px solid #1e293b}
  td{padding:10px 12px;border-bottom:1px solid #1e293b;vertical-align:top}
  tr.row-issue td{background:#1a0a0a}
  .dim{color:#475569;font-size:11px}
  .opt{font-size:10px;color:#475569;border:1px solid #334155;border-radius:3px;padding:0 4px;margin-left:6px}
  .fix{font-size:11px;color:#94a3b8;margin-top:4px}
  code{background:#1e293b;padding:1px 5px;border-radius:3px;font-size:11px}
  .errors{margin-top:6px}
  .err-line{font-size:11px;color:#f87171;font-family:monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:500px}
  .resources{display:flex;gap:16px;margin-bottom:20px;flex-wrap:wrap}
  .res-item{background:#1e293b;border:1px solid #334155;border-radius:6px;padding:8px 14px;font-size:12px}
  .res-item strong{color:#e2e8f0}
  .res-warn{border-color:#991b1b;background:#1a0a0a}
  .footer{margin-top:20px;font-size:11px;color:#334155;display:flex;justify-content:space-between}
  a{color:#3b82f6;text-decoration:none}
  a:hover{text-decoration:underline}
</style>
</head>
<body>
<h1>🔍 Mosaic Watchdog</h1>
<div class="sub">Auto-refreshes every 15 seconds · ${new Date(ts).toLocaleString()}</div>
${overall}
${resourceHtml ? `<div class="resources">${resourceHtml}</div>` : ''}
<table>
  <thead><tr><th>Service</th><th>Status</th><th>Details / Fix</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
<div class="footer">
  <span>Mosaic Watchdog v${VERSION} · <a href="/health">JSON health</a> · <a href="/bundle">Download support bundle</a></span>
  <span>If Mosaic is down: run <code>bash mosaic-doctor.sh</code> for full diagnostics</span>
</div>
</body>
</html>`
}

// ── JSON health endpoint ───────────────────────────────────────
function renderJSON(snap) {
  return JSON.stringify({ ok: snap.issues === 0, issues: snap.issues, ts: snap.ts,
    services: snap.services.map(s => ({ name: s.name, state: s.state, health: s.health })),
    disk: snap.disk, mem: snap.mem,
  }, null, 2)
}

// ── Support bundle endpoint ────────────────────────────────────
function renderBundle() {
  const lines = [`Mosaic Support Bundle — ${new Date().toISOString()}`, '='.repeat(60), '']
  // Docker ps
  try {
    lines.push('## Container states')
    lines.push(execSync('docker ps -a --format "{{.Names}}\\t{{.Status}}\\t{{.Image}}"', { timeout: 5000 }).toString())
  } catch { lines.push('(unavailable)') }
  // Recent logs from core services
  for (const svc of CORE_SERVICES) {
    try {
      lines.push(`## Logs: ${svc.name} (last 30 lines)`)
      lines.push(execSync(`docker logs ${svc.name} --tail 30 2>&1`, { timeout: 5000 }).toString())
    } catch { lines.push('(unavailable)') }
  }
  // Disk + memory
  try { lines.push('## Disk'); lines.push(execSync('df -h', { timeout: 2000 }).toString()) } catch {}
  return lines.join('\n')
}

// ── HTTP server ────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    const snap = buildSnapshot()
    res.writeHead(snap.issues === 0 ? 200 : 503, { 'Content-Type': 'application/json' })
    res.end(renderJSON(snap))
  } else if (req.url === '/bundle') {
    res.writeHead(200, {
      'Content-Type': 'text/plain',
      'Content-Disposition': `attachment; filename="mosaic-support-bundle-${Date.now()}.txt"`,
    })
    res.end(renderBundle())
  } else {
    const snap = buildSnapshot()
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(renderHTML(snap))
  }
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Mosaic Watchdog v${VERSION} running on http://0.0.0.0:${PORT}`)
  console.log(`UI:     http://localhost:${PORT}`)
  console.log(`Health: http://localhost:${PORT}/health`)
  console.log(`Bundle: http://localhost:${PORT}/bundle`)
})
