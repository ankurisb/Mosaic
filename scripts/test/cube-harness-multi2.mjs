// Two-phase multi-dialect Cube SERVING proof. Because Cube on this box only
// compiles schema at (re)start, we: phase 'setup' establishes verified models +
// dashboards for all 3 dialects and records state; then Cube is restarted
// externally; then phase 'verify' queries each dashboard and asserts the panel
// routes engine=cube with a daily total matching ground truth. Usage:
//   node cube-harness-multi2.mjs setup
//   (docker restart mosaic-cube; wait)
//   node cube-harness-multi2.mjs verify
import { SignJWT } from 'jose'
import Database from 'better-sqlite3'
import fs from 'fs'
import pg from 'pg'
import mysql from 'mysql2/promise'
import mssql from 'mssql'

const MODE = process.argv[2] || 'setup'
const STATE = '/tmp/cube_multi_state.json'
const BASE = 'http://127.0.0.1:3001'
const SOURCES = [
  { label: 'Postgres', connId: 'E8AFF7BB9DDE8A6E9A4C1F49A0EE0E4B', dialect: 'postgres', schema: 'plant', table: 'plant.production_runs', time: 'run_date', measure: 'units_produced' },
  { label: 'MySQL', connId: 'E6170A13DFA971F42C18C9F3DF197894', dialect: 'mysql', schema: 'erp_lite', table: 'erp_lite.orders', time: 'order_date', measure: 'total_amount' },
  { label: 'SQL Server', connId: '294B178CA5B602F55619904EBB3F1082', dialect: 'mssql', schema: 'dbo', table: 'dbo.work_orders', time: 'raised_date', measure: 'asset_id', synthetic: true },
]
const results = []
const rec = (n, p, d) => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`) }
const sleep = ms => new Promise(r => setTimeout(r, ms))

const db = new Database('/data/mosaic.db')
for (const s of SOURCES) db.prepare('UPDATE db_connections SET schema_name=? WHERE id=?').run(s.schema, s.connId)
const admin = db.prepare("SELECT id,email,name,role FROM users WHERE role='admin' LIMIT 1").get()
const raw = process.env.AUTH_SECRET
const secret = new TextEncoder().encode(raw.padEnd(32, raw).slice(0, 64))
const token = await new SignJWT({ id: admin.id, email: admin.email, name: admin.name, role: admin.role }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('7d').setIssuedAt().sign(secret)
const COOKIE = 'claude_session=' + token
const api = async (p, b, m = 'POST') => { const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', Cookie: COOKIE }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); let j; try { j = JSON.parse(t) } catch { j = t } return { status: r.status, body: j } }
const get = p => api(p, null, 'GET')
const fmt = d => new Date(d).toISOString().slice(0, 10)
const summarize = rows => ({ from: fmt(rows[0].d), to: fmt(rows[rows.length - 1].d), total: rows.reduce((a, r) => a + Number(r.v || 0), 0), days: rows.length })
async function groundTruth(s) {
  if (s.dialect === 'postgres') { const c = new pg.Client({ host: 'postgres', port: 5432, database: 'plant_ops', user: 'mosaic', password: 'mosaic_pw' }); await c.connect(); const r = await c.query(`SELECT ${s.time}::date d, sum(${s.measure})::float v FROM ${s.table} GROUP BY 1 ORDER BY 1`); await c.end(); return summarize(r.rows) }
  if (s.dialect === 'mysql') { const c = await mysql.createConnection({ host: 'mysql', port: 3306, database: 'erp_lite', user: 'mosaic', password: 'mosaic_pw' }); const [rows] = await c.query(`SELECT DATE(${s.time}) d, SUM(${s.measure}) v FROM ${s.table} GROUP BY 1 ORDER BY 1`); await c.end(); return summarize(rows.map(x => ({ d: x.d, v: Number(x.v) }))) }
  const pool = await mssql.connect({ server: 'mssql', port: 1433, database: 'cmms', user: 'sa', password: 'Mosaic_Strong_Pw_1', options: { encrypt: false, trustServerCertificate: true } }); const r = await pool.request().query(`SELECT CAST(${s.time} AS date) d, SUM(CAST(${s.measure} AS bigint)) v FROM ${s.table} GROUP BY CAST(${s.time} AS date) ORDER BY 1`); await pool.close(); return summarize(r.recordset.map(x => ({ d: x.d, v: Number(x.v) })))
}
function parity(res) { const r0 = (res.body?.results || [])[0] || {}; const meta = r0.data?.meta || {}, rows = r0.data?.rows || []; const yOf = row => { if (row && typeof row === 'object') for (const k of Object.keys(row)) { if (!['run_date', 'order_date', 'raised_date'].includes(k) && row[k] !== null && row[k] !== '' && !isNaN(Number(row[k]))) return Number(row[k]) } return 0 }; return { engine: meta.engine, reason: meta.engine_reason, nrows: rows.length, total: rows.reduce((a, r) => a + yOf(r), 0) } }

if (MODE === 'setup') {
  const state = []
  for (const s of SOURCES) {
    db.prepare('DELETE FROM connection_schemas WHERE connection_id=?').run(s.connId)
    db.prepare('DELETE FROM semantic_descriptions WHERE source_type=? AND source_id=?').run('database', s.connId)
    const gt = await groundTruth(s)
    let saw = false
    for (let i = 0; i < 10 && !saw; i++) { const g = await api('/api/semantic', { action: 'generate', source_type: 'database', source_id: s.connId }); const ks = Array.isArray(g.body?.draft) ? g.body.draft.map(x => x.object_key) : []; saw = ks.some(k => k.toLowerCase().includes(s.table.split('.').pop())); if (!saw) await sleep(2500) }
    await api('/api/semantic', { action: 'upsert', source_type: 'database', source_id: s.connId, items: [
      { object_type: 'table', object_key: s.table, description: s.label },
      { object_type: 'column', object_key: `${s.table}.${s.time}`, role: 'time', data_type: 'timestamp', time_grain: 'day', status: 'verified', confidence: 0.95 },
      { object_type: 'column', object_key: `${s.table}.${s.measure}`, role: 'measure', data_type: 'number', default_aggregation: 'sum', accumulation: 'raw', status: 'verified', confidence: 0.95 },
    ]})
    const cd = await api('/api/dashboards', { action: 'create_dashboard', name: `CubeMulti ${s.label} ${Date.now()}`, default_time_window: 'custom' })
    const dashId = cd.body?.id || cd.body?.dashboard?.id
    await api('/api/dashboards', { action: 'add_panel', dashboard_id: dashId, title: 'm', source_type: 'database', source_id: s.connId, query: `SELECT ${s.time}, ${s.measure} FROM ${s.table} WHERE ${s.time} >= '${gt.from}' AND ${s.time} <= '${gt.to} 23:59:59'`, chart_type: 'line', chart_config: { x: s.time, y: s.measure, grain: '1d' } })
    console.log(`setup ${s.label}: introspect=${saw} dash=${dashId} gt=${gt.total} (${gt.days}d ${gt.from}..${gt.to})`)
    state.push({ ...s, dashId, gt })
  }
  fs.writeFileSync(STATE, JSON.stringify(state))
  console.log('SETUP COMPLETE — restart mosaic-cube, then run verify')
} else {
  const state = JSON.parse(fs.readFileSync(STATE, 'utf8'))
  for (const s of state) {
    const url = `/api/dashboards/${s.dashId}/data?time_window=custom&time_from=${s.gt.from}&time_to=${s.gt.to}&grain=1d`
    let p
    for (let i = 0; i < 12; i++) { p = parity(await get(url)); if (p.engine === 'cube') break; await sleep(3000) }
    console.log(`  ${s.label}: ${JSON.stringify(p)}`)
    rec(`${s.label}: routes to Cube`, p.engine === 'cube', `engine=${p.engine} ${p.reason || ''}`)
    rec(`${s.label}: Cube total = ground truth`, Math.abs(p.total - s.gt.total) < 1, `cube=${p.total} gt=${s.gt.total}`)
    await api('/api/dashboards', { action: 'delete_dashboard', id: s.dashId })
    await api('/api/semantic', { action: 'delete', source_type: 'database', source_id: s.connId, all: true })
  }
  const passed = results.filter(r => r.p).length
  console.log(`\n==== ${passed}/${results.length} checks passed ====`)
  process.exit(passed === results.length ? 0 : 1)
}
db.close()
