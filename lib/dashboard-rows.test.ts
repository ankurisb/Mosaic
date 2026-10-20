import { describe, it, expect } from 'vitest'
import { extractRows, lttbIndices, capPanelRows } from './dashboard-rows'

const series = (n: number) => Array.from({ length: n }, (_, i) => ({ day: `2026-01-${i + 1}`, units: Math.round(Math.sin(i / 3) * 100 + 200) }))

describe('extractRows', () => {
  it('reads a bare array', () => { expect(extractRows([{ a: 1 }]).length).toBe(1) })
  it('reads {rows}', () => { expect(extractRows({ rows: [{ a: 1 }, { a: 2 }] }).length).toBe(2) })
  it('handles non-row shapes', () => { expect(extractRows({ text: 'hi' })).toEqual([]) ; expect(extractRows(null)).toEqual([]) })
})

describe('lttbIndices', () => {
  it('returns all indices when under threshold', () => {
    expect(lttbIndices(series(10), 'units', 1000)).toEqual([...Array(10).keys()])
  })
  it('downsamples to the threshold, keeping first and last', () => {
    const rows = series(5000)
    const idx = lttbIndices(rows, 'units', 500)
    expect(idx.length).toBe(500)
    expect(idx[0]).toBe(0)
    expect(idx[idx.length - 1]).toBe(4999)
    // monotonic, in-range
    for (let i = 1; i < idx.length; i++) expect(idx[i]).toBeGreaterThan(idx[i - 1])
  })
})

describe('capPanelRows', () => {
  it('passes small results through untouched', () => {
    const r = capPanelRows({ rows: series(30) }, 'line', { x: 'day', y: 'units' })
    expect(r.rows.length).toBe(30)
    expect(r.meta).toMatchObject({ total_rows: 30, returned_rows: 30, downsampled: false, truncated: false })
  })
  it('downsamples a large time-series (line) preserving endpoints', () => {
    const rows = series(8640)
    const r = capPanelRows({ rows }, 'line', { x: 'day', y: 'units' }, { maxPoints: 1000 })
    expect(r.rows.length).toBe(1000)
    expect(r.meta.downsampled).toBe(true)
    expect(r.meta.truncated).toBe(false)
    expect(r.meta.total_rows).toBe(8640)
    expect(r.rows[0]).toEqual(rows[0])
    expect(r.rows[r.rows.length - 1]).toEqual(rows[rows.length - 1])
  })
  it('truncates a large table (non time-series) and flags it', () => {
    const rows = Array.from({ length: 5000 }, (_, i) => ({ machine: 'M' + i, status: 'ok' }))
    const r = capPanelRows({ rows }, 'table', undefined, { maxRows: 1000 })
    expect(r.rows.length).toBe(1000)
    expect(r.meta.truncated).toBe(true)
    expect(r.meta.downsampled).toBe(false)
    expect(r.meta.total_rows).toBe(5000)
  })
  it('falls back to truncation when a time-series has no numeric column', () => {
    const rows = Array.from({ length: 2000 }, (_, i) => ({ label: 'x' + i, cat: 'a' }))
    const r = capPanelRows({ rows }, 'line', undefined, { maxPoints: 500 })
    expect(r.rows.length).toBe(500)
    expect(r.meta.truncated).toBe(true)
  })
  it('propagates source_capped', () => {
    const r = capPanelRows({ rows: series(10) }, 'line', { y: 'units' }, { sourceCapped: true })
    expect(r.meta.source_capped).toBe(true)
  })
})
