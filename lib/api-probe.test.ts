import { describe, test, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/ssrf-guard', () => ({ assertUrlSafe: async () => ({ ok: true }) }))

import { runCandidateProbe, inspectLogin, resolveLoginUrl } from './api-probe'

afterEach(() => { vi.restoreAllMocks() })

function res(body: unknown, { status = 200, contentType = 'application/json' } = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return {
    ok: status >= 200 && status < 300, status,
    headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? contentType : null), forEach: (fn: (v: string, k: string) => void) => fn(contentType, 'content-type') },
    text: async () => text,
  } as unknown as Response
}

describe('resolveLoginUrl', () => {
  test('absolute stays, relative joins base', () => {
    expect(resolveLoginUrl('https://h/login', 'https://x')).toBe('https://h/login')
    expect(resolveLoginUrl('/accounts/login', 'https://x/api/')).toBe('https://x/api/accounts/login')
  })
})

describe('runCandidateProbe', () => {
  test('builds the URL, applies bearer auth, returns the parsed body', async () => {
    let seenUrl = ''; let seenAuth = ''
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      seenUrl = url; seenAuth = (init.headers as Record<string, string>)['Authorization']
      return res([{ id: 1 }])
    }))
    const r = await runCandidateProbe({
      cacheKey: 'p1', baseUrl: 'https://api.example.com', basePath: '/orders', authType: 'bearer',
      authConfig: { token: 'tok' }, method: 'GET', path: '?limit=5',
    })
    expect(r.ok).toBe(true); expect(r.status).toBe(200)
    expect(seenUrl).toBe('https://api.example.com/orders?limit=5')
    expect(seenAuth).toBe('Bearer tok')
    expect(Array.isArray(r.body)).toBe(true)
  })

  test('surfaces an auth failure without calling the endpoint', async () => {
    const fetchMock = vi.fn(async () => res({ message: 'bad' }, { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)
    // session_token with a login that 401s -> applyAuth fails -> probe returns the error
    const r = await runCandidateProbe({
      cacheKey: 'p2', baseUrl: 'https://h', authType: 'session_token',
      authConfig: { login_url: '/login', username: 'a', password: 'b' }, method: 'GET', path: '/x',
    })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/Login failed/i)
  })
})

describe('inspectLogin', () => {
  test('returns the RAW body so a nested token path is discoverable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res({ message: 'ok', tokens: { access: 'JWT', refresh: 'R' } })))
    const r = await inspectLogin({ baseUrl: 'https://myfactory.ugx.ai/api', login_url: '/accounts/login', username: 'u', password: 'p' })
    expect(r.ok).toBe(true)
    expect(r.resolvedUrl).toBe('https://myfactory.ugx.ai/api/accounts/login')
    // the raw body shows the token is at tokens.access (not access_token)
    expect((r.body as { tokens: { access: string } }).tokens.access).toBe('JWT')
  })
})
