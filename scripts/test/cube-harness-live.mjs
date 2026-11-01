// Cube integration end-to-end verification against the live test harness.
// Runs INSIDE the mosaic container (/app), drives the real product APIs with a
// minted admin session, and checks engine routing + value parity vs ground truth.
//
//   PG source: plant.production_runs  (time=run_date, measure=units_produced:sum, dim=shift)
//
// Proves: schema introspection → verified model → Mosaic generates a Cube schema →
// a dashboard panel routes engine=cube with values matching Postgres ground truth →
// flipping the measure to unverified falls back to engine=sql with identical values.

import { SignJWT } from 'jose'
import Database from 'better-sqlite3'
import pg from 'pg'

const BASE = 'http://127.0.0.1:3001'
const PGID = 'E8AFF7BB9DDE8A6E9A4C1F49A0EE0E4B'
const TABLE = 'plant.production_runs'
const FROM = '2025-10-01', TO = '2025-10-31'
const results = []
const rec = (name, pass, detail) => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`) }

// ---- 0. fix PG schema_name -> plant, clean slate (direct app DB) ----
const db = new Database('/data/mosaic.db')
db.prepare("UPDATE db_connections SET schema_name='plant' WHERE id=?").run(PGID)
try { db.prepare('DELETE FROM connection_schemas WHERE connection_id=?').run(PGID) } catch {}
db.prepare('DELETE FROM semantic_descriptions WHERE source_type=? AND source_id=?').run('database', PGID)
try { db.prepare('DELETE FROM semantic_sources WHERE source_type=? AND source_id=?').run('database', PGID) } catch {}
const admin = db.prepare("SELECT id,email,name,role FROM users WHERE role='admin' AND COALESCE(banned,0)=0 LIMIT 1").get()
db.close()
rec('admin user found', !!admin, admin ? admin.email : 'none')
rec('PG schema_name set to plant', true)

// ---- session ----
const raw = process.env.AUTH_SECRET
const secret = new TextEncoder().encode(raw.padEnd(32, raw).slice(0, 64))
const token = await new SignJWT({ id: admin.id, email: admin.email, name: admin.name, role: admin.role })
  .setProtectedHeader({ alg: 'HS256' }).setExpirationTime('7d').setIssuedAt().sign(secret)
const COOKIE = 'claude_session=' + token

async function api(path, body, method = 'POST') {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', Cookie: COOKIE }, body: body ? JSON.stringify(body) : undefined })
  const t = await r.text(); let j; try { j = JSON.parse(t) } catch { j = t }
  return { status: r.status, body: j }
}
async function get(path) { return api(path, null, 'GET') }

// ---- ground truth from Postgres (independent of the path under test) ----
const client = new pg.Client({ host: 'postgres', port: 5432, database: 'plant_ops', user: 'mosaic', password: 'mosaic_pw' })
await client.connect()
const gtRes = await client.query(
  `SELECT run_date::text AS d, sum(units_produced)::int AS v FROM plant.production_runs
   WHERE run_date >= $1 AND run_date <= $2 GROUP BY run_date ORDER BY run_date`, [FROM, TO])
await client.end()
const gt = gtRes.rows
const gtTotal = gt.reduce((s, r) => s + Number(r.v), 0)
const gtDays = gt.length
rec('ground truth computed', gtDays > 0, `${gtDays} days, total units=${gtTotal}`)

// ---- 1. introspect (records schema fingerprint). getOrFetchSchema refreshes in
//         the BACKGROUND on a cache miss, so poll until the schema lands. ----
let sawTable = false, draftKeys = []
for (let i = 0; i < 8 && !sawTable; i++) {
  const draft = await api('/api/semantic', { action: 'generate', source_type: 'database', source_id: PGID })
  draftKeys = Array.isArray(draft.body?.draft) ? draft.body.draft.map(d => d.object_key) : []
  sawTable = draftKeys.some(k => k.includes('production_runs'))
  if (!sawTable) await new Promise(r => setTimeout(r, 2500))
}
// one more draft once warm, to be sure the fingerprint is recorded from the full schema
await api('/api/semantic', { action: 'generate', source_type: 'database', source_id: PGID })
rec('introspect sees plant.production_runs', sawTable, `keys=${draftKeys.length}`)

// ---- 2. upsert a VERIFIED model (triggers resyncCubeModel → Cube schema) ----
const model = [
  { object_type: 'table', object_key: TABLE, description: 'Production runs by machine/shift' },
  { object_type: 'column', object_key: `${TABLE}.run_date`, description: 'run date', role: 'time', data_type: 'timestamp', time_grain: 'day', status: 'verified', confidence: 0.95 },
  { object_type: 'column', object_key: `${TABLE}.units_produced`, description: 'good units produced', role: 'measure', data_type: 'number', default_aggregation: 'sum', accumulation: 'raw', status: 'verified', confidence: 0.95 },
]
const up = await api('/api/semantic', { action: 'upsert', source_type: 'database', source_id: PGID, items: model })
rec('verified model upserted', up.status === 200 && up.body?.ok, `saved=${up.body?.saved}`)

// give resyncCubeModel (fire-and-forget) time to write the cube schema + Cube to reload
await new Promise(r => setTimeout(r, 6000))

// ---- 3. dashboard + panel ----
const cd = await api('/api/dashboards', { action: 'create_dashboard', name: 'Cube Test ' + Date.now(), default_time_window: 'custom' })
const dashId = cd.body?.id || cd.body?.dashboard?.id
rec('dashboard created', !!dashId, String(dashId))
const ap = await api('/api/dashboards', {
  action: 'add_panel', dashboard_id: dashId, title: 'Units by day', source_type: 'database', source_id: PGID,
  query: `SELECT run_date, units_produced FROM ${TABLE} WHERE run_date >= '${FROM}' AND run_date <= '${TO}'`,
  chart_type: 'line', chart_config: { x: 'run_date', y: 'units_produced', grain: '1d' },
})
rec('panel added', ap.status === 200, `status=${ap.status}`)

// ---- helper: pull the panel result + parity ----
function parity(res) {
  const r0 = (res.body?.results || [])[0] || {}
  const meta = r0.data?.meta || {}
  const rows = r0.data?.rows || []
  // extract the numeric y per row (units_produced-ish); fall back to last numeric field
  const yOf = (row) => {
    if (row && typeof row === 'object') {
      if ('units_produced' in row) return Number(row.units_produced)
      if ('y' in row) return Number(row.y)
      const nums = Object.values(row).filter(v => typeof v === 'number' || (!isNaN(Number(v)) && v !== null && v !== ''))
      return nums.length ? Number(nums[nums.length - 1]) : NaN
    }
    return NaN
  }
  const total = rows.reduce((s, row) => s + (yOf(row) || 0), 0)
  return { engine: meta.engine, reason: meta.engine_reason, used_pre_agg: meta.used_pre_agg, nrows: rows.length, total, sample: rows.slice(0, 3) }
}

// ---- 4. data: expect engine=cube + parity ----
const dUrl = `/api/dashboards/${dashId}/data?time_window=custom&time_from=${FROM}&time_to=${TO}&grain=1d`
const d1 = await get(dUrl)
const p1 = parity(d1)
console.log('  [verified] ' + JSON.stringify(p1))
rec('routes to Cube when verified', p1.engine === 'cube', `engine=${p1.engine} reason=${p1.reason || ''}`)
rec('Cube rows match ground truth (total)', Math.abs(p1.total - gtTotal) < 0.5, `cube=${p1.total} gt=${gtTotal}`)
rec('Cube day-bucket count matches', p1.nrows === gtDays, `cube=${p1.nrows} gt=${gtDays}`)

// ---- 5. flip measure to proposed → expect engine=sql fallback, same values ----
const flip = await api('/api/semantic', {
  action: 'upsert', source_type: 'database', source_id: PGID,
  items: [{ object_type: 'column', object_key: `${TABLE}.units_produced`, description: 'good units produced', role: 'measure', data_type: 'number', default_aggregation: 'sum', accumulation: 'raw', status: 'proposed', confidence: 0.5 }],
})
await new Promise(r => setTimeout(r, 3000))
const d2 = await get(dUrl)
const p2 = parity(d2)
console.log('  [unverified] ' + JSON.stringify(p2))
rec('falls back to SQL when unverified', p2.engine === 'sql', `engine=${p2.engine} reason=${p2.reason || ''}`)
rec('SQL rows match ground truth (total)', Math.abs(p2.total - gtTotal) < 0.5, `sql=${p2.total} gt=${gtTotal}`)

// ---- cleanup ----
await api('/api/dashboards', { action: 'delete_dashboard', id: dashId })
await api('/api/semantic', { action: 'delete', source_type: 'database', source_id: PGID, all: true })

const passed = results.filter(r => r.pass).length
console.log(`\n==== ${passed}/${results.length} checks passed ====`)
process.exit(passed === results.length ? 0 : 1)
