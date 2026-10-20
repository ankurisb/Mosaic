import { describe, it, expect } from 'vitest'
import { fetchApiRows, withParams, extractPage, detectNext } from './api-paginate'

describe('withParams', () => {
  it('adds params preserving existing query', () => {
    expect(withParams('/x?a=1', { page: '2' })).toBe('/x?a=1&page=2')
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

describe('detectNext (response-driven)', () => {
  const cfg = {}
  it('OData nextLink → relativized follow', () => {
    const d = { value: [], '@odata.nextLink': 'https://h/api/x?$skiptoken=abc' }
    expect(detectNext(d, '/x', cfg, 500)).toEqual({ kind: 'next', path: '/api/x?$skiptoken=abc' })
  })
  it('FactoryOS pagination envelope: page < total_pages → ?page=n+1', () => {
    const d = { assets: [], pagination: { page: 1, total_pages: 4, total_records: 1800 } }
    expect(detectNext(d, '/mes/assets', cfg, 500)).toEqual({ kind: 'next', path: '/mes/assets?page=2' })
  })
  it('FactoryOS pagination envelope: last page → stop', () => {
    const d = { assets: [], pagination: { page: 4, total_pages: 4 } }
    expect(detectNext(d, '/mes/assets', cfg, 2000)).toEqual({ kind: 'stop' })
  })
  it('cursor token → cursor param', () => {
    const d = { data: [], meta: { next_cursor: 'c2' } }
    expect(detectNext(d, '/x', { cursorParam: 'cursor' }, 50)).toEqual({ kind: 'next', path: '/x?cursor=c2' })
  })
  it('total + offset maths when rows remain', () => {
    const d = { items: [], meta: { total: 1000, page_size: 200 } }
    expect(detectNext(d, '/x', {}, 200)).toEqual({ kind: 'next', path: '/x?limit=200&offset=200' })
  })
  it('has_more:false → stop', () => {
    expect(detectNext({ data: [], has_more: false }, '/x', {}, 10)).toEqual({ kind: 'stop' })
  })
  it('no metadata → unknown', () => {
    expect(detectNext([{ a: 1 }], '/x', {}, 1)).toEqual({ kind: 'unknown' })
    expect(detectNext({ value: [{ a: 1 }] }, '/x', {}, 1)).toEqual({ kind: 'unknown' })
  })
})

describe('fetchApiRows end-to-end', () => {
  // A page-envelope server (FactoryOS style): N records, pageSize per page, 1-based.
  function pageServer(total: number, pageSize: number) {
    const all = Array.from({ length: total }, (_, i) => ({ id: i }))
    let calls = 0
    const fetchPage = async (path: string) => {
      calls++
      const page = Number(new URLSearchParams(path.split('?')[1] || '').get('page') || 1)
      const start = (page - 1) * pageSize
      return { records: all.slice(start, start + pageSize), pagination: { page, total_pages: Math.ceil(total / pageSize), total_records: total } }
    }
    return { fetchPage, calls: () => calls }
  }

  it('follows a page envelope across all pages (response-driven, no config)', async () => {
    const s = pageServer(1800, 500)  // 4 pages
    const r = await fetchApiRows(s.fetchPage, '/mes/assets', { dataPath: 'records' }, 5000)
    expect(r.rows.length).toBe(1800)
    expect(r.pages).toBe(4)
    expect(r.source_capped).toBe(false)
    expect(r.rows[0]).toEqual({ id: 0 }); expect(r.rows[1799]).toEqual({ id: 1799 })
  })

  it('caps at maxRows and flags source_capped', async () => {
    const s = pageServer(100000, 500)
    const r = await fetchApiRows(s.fetchPage, '/x', { dataPath: 'records' }, 5000)
    expect(r.rows.length).toBe(5000)
    expect(r.source_capped).toBe(true)
  })

  it('OData: follows nextLink until it stops', async () => {
    const total = 1250, pageSize = 500
    const all = Array.from({ length: total }, (_, i) => ({ id: i }))
    const fetchPage = async (path: string) => {
      const skip = Number(new URLSearchParams(path.split('?')[1] || '').get('$skip') || 0)
      const slice = all.slice(skip, skip + pageSize)
      const more = skip + pageSize < total
      return { value: slice, ...(more ? { '@odata.nextLink': `/odata/x?$skip=${skip + pageSize}&$top=${pageSize}` } : {}) }
    }
    const r = await fetchApiRows(fetchPage, '/odata/x', {}, 5000)
    expect(r.rows.length).toBe(1250)
    expect(r.source_capped).toBe(false)
  })

  it('no metadata + style none → single page', async () => {
    const r = await fetchApiRows(async () => ({ value: Array.from({ length: 500 }, (_, i) => ({ id: i })) }), '/x', { style: 'none' }, 5000)
    expect(r.pages).toBe(1); expect(r.rows.length).toBe(500); expect(r.source_capped).toBe(false)
  })

  it('no metadata + stored style offset → config fallback steps by offset', async () => {
    const total = 1100, pageSize = 500
    const all = Array.from({ length: total }, (_, i) => ({ id: i }))
    const fetchPage = async (path: string) => {
      const offset = Number(new URLSearchParams(path.split('?')[1] || '').get('offset') || 0)
      return all.slice(offset, offset + pageSize)  // bare array, no metadata
    }
    const r = await fetchApiRows(fetchPage, '/x', { style: 'offset' }, 5000)
    expect(r.rows.length).toBe(1100)
    expect(r.source_capped).toBe(false)
  })

  it('throws on an error envelope', async () => {
    await expect(fetchApiRows(async () => ({ error: 'boom' }), '/x', {}, 5000)).rejects.toThrow('boom')
  })
})
