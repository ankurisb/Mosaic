import { describe, it, expect } from 'vitest'
import { extractRows } from './condition-eval'

describe('extractRows — shape handling', () => {
  // --- Existing shapes, behaviour must be identical with and without apiEnvelope ---
  it('bare array of objects', () => {
    expect(extractRows([{ a: 1 }, { a: 2 }])).toHaveLength(2)
  })
  it('standard wrapper key {results:[…]}', () => {
    expect(extractRows({ results: [{ a: 1 }] })).toEqual([{ a: 1 }])
  })
  it('OData {d:{results:[…]}}', () => {
    expect(extractRows({ d: { results: [{ a: 1 }, { a: 2 }] } })).toHaveLength(2)
  })
  it('database {rows:[…]} unwraps via wrapper key', () => {
    expect(extractRows({ rows: [{ oee: 80 }, { oee: 90 }] })).toHaveLength(2)
  })
  it('flat single object becomes one row', () => {
    expect(extractRows({ oee: 80, machine: 'M1' })).toEqual([{ oee: 80, machine: 'M1' }])
  })
  it('bare scalar becomes a synthetic one-row object', () => {
    expect(extractRows(42)).toEqual([{ value: 42 }])
  })

  // --- Tier 2b: nested non-standard wrapper, API responses only ---
  it('API: prefers a nested paginated envelope over the whole object', () => {
    // FactoryOS shape: real rows under summaries.results, alongside decoy top-level arrays.
    const body = {
      companies: [{ id: 1 }],
      plants: [{ id: 7 }],
      summaries: { count: 2, results: [{ machine: 'M1', oee: 81 }, { machine: 'M2', oee: 72 }] },
      show_production_values: true,
    }
    const rows = extractRows(body, undefined, true)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({ machine: 'M1', oee: 81 })
  })

  // --- The safety guarantee for database / file-server / MCP (flag OFF) ---
  it('WITHOUT the flag, the nested envelope is NOT unwrapped (DB/file/MCP unchanged)', () => {
    const body = {
      companies: [{ id: 1 }],
      summaries: { results: [{ machine: 'M1', oee: 81 }] },
    }
    // Same input, flag off → returns the whole object as a single row, exactly as before.
    expect(extractRows(body)).toEqual([body])
    expect(extractRows(body, undefined, false)).toEqual([body])
  })
  it('a DB row with an array-valued column is still one row when flag is off', () => {
    const dbRow = { id: 5, name: 'Line A', tags: [{ k: 'v' }] }
    expect(extractRows(dbRow)).toEqual([dbRow])
  })
  it('explicit dataPath still wins and ignores the apiEnvelope step', () => {
    const body = { payload: { items: [{ x: 1 }] }, summaries: { results: [{ y: 2 }] } }
    expect(extractRows(body, 'payload.items', true)).toEqual([{ x: 1 }])
  })
})
