import { describe, test, expect, vi, afterEach } from 'vitest'

// SSRF guard does real DNS; stub it to "allowed" so we can test fetch/expansion
// logic against a mocked network.
vi.mock('@/lib/ssrf-guard', () => ({ assertUrlSafe: async () => ({ ok: true }) }))

import { extractUrls, htmlToText, fetchUrlText, gatherMaterials } from './doc-fetch'

afterEach(() => { vi.restoreAllMocks() })

function makeRes(body: string, opts: { status?: number; contentType?: string; location?: string } = {}) {
  const { status = 200, contentType = 'text/plain', location } = opts
  const bytes = new TextEncoder().encode(body)
  let sent = false
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? contentType : k.toLowerCase() === 'location' ? (location ?? null) : null) },
    body: { getReader: () => ({ read: async () => (sent ? { done: true, value: undefined } : (sent = true, { done: false, value: bytes })) }) },
  } as unknown as Response
}

describe('extractUrls', () => {
  test('pulls distinct URLs and strips trailing punctuation', () => {
    const urls = extractUrls('See https://a.com/x and https://b.com/y, also https://a.com/x again.')
    expect(urls).toEqual(['https://a.com/x', 'https://b.com/y'])
  })
  test('caps the count', () => {
    const many = Array.from({ length: 20 }, (_, i) => `https://h.com/${i}`).join(' ')
    expect(extractUrls(many, 5)).toHaveLength(5)
  })
})

describe('htmlToText', () => {
  test('strips tags, scripts, styles and decodes entities', () => {
    const t = htmlToText('<style>x{}</style><h1>Title</h1><script>bad()</script><p>a &amp; b</p>')
    expect(t).toContain('Title')
    expect(t).toContain('a & b')
    expect(t).not.toContain('bad()')
    expect(t).not.toContain('<')
  })
})

describe('fetchUrlText', () => {
  test('returns text and reduces HTML to text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => makeRes('<html><body><h2>Hello</h2></body></html>', { contentType: 'text/html' })))
    const r = await fetchUrlText('https://docs.example.com/page')
    expect(r.ok).toBe(true)
    if (r.ok) { expect(r.text).toContain('Hello'); expect(r.text).not.toContain('<h2>') }
  })
  test('follows a redirect then succeeds', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeRes('', { status: 301, location: 'https://docs.example.com/final' }))
      .mockResolvedValueOnce(makeRes('final content'))
    vi.stubGlobal('fetch', fetchMock)
    const r = await fetchUrlText('https://docs.example.com/start')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.text).toBe('final content')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('gatherMaterials', () => {
  test('expands an llms.txt index to its listed same-host pages (once)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/llms.txt')) return makeRes('Index\nhttps://docs.example.com/a\nhttps://docs.example.com/b\nhttps://other.com/c')
      if (url.endsWith('/a')) return makeRes('page A body')
      if (url.endsWith('/b')) return makeRes('page B body')
      return makeRes('other')
    }))
    const { text, fetched } = await gatherMaterials(['https://docs.example.com/llms.txt'])
    // index + its two SAME-host pages fetched; the other-host link is not followed
    const okUrls = fetched.filter(f => f.ok).map(f => f.url)
    expect(okUrls).toContain('https://docs.example.com/llms.txt')
    expect(okUrls).toContain('https://docs.example.com/a')
    expect(okUrls).toContain('https://docs.example.com/b')
    expect(okUrls).not.toContain('https://other.com/c')
    expect(text).toContain('page A body')
    expect(text).toContain('page B body')
  })

  test('records a failed fetch without aborting the rest', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/bad')) return makeRes('nope', { status: 500 })
      return makeRes('good body')
    }))
    const { fetched } = await gatherMaterials(['https://x.com/bad', 'https://x.com/good'])
    expect(fetched.find(f => f.url.endsWith('/bad'))?.ok).toBe(false)
    expect(fetched.find(f => f.url.endsWith('/good'))?.ok).toBe(true)
  })
})
