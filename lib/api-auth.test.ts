import { describe, test, expect, vi, afterEach } from 'vitest'
import { getSessionToken, invalidateSessionToken, applyAuth, type AuthConfig } from './api-auth'

// getSessionToken / applyAuth('session_token') hit the login endpoint via
// global fetch. We stub fetch per-test and use a unique serviceId each time so
// the module-level token cache doesn't bleed between cases.

afterEach(() => { vi.restoreAllMocks() })

function stubFetch(impl: (url: string, init: RequestInit) => { status?: number; body: unknown }) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const { status = 200, body } = impl(url, init)
    const text = typeof body === 'string' ? body : JSON.stringify(body)
    return { ok: status >= 200 && status < 300, status, text: async () => text } as unknown as Response
  }))
}

describe('getSessionToken', () => {
  test('logs in with JSON body and extracts the default access_token path', async () => {
    let seenUrl = ''; let seenBody: unknown
    stubFetch((url, init) => {
      seenUrl = url; seenBody = JSON.parse(init.body as string)
      return { body: { access_token: 'tok-123' } }
    })
    const cfg: AuthConfig = {
      login_url: 'https://api.trlyr.com/auth/public/authenticate',
      username: 'u@x.com', password: 'secret',
    }
    const r = await getSessionToken('svc-json', 'https://api.trlyr.com', cfg)
    expect(r.ok).toBe(true)
    if (r.ok) { expect(r.token).toBe('tok-123'); expect(r.header).toBe('Authorization'); expect(r.prefix).toBe('Bearer') }
    expect(seenUrl).toBe('https://api.trlyr.com/auth/public/authenticate')
    expect(seenBody).toEqual({ username: 'u@x.com', password: 'secret' })
  })

  test('resolves a relative login_url against the base URL', async () => {
    let seenUrl = ''
    stubFetch((url) => { seenUrl = url; return { body: { access_token: 't' } } })
    const r = await getSessionToken('svc-rel', 'https://api.example.com/', {
      login_url: '/auth/login', username: 'a', password: 'b',
    })
    expect(r.ok).toBe(true)
    expect(seenUrl).toBe('https://api.example.com/auth/login')
  })

  test('honours custom field names, extra body, token_path, header and prefix', async () => {
    let seenBody: Record<string, unknown> = {}
    stubFetch((_url, init) => {
      seenBody = JSON.parse(init.body as string)
      return { body: { data: { jwt: 'deep-tok' } } }
    })
    const r = await getSessionToken('svc-custom', undefined, {
      login_url: 'https://h/login',
      username: 'me', password: 'pw',
      username_field: 'email', password_field: 'pass',
      login_body_extra: '{"grant_type":"password"}',
      token_path: 'data.jwt', token_header: 'X-Auth-Token', token_prefix: '',
    })
    expect(seenBody).toEqual({ grant_type: 'password', email: 'me', pass: 'pw' })
    expect(r.ok).toBe(true)
    if (r.ok) { expect(r.token).toBe('deep-tok'); expect(r.header).toBe('X-Auth-Token'); expect(r.prefix).toBe('') }
  })

  test('caches the token across calls (one login), then re-logs in after invalidate', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'c' }) } as unknown as Response))
    vi.stubGlobal('fetch', fetchMock)
    const cfg: AuthConfig = { login_url: 'https://h/l', username: 'a', password: 'b', token_ttl_seconds: '3600' }
    await getSessionToken('svc-cache', undefined, cfg)
    await getSessionToken('svc-cache', undefined, cfg)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    invalidateSessionToken('svc-cache')
    await getSessionToken('svc-cache', undefined, cfg)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  test('surfaces a login failure with the upstream message', async () => {
    stubFetch(() => ({ status: 401, body: { message: 'bad credentials' } }))
    const r = await getSessionToken('svc-fail', undefined, { login_url: 'https://h/l', username: 'a', password: 'b' })
    expect(r.ok).toBe(false)
    expect((r as { ok: false; error: string }).error).toMatch(/bad credentials/)
  })

  test('fails cleanly when the token is missing at the configured path', async () => {
    stubFetch(() => ({ body: { nope: 1 } }))
    const r = await getSessionToken('svc-notoken', undefined, { login_url: 'https://h/l', username: 'a', password: 'b' })
    expect(r.ok).toBe(false)
    expect((r as { ok: false; error: string }).error).toMatch(/No token/)
  })

  test('requires login_url, username and password', async () => {
    const r1 = await getSessionToken('svc-v1', undefined, { username: 'a', password: 'b' } as AuthConfig)
    expect(r1.ok).toBe(false)
    const r2 = await getSessionToken('svc-v2', undefined, { login_url: 'https://h/l' } as AuthConfig)
    expect(r2.ok).toBe(false)
  })
})

describe("applyAuth('session_token')", () => {
  test('sets the resolved token header on the outgoing request', async () => {
    stubFetch(() => ({ body: { access_token: 'applied-tok' } }))
    const headers: Record<string, string> = {}
    const r = await applyAuth('svc-apply', 'session_token', {
      login_url: 'https://h/login', username: 'a', password: 'b',
    }, headers, 'https://h')
    expect(r.ok).toBe(true)
    expect(headers['Authorization']).toBe('Bearer applied-tok')
  })

  test('returns ok:false with the error when login fails', async () => {
    stubFetch(() => ({ status: 403, body: { error: 'forbidden' } }))
    const headers: Record<string, string> = {}
    const r = await applyAuth('svc-apply-fail', 'session_token', {
      login_url: 'https://h/login', username: 'a', password: 'b',
    }, headers, 'https://h')
    expect(r.ok).toBe(false)
    expect(headers['Authorization']).toBeUndefined()
  })
})
