import { describe, test, expect } from 'vitest'
import { safeJson, getJson, postJson } from './fetch'

// ── safeJson ────────────────────────────────────────────────────────────────

describe('safeJson', () => {
  test('200 with valid JSON → data returned, error null', async () => {
    const r = new Response(JSON.stringify({ id: 'abc', ok: true }), { status: 200 })
    const { data, error } = await safeJson<{ id: string; ok: boolean }>(r)
    expect(error).toBeNull()
    expect(data).toEqual({ id: 'abc', ok: true })
  })

  test('empty 500 body → human-readable server error', async () => {
    const r = new Response('', { status: 500 })
    const { data, error } = await safeJson(r)
    expect(data).toBeNull()
    expect(error).toBe('Server error (500). Please try again or contact support if this persists.')
  })

  test('empty 503 body → human-readable server error with correct status', async () => {
    const r = new Response('', { status: 503 })
    const { error } = await safeJson(r)
    expect(error).toBe('Server error (503). Please try again or contact support if this persists.')
  })

  test('HTML error page 500 → human-readable, not raw HTML/JSON error', async () => {
    const r = new Response('<html><body>Internal Server Error</body></html>', { status: 500 })
    const { error } = await safeJson(r)
    expect(error).not.toContain('JSON')
    expect(error).not.toContain('<html>')
    expect(error).toContain('Server error (500)')
  })

  test('JSON error field is passed through verbatim', async () => {
    const r = new Response(JSON.stringify({ error: 'Label is required' }), { status: 400 })
    const { data, error } = await safeJson(r)
    expect(data).toBeNull()
    expect(error).toBe('Label is required')
  })

  test('400 empty body → invalid request message', async () => {
    const r = new Response('', { status: 400 })
    const { error } = await safeJson(r)
    expect(error).toBe('Invalid request. Check your inputs and try again.')
  })

  test('401 empty body → sign-in message', async () => {
    const r = new Response('', { status: 401 })
    const { error } = await safeJson(r)
    expect(error).toBe('You are not signed in. Please refresh the page and log in.')
  })

  test('403 empty body → permission message', async () => {
    const r = new Response('', { status: 403 })
    const { error } = await safeJson(r)
    expect(error).toBe('You do not have permission to perform this action.')
  })

  test('404 empty body → not found message', async () => {
    const r = new Response('', { status: 404 })
    const { error } = await safeJson(r)
    expect(error).toBe('The requested resource was not found.')
  })

  test('409 empty body → conflict message', async () => {
    const r = new Response('', { status: 409 })
    const { error } = await safeJson(r)
    expect(error).toBe('A conflict occurred — this item may already exist.')
  })

  test('429 empty body → rate limit message', async () => {
    const r = new Response('', { status: 429 })
    const { error } = await safeJson(r)
    expect(error).toBe('Too many requests. Please wait a moment and try again.')
  })

  test('200 with non-JSON body → unexpected response error', async () => {
    const r = new Response('not json at all', { status: 200 })
    const { error } = await safeJson(r)
    expect(error).toBe('Unexpected response from server. Please try again.')
  })

  test('error message never contains raw JS internals', async () => {
    const cases = [200, 400, 401, 403, 404, 409, 429, 500, 503]
    for (const status of cases) {
      const r = new Response('', { status })
      const { error } = await safeJson(r)
      if (error) {
        expect(error).not.toContain('JSON')
        expect(error).not.toContain('execute')
        expect(error).not.toContain('Unexpected token')
        expect(error).not.toContain('SyntaxError')
      }
    }
  })
})

// ── getJson ─────────────────────────────────────────────────────────────────

describe('getJson', () => {
  test('network failure → human-readable error, never throws', async () => {
    // Point at a port nothing is listening on
    const { data, error } = await getJson('http://localhost:19999/nonexistent')
    expect(data).toBeNull()
    expect(error).toBeTruthy()
    expect(typeof error).toBe('string')
    expect(error).not.toContain('fetch failed') // raw Node message
  })
})

// ── postJson ─────────────────────────────────────────────────────────────────

describe('postJson', () => {
  test('network failure → human-readable error, never throws', async () => {
    const { data, error } = await postJson('http://localhost:19999/nonexistent', { foo: 'bar' })
    expect(data).toBeNull()
    expect(error).toBeTruthy()
  })
})
