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
  { name: 'mosaic',              label: 'Mosaic',             port: 3001 },
  { name: 'superset',            label: 'Superset Analytics', port: 8088 },
  { name: 'ciso-backend',        label: 'CISO Assistant',     port: null },
  { name: 'ciso-caddy',          label: 'CISO Proxy',         port: 8443 },
  { name: 'mosaic-elasticsearch',label: 'Elasticsearch',      port: null },
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
  try { return execSync(`docker inspect ${name} --format '${format}'`, { timeout: 3000 }).toString().trim() }
  catch { return '' }
}

function dockerLogs(name, since = '5m') {
  try {
    const raw = execSync(`docker logs ${name} --since ${since} 2>&1`, { timeout: 5000 }).toString()
    return raw.split('\n')
      .filter(l => /error|fatal|exception|failed|panic/i.test(l))
      .filter(l => !BENIGN_PATTERNS.some(p => l.includes(p)))
      .filter(l => !/^W\s/.test(l))
      .slice(-3)
  } catch { return [] }
}

function getContainerStatus(name) {
  const state  = dockerInspect(name, '{{.State.Status}}')
  const health = dockerInspect(name, '{{.State.Health.Status}}')
  const exit   = dockerInspect(name, '{{.State.ExitCode}}')
  return { state: state || 'missing', health, exit }
}

function diskInfo() {
  try {
    const out = execSync("df -k / | awk 'NR==2 {print $2, $4}'", { timeout: 2000 }).toString().trim()
    const [total, free] = out.split(' ').map(Number)
    return { freeGB: Math.round(free / 1024 / 1024), totalGB: Math.round(total / 1024 / 1024), pctFree: Math.round((free / total) * 100) }
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

// ── Status helpers ─────────────────────────────────────────────
function getStatusLevel(state, health) {
  if (state === 'missing' || state === 'exited' || state === 'dead') return 'error'
  if (health === 'unhealthy') return 'error'
  if (health === 'starting' || state === 'restarting') return 'warning'
  if (health === 'healthy') return 'healthy'
  return 'running'
}

function getStatusLabel(state, health) {
  if (state === 'missing')    return 'Not found'
  if (state === 'exited')     return 'Stopped'
  if (state === 'dead')       return 'Dead'
  if (health === 'unhealthy') return 'Unhealthy'
  if (health === 'starting')  return 'Starting'
  if (health === 'healthy')   return 'Healthy'
  if (state === 'running')    return 'Running'
  return state
}

function suggestFix(name, state, health, errors) {
  if (state === 'missing')    return `docker compose up -d ${name}`
  if (state === 'exited')     return `docker compose up -d ${name}`
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
    const level = getStatusLevel(state, health)
    const statusLabel = getStatusLabel(state, health)
    const errors = (state === 'running') ? dockerLogs(svc.name) : []
    const fix = suggestFix(svc.name, state, health, errors)
    const optional = OPTIONAL_SERVICES.some(o => o.name === svc.name)
    const isIssue = !optional && (level === 'error')
    if (isIssue) issues++
    services.push({ ...svc, state, health, exit, level, statusLabel, errors, fix, optional })
  }

  return { ts, services, issues, disk: diskInfo(), mem: memInfo() }
}

// ── HTML renderer ──────────────────────────────────────────────
function renderHTML(snap) {
  const { ts, services, issues, disk, mem } = snap

  const coreRows = services.filter(s => CORE_SERVICES.some(c => c.name === s.name))
  const infraRows = services.filter(s => INFRA_SERVICES.some(c => c.name === s.name))
  const optRows   = services.filter(s => OPTIONAL_SERVICES.some(c => c.name === s.name))

  function statusDot(level) {
    const colors = { healthy: '#16a34a', running: '#2563eb', warning: '#d97706', error: '#dc2626' }
    return `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${colors[level] || '#8a8a8a'};flex-shrink:0;margin-top:1px"></span>`
  }

  function statusBadge(label, level) {
    const styles = {
      healthy: 'background:#f0fdf4;color:#16a34a;border:1px solid rgba(22,163,74,.2)',
      running: 'background:#eff6ff;color:#2563eb;border:1px solid rgba(37,99,235,.2)',
      warning: 'background:#fffbeb;color:#d97706;border:1px solid rgba(217,119,6,.2)',
      error:   'background:#fef2f2;color:#dc2626;border:1px solid rgba(220,38,38,.2)',
    }
    const s = styles[level] || 'background:#f5f5f5;color:#8a8a8a;border:1px solid rgba(0,0,0,.08)'
    return `<span style="${s};padding:2px 10px;border-radius:999px;font-size:11px;font-weight:600;white-space:nowrap">${label}</span>`
  }

  function serviceRow(svc) {
    const isIssue = svc.level === 'error' && !svc.optional
    const bg = isIssue ? 'background:#fef2f2' : ''
    const fixHtml = svc.fix
      ? `<div style="font-size:11px;color:#8a8a8a;margin-top:4px;display:flex;align-items:flex-start;gap:4px"><span style="color:#d97706;flex-shrink:0">→</span><code style="font-family:ui-monospace,monospace;font-size:11px;color:#4a4a4a">${svc.fix}</code></div>`
      : ''
    const errHtml = svc.errors.length
      ? svc.errors.map(e => `<div style="font-size:11px;font-family:ui-monospace,monospace;color:#dc2626;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:480px;margin-top:2px">${e.trim()}</div>`).join('')
      : ''
    const optTag = svc.optional ? `<span style="font-size:10px;color:#b0b0b0;border:1px solid rgba(0,0,0,.08);border-radius:4px;padding:0 4px;margin-left:6px">optional</span>` : ''
    return `
      <tr>
        <td style="padding:12px 16px;border-bottom:1px solid rgba(0,0,0,.06);${bg}">
          <div style="display:flex;align-items:center;gap:8px">
            ${statusDot(svc.level)}
            <div>
              <div style="font-size:13px;font-weight:500;color:#0f0f0f">${svc.label}${optTag}</div>
              <div style="font-size:11px;color:#b0b0b0;margin-top:1px">${svc.name}</div>
            </div>
          </div>
        </td>
        <td style="padding:12px 16px;border-bottom:1px solid rgba(0,0,0,.06);${bg};white-space:nowrap">${statusBadge(svc.statusLabel, svc.level)}</td>
        <td style="padding:12px 16px;border-bottom:1px solid rgba(0,0,0,.06);${bg}">${fixHtml}${errHtml}</td>
      </tr>`
  }

  function sectionHeader(title, count) {
    return `<tr><td colspan="3" style="padding:8px 16px 4px;background:#f5f5f5;border-bottom:1px solid rgba(0,0,0,.06)"><span style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:#8a8a8a">${title}</span>${count ? `<span style="font-size:10px;color:#b0b0b0;margin-left:6px">${count}</span>` : ''}</td></tr>`
  }

  const allGood = issues === 0
  const bannerBg    = allGood ? '#f0fdf4' : '#fef2f2'
  const bannerBdr   = allGood ? 'rgba(22,163,74,.2)' : 'rgba(220,38,38,.2)'
  const bannerColor = allGood ? '#16a34a' : '#dc2626'
  const bannerIcon  = allGood
    ? `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="${bannerColor}" stroke-width="1.8"><path d="M3 8l3 3 7-7"/></svg>`
    : `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="${bannerColor}" stroke-width="1.8"><path d="M8 5v4M8 11v.5"/><circle cx="8" cy="8" r="6.5"/></svg>`
  const bannerText  = allGood ? 'All systems running' : `${issues} issue${issues > 1 ? 's' : ''} detected`

  const resourceCards = [
    disk ? `
      <div style="background:#ffffff;border:1px solid rgba(0,0,0,.08);border-radius:12px;padding:14px 16px;flex:1;min-width:160px">
        <div style="font-size:11px;color:#8a8a8a;margin-bottom:4px">Disk space</div>
        <div style="font-size:18px;font-weight:600;color:#0f0f0f">${disk.freeGB} GB <span style="font-size:13px;font-weight:400;color:#8a8a8a">free</span></div>
        <div style="font-size:11px;color:#b0b0b0;margin-top:2px">of ${disk.totalGB} GB total</div>
        <div style="margin-top:8px;height:4px;background:rgba(0,0,0,.06);border-radius:2px;overflow:hidden">
          <div style="height:100%;width:${100 - disk.pctFree}%;background:${disk.pctFree < 10 ? '#dc2626' : disk.pctFree < 20 ? '#d97706' : '#16a34a'};border-radius:2px"></div>
        </div>
      </div>` : '',
    mem ? `
      <div style="background:#ffffff;border:1px solid rgba(0,0,0,.08);border-radius:12px;padding:14px 16px;flex:1;min-width:160px">
        <div style="font-size:11px;color:#8a8a8a;margin-bottom:4px">Available memory</div>
        <div style="font-size:18px;font-weight:600;color:#0f0f0f">${mem.freeMB} <span style="font-size:13px;font-weight:400;color:#8a8a8a">MB free</span></div>
        <div style="font-size:11px;color:#b0b0b0;margin-top:2px">of ${mem.totalMB} MB total</div>
        <div style="margin-top:8px;height:4px;background:rgba(0,0,0,.06);border-radius:2px;overflow:hidden">
          <div style="height:100%;width:${Math.round(((mem.totalMB - mem.freeMB) / mem.totalMB) * 100)}%;background:${mem.freeMB < 512 ? '#dc2626' : mem.freeMB < 1024 ? '#d97706' : '#2563eb'};border-radius:2px"></div>
        </div>
      </div>` : '',
  ].filter(Boolean).join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="15">
<title>Mosaic — System Health</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0 }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif; background: #f5f5f5; color: #0f0f0f; min-height: 100vh }
  a { color: #2563eb; text-decoration: none }
  a:hover { text-decoration: underline }
  code { font-family: ui-monospace, 'SF Mono', monospace }
  table { width: 100%; border-collapse: collapse }
  th { text-align: left; padding: 8px 16px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .08em; color: #8a8a8a; background: #f5f5f5; border-bottom: 1px solid rgba(0,0,0,.08) }
</style>
</head>
<body>
  <!-- Header -->
  <div style="background:#ffffff;border-bottom:1px solid rgba(0,0,0,.08);padding:0 24px">
    <div style="max-width:960px;margin:0 auto;height:56px;display:flex;align-items:center;justify-content:space-between">
      <div style="display:flex;align-items:center;gap:10px">
        <div style="width:28px;height:28px;background:#0f0f0f;border-radius:8px;display:flex;align-items:center;justify-content:center">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="white" stroke-width="1.6"><rect x="1" y="1" width="5" height="5" rx="1"/><rect x="8" y="1" width="5" height="5" rx="1"/><rect x="1" y="8" width="5" height="5" rx="1"/><rect x="8" y="8" width="5" height="5" rx="1"/></svg>
        </div>
        <span style="font-size:14px;font-weight:600;color:#0f0f0f">Mosaic</span>
        <span style="font-size:14px;color:#b0b0b0">/</span>
        <span style="font-size:14px;color:#4a4a4a">System Health</span>
      </div>
      <div style="font-size:11px;color:#b0b0b0">Refreshes every 15s · ${new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
    </div>
  </div>

  <div style="max-width:960px;margin:0 auto;padding:24px">

    <!-- Status banner -->
    <div style="background:${bannerBg};border:1px solid ${bannerBdr};border-radius:12px;padding:12px 16px;display:flex;align-items:center;gap:10px;margin-bottom:20px">
      ${bannerIcon}
      <span style="font-size:13px;font-weight:600;color:${bannerColor}">${bannerText}</span>
      ${!allGood ? `<span style="font-size:12px;color:#8a8a8a;margin-left:4px">— check the fixes below</span>` : ''}
    </div>

    ${resourceCards ? `
    <!-- Resource cards -->
    <div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap">
      ${resourceCards}
    </div>` : ''}

    <!-- Services table -->
    <div style="background:#ffffff;border:1px solid rgba(0,0,0,.08);border-radius:12px;overflow:hidden;margin-bottom:20px">
      <table>
        <thead>
          <tr>
            <th style="width:40%">Service</th>
            <th style="width:15%">Status</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          ${sectionHeader('Core services')}
          ${coreRows.map(serviceRow).join('')}
          ${sectionHeader('Infrastructure')}
          ${infraRows.map(serviceRow).join('')}
          ${sectionHeader('Optional')}
          ${optRows.map(serviceRow).join('')}
        </tbody>
      </table>
    </div>

    <!-- Footer links -->
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
      <div style="display:flex;gap:16px;font-size:12px">
        <a href="/health">JSON health</a>
        <a href="/bundle">Download support bundle</a>
        <a href="/network">Network requirements</a>
      </div>
      <div style="font-size:11px;color:#b0b0b0">
        If Mosaic won't load, run <code style="background:#f0f0f0;padding:1px 6px;border-radius:4px;font-size:11px">bash mosaic-doctor.sh</code>
      </div>
    </div>

  </div>
</body>
</html>`
}

// ── JSON health endpoint ───────────────────────────────────────
function renderJSON(snap) {
  return JSON.stringify({
    ok: snap.issues === 0, issues: snap.issues, ts: snap.ts,
    services: snap.services.map(s => ({ name: s.name, state: s.state, health: s.health, level: s.level })),
    disk: snap.disk, mem: snap.mem,
  }, null, 2)
}

// ── Support bundle ─────────────────────────────────────────────
function renderBundle() {
  const lines = [`Mosaic Support Bundle — ${new Date().toISOString()}`, '='.repeat(60), '']
  try { lines.push('## Container states'); lines.push(execSync('docker ps -a --format "{{.Names}}\\t{{.Status}}\\t{{.Image}}"', { timeout: 5000 }).toString()) } catch { lines.push('(unavailable)') }
  for (const svc of CORE_SERVICES) {
    try { lines.push(`## Logs: ${svc.name} (last 30 lines)`); lines.push(execSync(`docker logs ${svc.name} --tail 30 2>&1`, { timeout: 5000 }).toString()) } catch { lines.push('(unavailable)') }
  }
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
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Disposition': `attachment; filename="mosaic-support-bundle-${Date.now()}.txt"` })
    res.end(renderBundle())
  } else if (req.url === '/network') {
    const fs = require('fs'), path = require('path')
    const candidates = ['/mosaic/NETWORK.md', path.join(__dirname, '../../NETWORK.md'), path.join(__dirname, '../../../NETWORK.md')]
    let content = null
    for (const p of candidates) { try { content = fs.readFileSync(p, 'utf8'); break } catch {} }
    if (content) { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(content) }
    else { res.writeHead(302, { 'Location': 'https://github.com/your-org/mosaic/blob/main/NETWORK.md' }); res.end() }
  } else {
    const snap = buildSnapshot()
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(renderHTML(snap))
  }
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Mosaic Watchdog v${VERSION} running on http://0.0.0.0:${PORT}`)
  console.log(`UI:      http://localhost:${PORT}`)
  console.log(`Health:  http://localhost:${PORT}/health`)
  console.log(`Bundle:  http://localhost:${PORT}/bundle`)
  console.log(`Network: http://localhost:${PORT}/network`)
})

process.on('SIGTERM', () => process.exit(0))
process.on('SIGINT',  () => process.exit(0))
