// Cube integration parity test across ALL Cube-supported harness dialects
// (Postgres, MySQL, SQL Server). For each source it builds a verified model on a
// time + numeric-measure column, drives the real /api/semantic + /api/dashboards
// APIs, and asserts the dashboard panel routes engine=cube with a daily total that
// matches ground truth computed directly against that database. Runs inside the
// mosaic container. Cleans up each source's model + dashboard afterwards.
import { SignJWT } from 'jose'
import Database from 'better-sqlite3'
import pg from 'pg'
import mysql from 'mysql2/promise'
import mssql from 'mssql'

const BASE = 'http://127.0.0.1:3001'

// Each source: connId (from .datasources.json), schema to introspect, a fully-
// qualified table (schema.table), a time column and a numeric measure column.
const SOURCES = [
  { label: 'Postgres', connId: 'E8AFF7BB9DDE8A6E9A4C1F49A0EE0E4B', dialect: 'postgres',
    schema: 'plant', table: 'plant.production_runs', time: 'run_date', measure: 'units_produced' },
  { label: 'MySQL', connId: 'E6170A13DFA971F42C18C9F3DF197894', dialect: 'mysql',
    schema: 'erp_lite', table: 'erp_lite.orders', time: 'order_date', measure: 'total_amount' },
  { label: 'SQL Server', connId: '294B178CA5B602F55619904EBB3F1082', dialect: 'mssql',
    schema: 'dbo', table: 'dbo.work_orders', time: 'raised_date', measure: 'asset_id',
    synthetic: true },  // asset_id is an FK; summed only to verify aggregation parity
]

const results = []
const rec = (name, pass, detail) => { results.push({ name, pass }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }

// ---- admin session (minted with the app secret) ----
const db = new Database('/data/mosaic.db')
for (const s of SOURCES) db.prepare('UPDATE db_connections SET schema_name=? WHERE id=?').run(s.schema, s.connId)
const admin = db.prepare("SELECT id,email,name,role FROM users WHERE role='admin' LIMIT 1").get()
db.close()
const raw = process.env.AUTH_SECRET
const secret = new TextEncoder().encode(raw.padEnd(32, raw).slice(0, 64))
const token = await new SignJWT({ id: admin.id, email: admin.email, name: admin.name, role: admin.role }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('7d').setIssuedAt().sign(secret)
const COOKIE = 'claude_session=' + token
const api = async (p, b, m = 'POST') => { const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', Cookie: COOKIE }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); let j; try { j = JSON.parse(t) } catch { j = t } return { status: r.status, body: j } }
const get = (p) => api(p, null, 'GET')
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// ---- ground truth per dialect: returns {from, to, total, days} over all data ----
async function groundTruth(s) {
  const col = s.measure, tcol = s.time, tbl = s.table
  if (s.dialect === 'postgres') {
    const c = new pg.Client({ host: 'postgres', port: 5432, database: 'plant_ops', user: 'mosaic', password: 'mosaic_pw' }); await c.connect()
    const r = await c.query(`SELECT ${tcol}::date d, sum(${col})::float v FROM ${tbl} GROUP BY 1 ORDER BY 1`); await c.end()
    return summarize(r.rows)
  }
  if (s.dialect === 'mysql') {
    const c = await mysql.createConnection({ host: 'mysql', port: 3306, database: 'erp_lite', user: 'mosaic', password: 'mosaic_pw' })
    const [rows] = await c.query(`SELECT DATE(${tcol}) d, SUM(${col}) v FROM ${tbl} GROUP BY 1 ORDER BY 1`); await c.end()
    return summarize(rows.map(x => ({ d: x.d, v: Number(x.v) })))
  }
  // mssql
  const pool = await mssql.connect({ server: 'mssql', port: 1433, database: 'cmms', user: 'sa', password: 'Mosaic_Strong_Pw_1', options: { encrypt: false, trustServerCertificate: true } })
  const r = await pool.request().query(`SELECT CAST(${tcol} AS date) d, SUM(CAST(${col} AS bigint)) v FROM ${tbl} GROUP BY CAST(${tcol} AS date) ORDER BY 1`); await pool.close()
  return summarize(r.recordset.map(x => ({ d: x.d, v: Number(x.v) })))
}
function fmt(d) { const x = new Date(d); return x.toISOString().slice(0, 10) }
function summarize(rows) {
  const total = rows.reduce((a, r) => a + Number(r.v || 0), 0)
  const days = rows.length
  const from = fmt(rows[0].d), to = fmt(rows[rows.length - 1].d)
  return { from, to, total, days }
}
function panelParity(res) {
  const r0 = (res.body?.results || [])[0] || {}
  const meta = r0.data?.meta || {}, rows = r0.data?.rows || []
  const yOf = (row) => { if (row && typeof row === 'object') { for (const k of Object.keys(row)) { if (k !== 'run_date' && k !== 'order_date' && k !== 'raised_date' && !isNaN(Number(row[k])) && row[k] !== null && row[k] !== '') return Number(row[k]) } } return 0 }
  return { engine: meta.engine, reason: meta.engine_reason, nrows: rows.length, total: rows.reduce((a, r) => a + yOf(r), 0) }
}

for (const s of SOURCES) {
  console.log(`\n==== ${s.label} (${s.dialect}) — ${s.table} sum(${s.measure}) by ${s.time}${s.synthetic ? ' [synthetic measure]' : ''} ====`)
  // clean slate for this source's model
  const d2 = new Database('/data/mosaic.db'); d2.prepare('DELETE FROM connection_schemas WHERE connection_id=?').run(s.connId); d2.prepare('DELETE FROM semantic_descriptions WHERE source_type=? AND source_id=?').run('database', s.connId); d2.close()
  let gt
  try { gt = await groundTruth(s) } catch (e) { rec(`${s.label}: ground truth`, false, String(e).slice(0, 120)); continue }
  rec(`${s.label}: ground truth`, gt.days > 0, `${gt.days} days ${gt.from}..${gt.to}, total=${gt.total}`)

  // introspect (poll; background refresh)
  let saw = false, keys = 0
  for (let i = 0; i < 10 && !saw; i++) { const g = await api('/api/semantic', { action: 'generate', source_type: 'database', source_id: s.connId }); const ks = Array.isArray(g.body?.draft) ? g.body.draft.map(x => x.object_key) : []; keys = ks.length; saw = ks.some(k => k.toLowerCase().includes(s.table.split('.').pop())); if (!saw) await sleep(2500) }
  rec(`${s.label}: introspect`, saw, `keys=${keys}`)
  if (!saw) continue

  await api('/api/semantic', { action: 'upsert', source_type: 'database', source_id: s.connId, items: [
    { object_type: 'table', object_key: s.table, description: s.label },
    { object_type: 'column', object_key: `${s.table}.${s.time}`, role: 'time', data_type: 'timestamp', time_grain: 'day', status: 'verified', confidence: 0.95 },
    { object_type: 'column', object_key: `${s.table}.${s.measure}`, role: 'measure', data_type: 'number', default_aggregation: 'sum', accumulation: 'raw', status: 'verified', confidence: 0.95 },
  ]})
  await sleep(8000)  // resyncCubeModel + Cube compile

  const cd = await api('/api/dashboards', { action: 'create_dashboard', name: `Cube ${s.label} ${Date.now()}`, default_time_window: 'custom' })
  const dashId = cd.body?.id || cd.body?.dashboard?.id
  await api('/api/dashboards', { action: 'add_panel', dashboard_id: dashId, title: 'm', source_type: 'database', source_id: s.connId,
    query: `SELECT ${s.time}, ${s.measure} FROM ${s.table} WHERE ${s.time} >= '${gt.from}' AND ${s.time} <= '${gt.to} 23:59:59'`,
    chart_type: 'line', chart_config: { x: s.time, y: s.measure, grain: '1d' } })

  const url = `/api/dashboards/${dashId}/data?time_window=custom&time_from=${gt.from}&time_to=${gt.to}&grain=1d`
  // A newly-generated cube takes a few seconds for Cube to compile; poll until it
  // routes (SQL fallback returns correct values meanwhile). Measure the latency.
  let p, waited = 0
  for (let i = 0; i < 20; i++) { p = panelParity(await get(url)); if (p.engine === 'cube') break; await sleep(3000); waited += 3 }
  console.log(`  ${JSON.stringify(p)} (compiled after ~${waited}s)`)
  rec(`${s.label}: routes to Cube`, p.engine === 'cube', `engine=${p.engine} reason=${p.reason || ''} after ~${waited}s`)
  rec(`${s.label}: Cube total matches ground truth`, Math.abs(p.total - gt.total) < 1, `cube=${p.total} gt=${gt.total}`)

  // cleanup
  await api('/api/dashboards', { action: 'delete_dashboard', id: dashId })
  await api('/api/semantic', { action: 'delete', source_type: 'database', source_id: s.connId, all: true })
}

const passed = results.filter(r => r.pass).length
console.log(`\n==== ${passed}/${results.length} checks passed ====`)
process.exit(passed === results.length ? 0 : 1)
