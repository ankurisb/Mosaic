// Cube 400 diagnostic: re-establish a verified model on plant.production_runs,
// dump the generated cube schema, and query Cube's /meta and /load directly to
// capture the exact error. Runs inside the mosaic container. Leaves the model in
// place for inspection (no cleanup).
import { SignJWT } from 'jose'
import Database from 'better-sqlite3'
import fs from 'fs'

const BASE = 'http://127.0.0.1:3001'
const PGID = 'E8AFF7BB9DDE8A6E9A4C1F49A0EE0E4B'
const TABLE = 'plant.production_runs'
const FROM = '2025-10-01', TO = '2025-10-31'

const db = new Database('/data/mosaic.db')
db.prepare("UPDATE db_connections SET schema_name='plant' WHERE id=?").run(PGID)
try { db.prepare('DELETE FROM connection_schemas WHERE connection_id=?').run(PGID) } catch {}
db.prepare('DELETE FROM semantic_descriptions WHERE source_type=? AND source_id=?').run('database', PGID)
const admin = db.prepare("SELECT id,email,name,role FROM users WHERE role='admin' LIMIT 1").get()
db.close()

const raw = process.env.AUTH_SECRET
const secret = new TextEncoder().encode(raw.padEnd(32, raw).slice(0, 64))
const token = await new SignJWT({ id: admin.id, email: admin.email, name: admin.name, role: admin.role }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('7d').setIssuedAt().sign(secret)
const COOKIE = 'claude_session=' + token
const api = async (p, b, m = 'POST') => { const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', Cookie: COOKIE }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); let j; try { j = JSON.parse(t) } catch { j = t } return { status: r.status, body: j } }

let saw = false
for (let i = 0; i < 8 && !saw; i++) { const d = await api('/api/semantic', { action: 'generate', source_type: 'database', source_id: PGID }); const ks = Array.isArray(d.body?.draft) ? d.body.draft.map(x => x.object_key) : []; saw = ks.some(k => k.includes('production_runs')); if (!saw) await new Promise(r => setTimeout(r, 2500)) }
console.log('introspect saw table:', saw)
const up = await api('/api/semantic', { action: 'upsert', source_type: 'database', source_id: PGID, items: [
  { object_type: 'table', object_key: TABLE, description: 'runs' },
  { object_type: 'column', object_key: TABLE + '.run_date', role: 'time', data_type: 'timestamp', time_grain: 'day', status: 'verified', confidence: 0.95 },
  { object_type: 'column', object_key: TABLE + '.units_produced', role: 'measure', data_type: 'number', default_aggregation: 'sum', accumulation: 'raw', status: 'verified', confidence: 0.95 },
]})
console.log('upsert:', up.status, JSON.stringify(up.body))
await new Promise(r => setTimeout(r, 8000))

const dir = '/cube-model'
const files = fs.readdirSync(dir)
console.log('cube-model files:', files)
for (const f of files.filter(f => f.endsWith('.js'))) {
  console.log(`\n--- ${f} ---\n` + fs.readFileSync(dir + '/' + f, 'utf8'))
}

const csec = process.env.CUBEJS_API_SECRET || raw
const ckey = new TextEncoder().encode(csec)
const ctoken = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('10m').sign(ckey)
const cube = async (p, b, m = 'GET') => { const r = await fetch('http://cube:4000' + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: ctoken }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); let j; try { j = JSON.parse(t) } catch { j = t } return { status: r.status, body: j } }

const meta = await cube('/cubejs-api/v1/meta')
console.log('\nCUBE /meta status:', meta.status)
const cubes = (meta.body?.cubes || [])
console.log('compiled cubes:', cubes.map(c => c.name))
if (typeof meta.body === 'string') console.log('meta raw:', meta.body.slice(0, 800))
const mc = cubes.find(c => /production_runs/i.test(c.name)) || cubes[0]
if (mc) {
  const measures = (mc.measures || []).map(m => m.name)
  const dims = (mc.dimensions || []).map(d => d.name)
  console.log('cube:', mc.name, '\n  measures:', measures, '\n  dims:', dims)
  const meas = measures.find(m => /units/i.test(m)) || measures[0]
  const tdim = dims.find(d => /run_date/i.test(d)) || dims.find(d => /date|time|ts/i.test(d))
  const q = { measures: [meas], timeDimensions: [{ dimension: tdim, granularity: 'day', dateRange: [FROM, TO] }] }
  console.log('\nLOAD query:', JSON.stringify(q))
  const load = await cube('/cubejs-api/v1/load', q, 'POST')
  console.log('LOAD status:', load.status)
  console.log('LOAD body:', JSON.stringify(load.body).slice(0, 1200))
}
