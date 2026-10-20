import { describe, it, expect } from 'vitest'
import { fetchApiRows, withParams, extractPage } from './api-paginate'

// A fake OData/offset server backed by an in-memory array; the page-fetcher parses
// $skip/$top (or offset/limit/page) out of the path and returns that slice.
function makeServer(total: number, style: 'odata' | 'offset' | 'page', envelope = true) {
  const all = Array.from({ length: total }, (_, i) => ({ id: i, v: i * 2 }))
  let calls = 0
  const fetchPage = async (path: string) => {
    calls++
    const q = new URLSearchParams(path.split('?')[1] || '')
    let start = 0, size = total
    if (style === 'odata') { start = Number(q.get('$skip') || 0); size = Number(q.get('$top') || total) }
    else if (style === 'offset') { start = Number(q.get('offset') || 0); size = Number(q.get('limit') || total) }
    else if (style === 'page') { const pg = Number(q.get('page') || 1); size = Number(q.get('limit') || total); start = (pg - 1) * size }
    const slice = all.slice(start, start + size)
    return envelope ? { value: slice } : slice
  }
  return { fetchPage, calls: () => calls, total }
}

describe('withParams', () => {
  it('adds params preserving existing query', () => {
    expect(withParams('/x?$filter=a eq 1', { $top: '500', $skip: '0' }))
      .toBe('/x?%24filter=a+eq+1&%24top=500&%24skip=0')
  })
  it('replaces an existing param', () => {
    expect(withParams('/x?page=1', { page: '2' })).toBe('/x?page=2')
  })
})

describe('extractPage', () => {
  it('uses the configured data path', () => {
    expect(extractPage({ d: { results: [{ a: 1 }] } }, 'd.results')).toEqual([{ a: 1 }])
  })
  it('auto-detects when no path', () => {
    expect(extractPage({ value: [{ a: 1 }, { a: 2 }] }).length).toBe(2)
  })
})

describe('fetchApiRows', () => {
  it('style none makes a single call', async () => {
    const s = makeServer(50, 'offset')
    const r = await fetchApiRows(s.fetchPage, '/x', { style: 'none' }, 5000)
    expect(r.pages).toBe(1); expect(s.calls()).toBe(1); expect(r.rows.length).toBe(50); expect(r.source_capped).toBe(false)
  })
  it('odata: follows $skip until a short page, concatenating all rows', async () => {
    const s = makeServer(1250, 'odata')  // 500 + 500 + 250
    const r = await fetchApiRows(s.fetchPage, '/odata/x', { style: 'odata' }, 5000)
    expect(r.rows.length).toBe(1250)
    expect(r.pages).toBe(3)
    expect(r.source_capped).toBe(false)
    expect(r.rows[0]).toEqual({ id: 0, v: 0 })
    expect(r.rows[1249]).toEqual({ id: 1249, v: 2498 })
  })
  it('offset: caps at maxRows and flags source_capped', async () => {
    const s = makeServer(10000, 'offset')
    const r = await fetchApiRows(s.fetchPage, '/x', { style: 'offset' }, 5000)
    expect(r.rows.length).toBe(5000)
    expect(r.source_capped).toBe(true)
  })
  it('page style: 1-based page increments', async () => {
    const s = makeServer(900, 'page')  // 500 + 400
    const r = await fetchApiRows(s.fetchPage, '/x', { style: 'page' }, 5000)
    expect(r.rows.length).toBe(900)
    expect(r.pages).toBe(2)
  })
  it('throws when a page returns an error envelope', async () => {
    await expect(fetchApiRows(async () => ({ error: 'boom' }), '/x', { style: 'odata' }, 5000)).rejects.toThrow('boom')
  })
})
