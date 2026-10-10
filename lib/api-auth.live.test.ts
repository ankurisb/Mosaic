import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { applyAuth, invalidateSessionToken, type AuthConfig } from './api-auth'

// End-to-end exercise of the session_token flow against a REAL local HTTP
// server that mimics a Terralayr-shaped API: POST a JSON login, get back an
// access_token, then require `Authorization: Bearer <token>` on data calls.
// This is the same path the candidate probe (/api/test-api) and the live
// call_api tool run, minus the route's SSRF guard (route-level, not here).

let server: http.Server
let base = ''
let loginCount = 0

beforeAll(async () => {
  loginCount = 0
  server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', c => { raw += c })
    req.on('end', () => {
      if (req.method === 'POST' && req.url === '/auth/authenticate') {
        let creds: { username?: string; password?: string } = {}
        try { creds = JSON.parse(raw) } catch {}
        if (creds.username === 'test-user' && creds.password === 'test-pass') {
          loginCount++
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ access_token: 'live-token-abc', expires_in: 3600 }))
        } else {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ message: 'invalid credentials' }))
        }
        return
      }
      if (req.method === 'GET' && req.url === '/auctions') {
        if (req.headers['authorization'] === 'Bearer live-token-abc') {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify([{ id: 'a1', status: 'RUNNING' }, { id: 'a2', status: 'WON' }]))
        } else {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ message: 'missing or bad token' }))
        }
        return
      }
      res.writeHead(404); res.end()
    })
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => { server.close() })

const cfg = (): AuthConfig => ({
  login_url: '/auth/authenticate',
  username: 'test-user',
  password: 'test-pass',
})

async function callAuctions(cacheKey: string): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  const auth = await applyAuth(cacheKey, 'session_token', cfg(), headers, base)
  if (!auth.ok) return { status: 0, body: (auth as { ok: false; error: string }).error }
  const res = await fetch(base + '/auctions', { headers })
  return { status: res.status, body: await res.json() }
}

describe('session_token end-to-end over real HTTP', () => {
  test('logs in, applies the Bearer token, and reads protected data', async () => {
    invalidateSessionToken('live-1')
    const r = await callAuctions('live-1')
    expect(r.status).toBe(200)
    expect(Array.isArray(r.body)).toBe(true)
    expect((r.body as unknown[]).length).toBe(2)
  })

  test('reuses the cached token across calls (login happens once)', async () => {
    invalidateSessionToken('live-2')
    const before = loginCount
    await callAuctions('live-2')
    await callAuctions('live-2')
    await callAuctions('live-2')
    expect(loginCount - before).toBe(1)
  })

  test('wrong credentials fail at login and never reach the data endpoint', async () => {
    const headers: Record<string, string> = {}
    const auth = await applyAuth('live-3', 'session_token', {
      login_url: '/auth/authenticate', username: 'nope', password: 'wrong',
    }, headers, base)
    expect(auth.ok).toBe(false)
    expect(headers['Authorization']).toBeUndefined()
  })
})
