import { describe, it, expect } from 'vitest'
import { bucketTime, rollupByGrain } from './semantic-rollup'

describe('bucketTime', () => {
  it('truncates to day / hour / month / week', () => {
    expect(bucketTime('2026-04-12T13:45:10Z', '1d')).toBe('2026-04-12')
    expect(bucketTime('2026-04-12T13:45:10Z', '1h')).toBe('2026-04-12T13:00:00.000Z')
    expect(bucketTime('2026-04-12T13:45:10Z', '1mo')).toBe('2026-04')
    // 2026-04-12 is a Sunday → ISO week starts Monday 2026-04-06
    expect(bucketTime('2026-04-12T13:45:10Z', '1w')).toBe('2026-04-06')
  })
  it('floors to 15-minute buckets', () => {
    expect(bucketTime('2026-04-12T13:52:00Z', '15m')).toBe('2026-04-12T13:45:00.000Z')
  })
  it('passes a non-date through unchanged', () => {
    expect(bucketTime('Line A', '1d')).toBe('Line A')
  })
})

describe('rollupByGrain', () => {
  const rows = [
    { ts: '2026-04-12T01:00:00Z', units: 10, oee: 80 },
    { ts: '2026-04-12T05:00:00Z', units: 20, oee: 90 },
    { ts: '2026-04-13T02:00:00Z', units: 5, oee: 70 },
  ]
  it('sums + averages per day with declared aggregations', () => {
    const out = rollupByGrain(rows, { timeKey: 'ts', grain: '1d', measures: { units: 'sum', oee: 'avg' } })
    expect(out).toEqual([
      { ts: '2026-04-12', units: 30, oee: 85 },
      { ts: '2026-04-13', units: 5, oee: 70 },
    ])
  })
  it('keeps and groups by a series dimension', () => {
    const r2 = [
      { ts: '2026-04-12T01:00:00Z', line: 'A', units: 10 },
      { ts: '2026-04-12T09:00:00Z', line: 'A', units: 15 },
      { ts: '2026-04-12T01:00:00Z', line: 'B', units: 100 },
    ]
    const out = rollupByGrain(r2, { timeKey: 'ts', grain: '1d', measures: { units: 'sum' }, seriesKeys: ['line'] })
    expect(out).toEqual([
      { ts: '2026-04-12', line: 'A', units: 25 },
      { ts: '2026-04-12', line: 'B', units: 100 },
    ])
  })
  it('supports count and count_distinct', () => {
    const r3 = [{ ts: '2026-04-12T01:00:00Z', op: 'x' }, { ts: '2026-04-12T02:00:00Z', op: 'x' }, { ts: '2026-04-12T03:00:00Z', op: 'y' }]
    const out = rollupByGrain(r3, { timeKey: 'ts', grain: '1d', measures: { op: 'count_distinct' } })
    expect(out[0].op).toBe(2)
    const out2 = rollupByGrain(r3, { timeKey: 'ts', grain: '1d', measures: { op: 'count' } })
    expect(out2[0].op).toBe(3)
  })
})
