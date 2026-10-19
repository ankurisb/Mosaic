import { describe, it, expect } from 'vitest'
import {
  readonlyGuard, withPreviewLimit, classifyPanelResult,
  validatePanelShape, validatePlan, substituteTimeWindow, PREVIEW_ROW_CAP, MAX_PANELS,
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
