import { describe, it, expect, beforeAll } from 'vitest'
import Database from 'better-sqlite3'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomBytes } from 'crypto'

// Point the app DB layer at a throwaway sqlite file BEFORE importing the module
// under test (getDb reads DATABASE_URL lazily). This exercises the real SQL in
// getSemanticModel against the real migrated schema (018 + 021).
const dbPath = join(tmpdir(), `sem-model-${randomBytes(6).toString('hex')}.db`)
process.env.DATABASE_URL = `sqlite://${dbPath}`

beforeAll(() => {
  const db = new Database(dbPath)
  // Schema as migrations 018 + 021 leave it.
  db.exec(`
    CREATE TABLE semantic_descriptions (
      id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
      source_type TEXT NOT NULL DEFAULT 'database',
      source_id TEXT NOT NULL,
      object_type TEXT NOT NULL,
      object_key TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_by TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      role TEXT, data_type TEXT, unit TEXT, default_aggregation TEXT,
      additivity TEXT, accumulation TEXT, time_grain TEXT,
      status TEXT, confidence REAL, evidence TEXT
    );
  `)
  const ins = db.prepare(`INSERT INTO semantic_descriptions
    (source_type, source_id, object_type, object_key, description, role, data_type, unit, default_aggregation, accumulation, status, confidence)
    VALUES (@st,@sid,@ot,@ok,@d,@role,@dt,@unit,@agg,@acc,@status,@conf)`)
  // A verified cumulative measure, a proposed measure, a time dim, and a legacy
  // description-only row (role NULL — must be excluded from the structured model).
  ins.run({ st:'database', sid:'src1', ot:'column', ok:'meter.energy_kwh', d:'cumulative energy', role:'measure', dt:'number', unit:'kWh', agg:'sum', acc:'cumulative_counter', status:'verified', conf:0.9 })
  ins.run({ st:'database', sid:'src1', ot:'column', ok:'meter.temp_c', d:'temperature', role:'measure', dt:'number', unit:'°C', agg:'avg', acc:'raw', status:'proposed', conf:0.5 })
  ins.run({ st:'database', sid:'src1', ot:'column', ok:'meter.ts', d:'timestamp', role:'time', dt:'timestamp', unit:null, agg:null, acc:null, status:'verified', conf:0.9 })
  ins.run({ st:'database', sid:'src1', ot:'table', ok:'meter', d:'a legacy description only', role:null, dt:null, unit:null, agg:null, acc:null, status:null, conf:null })
  // A different source — must not leak in.
  ins.run({ st:'database', sid:'other', ot:'column', ok:'x.y', d:'other', role:'measure', dt:'number', unit:'u', agg:'sum', acc:'raw', status:'verified', conf:1 })
  db.close()
})

describe('getSemanticModel (integration, real sqlite)', () => {
  it('loads only structured rows for the source and drives the executor', async () => {
    const { getSemanticModel, applySemanticModel } = await import('./semantic-model')
    const model = await getSemanticModel('database', 'src1')
    // 3 structured rows (role set); legacy description-only row excluded; other source excluded.
    expect(model.byKey.size).toBe(3)
    expect(model.byColumn.get('energy_kwh')?.accumulation).toBe('cumulative_counter')
    expect(model.byColumn.get('temp_c')?.status).toBe('proposed')
    expect(model.byKey.has('x.y')).toBe(false)

    // End-to-end: a cumulative energy series is delta'd, unit surfaced.
    const rows = [{ ts: 't1', energy_kwh: 1000 }, { ts: 't2', energy_kwh: 1300 }, { ts: 't3', energy_kwh: 1500 }]
    const r = applySemanticModel(rows, model, { chartType: 'line', chartConfig: { x: 'ts', y: 'energy_kwh' } })
    expect(r.rows.map(x => x.energy_kwh)).toEqual([0, 300, 200])
    expect(r.meta.units.energy_kwh).toBe('kWh')
  })
})
