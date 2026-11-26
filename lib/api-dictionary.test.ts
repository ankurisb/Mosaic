import { describe, it, expect } from 'vitest'
import { extractApiRecords, collectApiFields, isApiMetaField } from './api-dictionary'

describe('extractApiRecords — envelope variety', () => {
  it('bare array of objects', () => {
    expect(extractApiRecords([{ a: 1 }, { a: 2 }])).toHaveLength(2)
  })
  it('OData V4 {value:[]}', () => {
    expect(extractApiRecords({ '@odata.context': 'x', value: [{ a: 1 }] })).toEqual([{ a: 1 }])
  })
  it('OData V2 {d:{results:[]}}', () => {
    expect(extractApiRecords({ d: { results: [{ a: 1 }, { a: 2 }] } })).toHaveLength(2)
  })
  it('OData V2 single entity {d:{...}}', () => {
    expect(extractApiRecords({ d: { Material: 'M1' } })).toEqual([{ Material: 'M1' }])
  })
  it('{data:[]} cap envelope', () => {
    expect(extractApiRecords({ _capped: true, _total: 999, data: [{ a: 1 }] })).toEqual([{ a: 1 }])
  })
  it('arbitrary array-of-objects property (e.g. {invoices:[]})', () => {
    expect(extractApiRecords({ invoices: [{ id: 1 }] })).toEqual([{ id: 1 }])
  })
  it('single plain object', () => {
    expect(extractApiRecords({ id: 1, name: 'x' })).toEqual([{ id: 1, name: 'x' }])
  })
  it('FactoryOS envelope: data is a JSON STRING wrapping {records:[…],pagination}', () => {
    const body = { status: true, message: 'Fetched', data: JSON.stringify({ records: [{ id: 1, title: 'A' }, { id: 2, title: 'B' }], page: 1, total_pages: 3 }) }
    const recs = extractApiRecords(body)
    expect(recs).toHaveLength(2)
    expect(recs[0]).toEqual({ id: 1, title: 'A' })   // the records, not status/message/data
  })
  it('envelope with data as a direct array', () => {
    expect(extractApiRecords({ status: true, data: [{ a: 1 }] })).toEqual([{ a: 1 }])
  })
  it('envelope with a single record object under data', () => {
    expect(extractApiRecords({ success: true, data: { id: 9, name: 'z' } })).toEqual([{ id: 9, name: 'z' }])
  })
  it('bare envelope with no records → [] (does not describe the wrapper)', () => {
    expect(extractApiRecords({ status: false, message: 'no access' })).toEqual([])
  })
  it('a genuine record that merely has a data field is NOT treated as an envelope', () => {
    // No status/message/pagination sibling → stays a single record.
    expect(extractApiRecords({ id: 1, data: { nested: true } })).toEqual([{ id: 1, data: { nested: true } }])
  })
  it('non-object / empty inputs', () => {
    expect(extractApiRecords(null)).toEqual([])
    expect(extractApiRecords('text')).toEqual([])
    expect(extractApiRecords(42)).toEqual([])
    expect(extractApiRecords([])).toEqual([])
  })
  it('array of scalars is not records', () => {
    expect(extractApiRecords([1, 2, 3])).toEqual([])
  })
  it('prefers a nested paginated envelope over a sibling decoy array', () => {
    // FactoryOS-shape: the real rows are under summaries.results, alongside
    // top-level companies/plants lists. The old greedy auto-detect grabbed
    // `companies` (first top-level array). Must now return summaries.results.
    const body = {
      companies: [{ id: 1, name: 'ACME' }],
      plants: [{ id: 7, name: 'Plant 1' }],
      summaries: {
        count: 3, next: null,
        results: [{ machine: 'M1', oee: 72 }, { machine: 'M2', oee: 81 }, { machine: 'M3', oee: 65 }],
      },
      show_production_values: true,
    }
    const recs = extractApiRecords(body)
    expect(recs).toHaveLength(3)
    expect(recs[0]).toEqual({ machine: 'M1', oee: 72 })
  })
})

describe('isApiMetaField', () => {
  it('flags OData/transport noise, keeps business fields', () => {
    expect(isApiMetaField('__metadata')).toBe(true)
    expect(isApiMetaField('@odata.etag')).toBe(true)
    expect(isApiMetaField('uri')).toBe(true)
    expect(isApiMetaField('_capped')).toBe(true)
    expect(isApiMetaField('OrderQuantity')).toBe(false)
    expect(isApiMetaField('id')).toBe(false)
  })
})

describe('collectApiFields', () => {
  it('unions fields across records, drops metadata, compacts nested values', () => {
    const recs = [
      { __metadata: { uri: 'x' }, OrderID: '1', Plant: '1000', Items: [{ m: 'a' }] },
      { OrderID: '2', Status: 'REL' },
    ]
    const { fields, sampleRow } = collectApiFields(recs)
    expect(fields).toContain('OrderID')
    expect(fields).toContain('Plant')
    expect(fields).toContain('Status')
    expect(fields).not.toContain('__metadata')
    expect(typeof sampleRow.Items).toBe('string')  // nested compacted to a string
  })
  it('prefers a non-null sample value when the first record has null', () => {
    const { sampleRow } = collectApiFields([{ temp: null }, { temp: 42 }])
    expect(sampleRow.temp).toBe(42)
  })
  it('caps field count', () => {
    const rec: Record<string, unknown> = {}
    for (let i = 0; i < 200; i++) rec['f' + i] = i
    expect(collectApiFields([rec], 50).fields).toHaveLength(50)
  })
})
