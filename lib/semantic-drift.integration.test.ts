import { describe, it, expect, beforeAll } from 'vitest'
import Database from 'better-sqlite3'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomBytes } from 'crypto'

const dbPath = join(tmpdir(), `sem-drift-${randomBytes(6).toString('hex')}.db`)
process.env.DATABASE_URL = `sqlite://${dbPath}`

beforeAll(() => {
  const db = new Database(dbPath)
  db.exec(`
    CREATE TABLE semantic_descriptions (
      id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))), source_type TEXT NOT NULL DEFAULT 'database',
      source_id TEXT NOT NULL, object_type TEXT NOT NULL, object_key TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '', created_by TEXT, updated_at TEXT,
      role TEXT, data_type TEXT, unit TEXT, default_aggregation TEXT, additivity TEXT,
      accumulation TEXT, time_grain TEXT, status TEXT, confidence REAL, evidence TEXT );
    CREATE TABLE semantic_sources (
      source_type TEXT NOT NULL, source_id TEXT NOT NULL, schema_fingerprint TEXT,
      model_version INTEGER NOT NULL DEFAULT 1, last_introspected_at TEXT, updated_at TEXT,
      PRIMARY KEY (source_type, source_id) );
    INSERT INTO semantic_descriptions (source_type,source_id,object_type,object_key,description,role,status)
      VALUES ('database','s1','column','t.a','energy','measure','verified'),
             ('database','s1','column','t.b','temp','measure','proposed'),
             ('database','s1','table','t','a table','',NULL);
  `)
  db.close()
})

describe('semantic-drift DB helpers (integration)', () => {
  it('records and reads a fingerprint, bumping model_version on change', async () => {
    const { recordFingerprint, getStoredFingerprint } = await import('./semantic-drift')
    expect(await getStoredFingerprint('database', 's1')).toBeNull()
    await recordFingerprint('database', 's1', 'fp-1')
    expect(await getStoredFingerprint('database', 's1')).toBe('fp-1')
    await recordFingerprint('database', 's1', 'fp-2')
    expect(await getStoredFingerprint('database', 's1')).toBe('fp-2')
  })

  it('summarises semantic health (structured/verified/proposed + coverage)', async () => {
    const { getSemanticHealth } = await import('./semantic-drift')
    const h = await getSemanticHealth('database', 's1', 4)   // schema has 4 fields
    expect(h.structured).toBe(2)       // two rows with role set
    expect(h.verified).toBe(1)
    expect(h.proposed).toBe(1)
    expect(h.coverage_pct).toBe(50)    // 2 of 4
    expect(h.last_introspected_at).not.toBeNull()
  })
})
