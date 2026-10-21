import { describe, it, expect } from 'vitest'
import {
  hasEntityPlaceholder, parseEntitySelection, substituteEntityQuery,
  applyPrismEntity, prismNeedsEntity, tagEntityRows, mergeEntityRows, SERIES_KEY,
} from './dashboard-entity'

describe('dashboard-entity: placeholder detection', () => {
  it('detects {{entity_id}} / {{entity}}', () => {
    expect(hasEntityPlaceholder('SELECT * FROM t WHERE d = {{entity_id}}')).toBe(true)
    expect(hasEntityPlaceholder('/odata/X?dev={{entity}}')).toBe(true)
    expect(hasEntityPlaceholder('SELECT * FROM t')).toBe(false)
    expect(hasEntityPlaceholder(null)).toBe(false)
  })
})

describe('dashboard-entity: parseEntitySelection', () => {
  it('splits, trims, dedupes, caps', () => {
    expect(parseEntitySelection('a, b ,a,c')).toEqual(['a', 'b', 'c'])
    expect(parseEntitySelection('')).toEqual([])
    expect(parseEntitySelection('1,2,3,4,5,6,7,8,9,10', 3)).toEqual(['1', '2', '3'])
  })
})

describe('dashboard-entity: SQL substitution', () => {
  it('injects a quoted literal for both bare and quoted placeholders', () => {
    expect(substituteEntityQuery("SELECT * FROM t WHERE d = {{entity_id}}", 'database', 'dev-1'))
      .toBe("SELECT * FROM t WHERE d = 'dev-1'")
    expect(substituteEntityQuery("SELECT * FROM t WHERE d = '{{entity_id}}'", 'database', 'dev-1'))
      .toBe("SELECT * FROM t WHERE d = 'dev-1'")
  })
  it('escapes single quotes in the id', () => {
    expect(substituteEntityQuery("WHERE d = {{entity_id}}", 'database', "a'b"))
      .toBe("WHERE d = 'a''b'")
  })
})

describe('dashboard-entity: API substitution', () => {
  it('url-encodes the id into the path', () => {
    expect(substituteEntityQuery('/odata/Report?dev={{entity_id}}', 'api', 'a b/c'))
      .toBe('/odata/Report?dev=a%20b%2Fc')
  })
})

describe('dashboard-entity: PRISM params', () => {
  it('sets entity_id and reports need', () => {
    expect(applyPrismEntity({ operation: 'telemetry_history', entity_id: '{{entity_id}}' }, 'dev-9').entity_id).toBe('dev-9')
    expect(prismNeedsEntity({ operation: 'x', entity_id: '{{entity_id}}' })).toBe(true)
    expect(prismNeedsEntity({ operation: 'x' })).toBe(true)
    expect(prismNeedsEntity({ operation: 'x', entity_id: 'real-uuid' })).toBe(false)
  })
})

describe('dashboard-entity: overlay tagging + merge', () => {
  it('tags rows with the series key and merges parts in order', () => {
    const a = tagEntityRows([{ ts: 1, v: 10 }], 'Dev A')
    const b = tagEntityRows([{ ts: 1, v: 20 }], 'Dev B')
    expect(a[0][SERIES_KEY]).toBe('Dev A')
    expect(mergeEntityRows([a, b])).toEqual([
      { ts: 1, v: 10, [SERIES_KEY]: 'Dev A' },
      { ts: 1, v: 20, [SERIES_KEY]: 'Dev B' },
    ])
  })
})
