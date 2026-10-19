import { describe, it, expect } from 'vitest'
import {
  readonlyGuard, withPreviewLimit, classifyPanelResult,
  validatePanelShape, validatePlan, substituteTimeWindow, PREVIEW_ROW_CAP, MAX_PANELS,
  parsePrismQuery, applyPrismWindow, prismSeriesToRows,
  type PanelPlan,
} from './dashboard-plan'

describe('substituteTimeWindow', () => {
  const w = { time_from: '2026-09-19T00:00:00.000Z', time_to: '2026-10-19T00:00:00.000Z', interval: '1 day' }
  it('injects quoted timestamps for an unquoted placeholder', () => {
    expect(substituteTimeWindow('SELECT * FROM t WHERE ts >= {{time_from}} AND ts <= {{time_to}}', w))
      .toBe(`SELECT * FROM t WHERE ts >= '2026-09-19T00:00:00.000Z' AND ts <= '2026-10-19T00:00:00.000Z'`)
  })
  it('absorbs quotes the author already wrote (no double-quoting)', () => {
    expect(substituteTimeWindow("WHERE ts >= '{{time_from}}'", w))
      .toBe(`WHERE ts >= '2026-09-19T00:00:00.000Z'`)
  })
  it('substitutes interval unquoted', () => {
    expect(substituteTimeWindow('GROUP BY {{interval}}', w)).toBe('GROUP BY 1 day')
  })
  it('leaves a query with no placeholders unchanged', () => {
    expect(substituteTimeWindow('SELECT 1', w)).toBe('SELECT 1')
  })
})

describe('readonlyGuard', () => {
  it('allows SELECT / WITH / EXPLAIN', () => {
    expect(readonlyGuard('SELECT * FROM t', 'postgres').ok).toBe(true)
    expect(readonlyGuard('  with x as (select 1) select * from x', 'postgres').ok).toBe(true)
    expect(readonlyGuard('EXPLAIN SELECT 1', 'postgres').ok).toBe(true)
  })
  it('rejects writes and DDL', () => {
    for (const q of ['INSERT INTO t VALUES (1)', 'UPDATE t SET a=1', 'DELETE FROM t', 'DROP TABLE t', 'TRUNCATE t', 'ALTER TABLE t ADD c int']) {
      expect(readonlyGuard(q, 'postgres').ok).toBe(false)
    }
  })
  it('rejects stacked statements', () => {
    const r = readonlyGuard('SELECT * FROM t; DROP TABLE users', 'postgres')
    expect(r.ok).toBe(false); expect(r.reason).toMatch(/multiple statements/)
  })
  it('allows a single trailing semicolon', () => {
    expect(readonlyGuard('SELECT 1;', 'postgres').ok).toBe(true)
  })
  it('honours dialect extras (sqlite PRAGMA, mysql SHOW) and rejects elsewhere', () => {
    expect(readonlyGuard('PRAGMA table_info(t)', 'sqlite').ok).toBe(true)
    expect(readonlyGuard('PRAGMA table_info(t)', 'postgres').ok).toBe(false)
    expect(readonlyGuard('SHOW TABLES', 'mysql').ok).toBe(true)
  })
  it('defers non-SQL stores to runtime (no false reject)', () => {
    expect(readonlyGuard('{"query":{"match_all":{}}}', 'elasticsearch').ok).toBe(true)
  })
  it('rejects empty', () => {
    expect(readonlyGuard('   ', 'postgres').ok).toBe(false)
  })
})

describe('withPreviewLimit', () => {
  it('appends LIMIT when absent (postgres/mysql/sqlite)', () => {
    expect(withPreviewLimit('SELECT * FROM t', 'postgres')).toBe(`SELECT * FROM t LIMIT ${PREVIEW_ROW_CAP}`)
    expect(withPreviewLimit('SELECT * FROM t;', 'sqlite')).toBe(`SELECT * FROM t LIMIT ${PREVIEW_ROW_CAP}`)
  })
  it('clamps an existing larger LIMIT but keeps a smaller one', () => {
    expect(withPreviewLimit('SELECT * FROM t LIMIT 10000', 'postgres')).toBe(`SELECT * FROM t LIMIT ${PREVIEW_ROW_CAP}`)
    expect(withPreviewLimit('SELECT * FROM t LIMIT 5', 'postgres')).toBe('SELECT * FROM t LIMIT 5')
  })
  it('injects TOP for mssql', () => {
    expect(withPreviewLimit('SELECT a, b FROM t', 'mssql')).toBe(`SELECT TOP ${PREVIEW_ROW_CAP} a, b FROM t`)
    expect(withPreviewLimit('select distinct a from t', 'mssql')).toBe(`select distinct TOP ${PREVIEW_ROW_CAP} a from t`)
    expect(withPreviewLimit('SELECT TOP 5 a FROM t', 'mssql')).toBe('SELECT TOP 5 a FROM t')
  })
  it('is a no-op for influxdb', () => {
    expect(withPreviewLimit('SELECT mean(v) FROM m', 'influxdb')).toBe('SELECT mean(v) FROM m')
  })
})

describe('classifyPanelResult', () => {
  it('error wins', () => {
    expect(classifyPanelResult(null, 'boom').cls).toBe('error')
  })
  it('rows present -> data', () => {
    const r = classifyPanelResult({ rows: [{ a: 1 }, { a: 2 }] })
    expect(r.cls).toBe('data'); expect(r.rows).toBe(2)
  })
  it('empty rows -> empty', () => {
    expect(classifyPanelResult({ rows: [] }).cls).toBe('empty')
  })
  it('bare array works', () => {
    expect(classifyPanelResult([{ x: 1 }]).cls).toBe('data')
  })
  it('records / data keys recognised', () => {
    expect(classifyPanelResult({ records: [{ a: 1 }] }).cls).toBe('data')
    expect(classifyPanelResult({ data: [] }).cls).toBe('empty')
  })
})

const goodPanel: PanelPlan = {
  title: 'Daily generation', source_type: 'database', source_id: 'conn-1',
  query: 'SELECT shift_date, SUM(kwh) FROM gen GROUP BY 1', chart_type: 'line',
}

describe('validatePanelShape', () => {
  it('passes a well-formed panel', () => {
    expect(validatePanelShape(goodPanel).ok).toBe(true)
  })
  it('flags each missing/invalid field', () => {
    const r = validatePanelShape({ ...goodPanel, title: '', chart_type: 'pie' as never, source_type: 'nosql' as never })
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/title/)
    expect(r.errors.join(' ')).toMatch(/chart_type/)
    expect(r.errors.join(' ')).toMatch(/source_type/)
  })
})

describe('validatePlan', () => {
  it('passes a plan with valid panels', () => {
    const r = validatePlan({ title: 'Plant', panels: [goodPanel, { ...goodPanel, title: 'Avail', chart_type: 'bar' }] })
    expect(r.ok).toBe(true); expect(r.panels.every(p => p.ok)).toBe(true)
  })
  it('fails when a panel is malformed', () => {
    const r = validatePlan({ title: 'Plant', panels: [goodPanel, { ...goodPanel, query: '' }] })
    expect(r.ok).toBe(false); expect(r.panels[1].ok).toBe(false)
  })
  it('fails on no title or no panels', () => {
    expect(validatePlan({ title: '', panels: [goodPanel] }).ok).toBe(false)
    expect(validatePlan({ title: 'X', panels: [] }).ok).toBe(false)
  })
  it('rejects more than MAX_PANELS', () => {
    const many = Array.from({ length: MAX_PANELS + 3 }, (_, i) => ({ ...goodPanel, title: 'p' + i }))
    const r = validatePlan({ title: 'X', panels: many })
    expect(r.ok).toBe(false); expect(r.errors.join(' ')).toMatch(/too many panels/)
  })
})

describe('parsePrismQuery', () => {
  it('accepts a valid JSON params object with an operation', () => {
    const r = parsePrismQuery('{"operation":"telemetry_history","entity_id":"d1","keys":["kWh"]}')
    expect(r.ok).toBe(true); expect(r.params!.operation).toBe('telemetry_history')
  })
  it('rejects non-JSON', () => {
    const r = parsePrismQuery('SELECT * FROM t')
    expect(r.ok).toBe(false); expect(r.error).toMatch(/valid JSON/)
  })
  it('rejects a JSON array or scalar', () => {
    expect(parsePrismQuery('[1,2]').ok).toBe(false)
    expect(parsePrismQuery('42').ok).toBe(false)
  })
  it('rejects an object with no operation', () => {
    const r = parsePrismQuery('{"entity_id":"d1"}')
    expect(r.ok).toBe(false); expect(r.error).toMatch(/operation/)
  })
  it('accepts an already-parsed object (SQLite JSON auto-parse / any driver)', () => {
    const r = parsePrismQuery({ operation: 'telemetry_latest', entity_id: 'd1', keys: ['kW'] })
    expect(r.ok).toBe(true); expect(r.params!.operation).toBe('telemetry_latest')
  })
  it('rejects a parsed array or scalar object-input', () => {
    expect(parsePrismQuery([1, 2]).ok).toBe(false)
    expect(parsePrismQuery(42).ok).toBe(false)
    expect(parsePrismQuery(null).ok).toBe(false)
  })
})

describe('applyPrismWindow', () => {
  const w = { time_from: '2026-10-01T00:00:00.000Z', time_to: '2026-10-02T00:00:00.000Z' }
  it('injects epoch-ms startTs/endTs for a time-series op', () => {
    const out = applyPrismWindow({ operation: 'telemetry_history', entity_id: 'd1', keys: ['kWh'] }, w)
    expect(out.startTs).toBe(Date.parse(w.time_from))
    expect(out.endTs).toBe(Date.parse(w.time_to))
  })
  it('does NOT inject a window for telemetry_latest', () => {
    const out = applyPrismWindow({ operation: 'telemetry_latest', entity_id: 'd1', keys: ['kW'] }, w)
    expect(out.startTs).toBeUndefined(); expect(out.endTs).toBeUndefined()
  })
  it('never mutates the input object', () => {
    const input = { operation: 'telemetry_history', entity_id: 'd1' }
    applyPrismWindow(input, w)
    expect('startTs' in input).toBe(false)
  })
})

describe('prismSeriesToRows', () => {
  it('merges a telemetry_history series into ts-sorted rows, coercing numeric strings', () => {
    const result = { series: { kWh: [{ ts: 2000, value: '5.5' }, { ts: 1000, value: '3' }], kW: [{ ts: 1000, value: '1.2' }] } }
    const rows = prismSeriesToRows(result) as Array<Record<string, unknown>>
    expect(rows).toHaveLength(2)
    expect(rows[0].ts).toBe(new Date(1000).toISOString())  // sorted ascending
    expect(rows[0].kWh).toBe(3); expect(rows[0].kW).toBe(1.2)
    expect(rows[1].kWh).toBe(5.5)
  })
  it('turns telemetry_latest into a single row', () => {
    const rows = prismSeriesToRows({ telemetry: { kW: { ts: 1, value: '0.0' }, status: { value: 'run' } } }) as Array<Record<string, unknown>>
    expect(rows).toHaveLength(1)
    expect(rows[0].kW).toBe(0); expect(rows[0].status).toBe('run')
  })
  it('passes through array-shaped results (devices/assets)', () => {
    expect(prismSeriesToRows({ devices: [{ id: 'd1' }] })).toEqual([{ id: 'd1' }])
  })
  it('returns [] for an unrecognised / empty shape', () => {
    expect(prismSeriesToRows(null)).toEqual([])
    expect(prismSeriesToRows({ foo: 1 })).toEqual([])
  })
})

describe('validatePanelShape — prism', () => {
  const base: PanelPlan = { title: 'Energy', source_type: 'prism', source_id: 'inst1', query: '{"operation":"telemetry_latest","entity_id":"d1","keys":["kW"]}', chart_type: 'stat' }
  it('accepts a well-formed prism panel', () => {
    expect(validatePanelShape(base).ok).toBe(true)
  })
  it('rejects a prism panel whose query is not JSON params', () => {
    const r = validatePanelShape({ ...base, query: 'SELECT 1' })
    expect(r.ok).toBe(false); expect(r.errors.join(' ')).toMatch(/JSON/)
  })
})
