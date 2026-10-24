import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import { applyAuth, type AuthConfig } from './api-auth'

// A local OAuth2 token endpoint that records the form body + Authorization header
// of the last request, so we can assert exactly what each variant sent.
let server: Server
let tokenUrl = ''
let last: { body: Record<string, string>; authHeader: string | undefined } = { body: {}, authHeader: undefined }

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = ''
    req.on('data', c => { raw += c })
    req.on('end', () => {
      last = { body: Object.fromEntries(new URLSearchParams(raw)), authHeader: req.headers['authorization'] }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ access_token: 'TOK123', expires_in: 3600 }))
    })
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const addr = server.address()
  tokenUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/token`
})
afterAll(() => { server?.close() })

const run = async (cfg: Partial<AuthConfig>) => {
  const headers: Record<string, string> = {}
  const r = await applyAuth(`svc-${Math.random()}`, 'oauth2_client', { token_url: tokenUrl, ...cfg } as AuthConfig, headers)
  return { r, headers }
}

describe('OAuth2 variants (Stage 5)', () => {
  it('client_credentials by default, client creds in the body, scope + audience sent', async () => {
    const { r, headers } = await run({ client_id: 'cid', client_secret: 'sec', scope: 'read write', audience: 'https://api.x' })
    expect(r.ok).toBe(true)
    expect(headers['Authorization']).toBe('Bearer TOK123')
    expect(last.body.grant_type).toBe('client_credentials')
    expect(last.body.client_id).toBe('cid')
    expect(last.body.client_secret).toBe('sec')
    expect(last.body.scope).toBe('read write')
    expect(last.body.audience).toBe('https://api.x')
    expect(last.authHeader).toBeUndefined()
  })

  it('client_auth=basic puts client creds in an HTTP Basic header, not the body', async () => {
    await run({ client_id: 'cid', client_secret: 'sec', client_auth: 'basic' })
    expect(last.authHeader).toBe('Basic ' + Buffer.from('cid:sec').toString('base64'))
    expect(last.body.client_id).toBeUndefined()
    expect(last.body.client_secret).toBeUndefined()
  })

  it('infers the password grant from oauth_username/oauth_password', async () => {
    await run({ client_id: 'cid', client_secret: 'sec', oauth_username: 'alice', oauth_password: 'pw' })
    expect(last.body.grant_type).toBe('password')
    expect(last.body.username).toBe('alice')
    expect(last.body.password).toBe('pw')
  })

  it('refresh_token grant when a refresh token is present', async () => {
    await run({ client_id: 'cid', client_secret: 'sec', refresh_token: 'rt' })
    expect(last.body.grant_type).toBe('refresh_token')
    expect(last.body.refresh_token).toBe('rt')
  })

  it('explicit grant_type override wins, and extra_params are merged verbatim', async () => {
    await run({ client_id: 'cid', client_secret: 'sec', grant_type: 'urn:ietf:params:oauth:grant-type:custom', extra_params: '{"resource":"https://res","tenant":"t1"}' })
    expect(last.body.grant_type).toBe('urn:ietf:params:oauth:grant-type:custom')
    expect(last.body.resource).toBe('https://res')
    expect(last.body.tenant).toBe('t1')
  })

  it('tolerates malformed extra_params (ignored, request still succeeds)', async () => {
    const { r } = await run({ client_id: 'cid', client_secret: 'sec', extra_params: 'not json' })
    expect(r.ok).toBe(true)
  })
})
