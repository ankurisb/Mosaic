import { describe, it, expect } from 'vitest'
import { computeFingerprint, diffSchema } from './semantic-drift'

describe('computeFingerprint', () => {
  it('is order-independent and type-sensitive', () => {
    const a = computeFingerprint([{ object_key: 'x', data_type: 'number' }, { object_key: 'y', data_type: 'string' }])
    const b = computeFingerprint([{ object_key: 'y', data_type: 'string' }, { object_key: 'x', data_type: 'number' }])
    expect(a).toBe(b)
    const c = computeFingerprint([{ object_key: 'x', data_type: 'string' }, { object_key: 'y', data_type: 'string' }])
    expect(a).not.toBe(c)
  })
})

describe('diffSchema', () => {
  it('reports added / removed / retyped', () => {
    const prev = [{ object_key: 'a', data_type: 'number' }, { object_key: 'b', data_type: 'string' }, { object_key: 'c', data_type: 'number' }]
    const cur = [{ object_key: 'a', data_type: 'number' }, { object_key: 'b', data_type: 'number' }, { object_key: 'd', data_type: 'string' }]
    const d = diffSchema(prev, cur)
    expect(d.added).toEqual(['d'])
    expect(d.removed).toEqual(['c'])
    expect(d.retyped).toEqual(['b'])
    expect(d.changed).toBe(true)
  })
  it('no change → changed=false', () => {
    const s = [{ object_key: 'a', data_type: 'number' }]
    expect(diffSchema(s, s).changed).toBe(false)
  })
})
