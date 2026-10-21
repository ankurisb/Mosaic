import { describe, it, expect } from 'vitest'
import { parseStructuredDraft, partitionByConfidence, extractJson } from './describe-structured'

describe('describe-structured: parseStructuredDraft (pure)', () => {
  it('validates enums, clamps confidence, marks proposed', () => {
    const items = parseStructuredDraft([
      { object_key: 'p.energy', role: 'measure', data_type: 'number', unit: 'kWh', default_aggregation: 'sum', accumulation: 'cumulative_counter', description: 'meter', confidence: 0.91, evidence: 'name kWh + rising samples' },
      { object_key: 'p.oee', role: 'measure', data_type: 'number', unit: '%', default_aggregation: 'avg', accumulation: 'raw', description: 'oee', confidence: 1.4 },
    ])
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ object_key: 'p.energy', role: 'measure', unit: 'kWh', default_aggregation: 'sum', accumulation: 'cumulative_counter', status: 'proposed' })
    expect(items[0].confidence).toBeCloseTo(0.91)
    expect(items[0].evidence).toContain('rising samples')
    expect(items[1].confidence).toBe(1)           // clamped to 1
  })
  it('coerces invalid enum values to null rather than storing junk', () => {
    const [it] = parseStructuredDraft([
      { object_key: 'p.x', role: 'metric', default_aggregation: 'total', accumulation: 'counter', confidence: 0.5 },
    ])
    expect(it.role).toBeNull()
    expect(it.default_aggregation).toBeNull()
    expect(it.accumulation).toBeNull()
  })
  it('drops rows with no object_key', () => {
    expect(parseStructuredDraft([{ role: 'measure' }, { object_key: '', role: 'measure' }])).toHaveLength(0)
  })
  it('defaults confidence to 0 when missing', () => {
    expect(parseStructuredDraft([{ object_key: 'p.y', role: 'dimension' }])[0].confidence).toBe(0)
  })
})

describe('describe-structured: partitionByConfidence', () => {
  const items = parseStructuredDraft([
    { object_key: 'a', role: 'measure', default_aggregation: 'sum', confidence: 0.95 },
    { object_key: 'b', role: 'measure', default_aggregation: 'avg', confidence: 0.6 },
    { object_key: 'c', role: 'dimension', confidence: 0.85 },
    { object_key: 'd', role: null, confidence: 0.99 },   // no role → always review
  ])
  it('splits confident vs review at the threshold and forces role-less to review', () => {
    const { confident, review } = partitionByConfidence(items, 0.8)
    expect(confident.map(i => i.object_key).sort()).toEqual(['a', 'c'])
    expect(review.map(i => i.object_key).sort()).toEqual(['b', 'd'])
  })
})

describe('describe-structured: extractJson', () => {
  it('strips code fences and extracts the object', () => {
    expect(extractJson('```json\n{"items":[{"object_key":"x"}]}\n```').items).toHaveLength(1)
  })
  it('throws when no JSON object present', () => {
    expect(() => extractJson('no json here')).toThrow()
  })
})
