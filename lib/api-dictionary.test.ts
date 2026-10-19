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
  it('non-object / empty inputs', () => {
    expect(extractApiRecords(null)).toEqual([])
    expect(extractApiRecords('text')).toEqual([])
    expect(extractApiRecords(42)).toEqual([])
    expect(extractApiRecords([])).toEqual([])
  })
  it('array of scalars is not records', () => {
    expect(extractApiRecords([1, 2, 3])).toEqual([])
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
