import { describe, test, expect } from 'vitest'
import { summarizeOpenApi } from './openapi-summary'

// A FactoryOS-shaped OpenAPI 3.1 spec: JWT bearer, nested-token login, 188-ish
// endpoints (we include a representative handful + a $ref login schema).
const spec = {
  openapi: '3.1.0',
  info: { title: 'FactoryOS API', version: '1.0' },
  servers: [{ url: 'https://myfactory.ugx.ai/api' }],
  components: {
    securitySchemes: { JWTAuth: { type: 'http', scheme: 'bearer' } },
    schemas: { LoginSchema: { type: 'object', required: ['username', 'password'], properties: { username: { type: 'string' }, password: { type: 'string' } } } },
  },
  paths: {
    '/accounts/login': { post: { summary: 'Login', requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginSchema' } } } } } },
    '/assets/': { get: { summary: 'List assets' }, post: { summary: 'Create asset' } },
    '/assets/{asset_id}': { get: { summary: 'Get asset' }, put: {}, delete: {} },
    '/core/menu-groups': { get: { summary: 'Menu groups' } },
  },
}

describe('summarizeOpenApi', () => {
  test('extracts title, server, security scheme and endpoint count', () => {
    const s = summarizeOpenApi(spec)
    expect(s.ok).toBe(true)
    expect(s.title).toBe('FactoryOS API')
    expect(s.servers).toEqual(['https://myfactory.ugx.ai/api'])
    expect(s.securitySchemes.JWTAuth).toEqual({ type: 'http', scheme: 'bearer', in: undefined, name: undefined })
    expect(s.endpointCount).toBe(7) // login + assets(2) + asset_id(3) + menu-groups(1)
    expect(s.groups).toEqual(['accounts', 'assets', 'core'])
  })

  test('finds the login endpoint and resolves its $ref field names', () => {
    const s = summarizeOpenApi(spec)
    expect(s.loginCandidates).toHaveLength(1)
    const lc = s.loginCandidates[0]
    expect(lc.path).toBe('/accounts/login')
    expect(lc.fields.map(f => f.name).sort()).toEqual(['password', 'username'])
    expect(lc.fields.every(f => f.required)).toBe(true)
  })

  test('ranks cheap GET list endpoints ahead of param/write endpoints', () => {
    const s = summarizeOpenApi(spec)
    const first = s.endpoints[0]
    expect(first.method).toBe('GET')
    expect(first.hasPathParams).toBe(false)
  })

  test('handles Swagger 2.0 host/basePath and securityDefinitions', () => {
    const s2 = summarizeOpenApi({
      swagger: '2.0', host: 'api.acme.com', basePath: '/v1', schemes: ['https'],
      securityDefinitions: { apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' } },
      paths: { '/ping': { get: { summary: 'Ping' } } },
    })
    expect(s2.servers).toEqual(['https://api.acme.com/v1'])
    expect(s2.securitySchemes.apiKey).toEqual({ type: 'apiKey', in: 'header', name: 'X-API-Key', scheme: undefined })
  })
})

// The real FactoryOS shape that caused 404-on-every-probe: servers is EMPTY and
// every path already carries a "/api" mount prefix. The summary must fold "/api"
// into the base URL (from the spec's own origin), group on the segments BENEATH
// it, and hand back paths relative to that base — so base_url + path never
// doubles the prefix.
describe('summarizeOpenApi — shared mount prefix', () => {
  const factoryos = {
    openapi: '3.1.0',
    info: { title: 'FactoryOS API', version: '1.0' },
    servers: [],
    components: { securitySchemes: { JWTAuth: { type: 'http', scheme: 'bearer' } } },
    paths: {
      '/api/accounts/login': { post: { summary: 'Login', requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['username', 'password'], properties: { username: {}, password: {} } } } } } } },
      '/api/accounts/user-menu': { get: { summary: 'User menu' } },
      '/api/core/tenants': { get: { summary: 'List tenants' } },
      '/api/core/tenants/{org_id}': { get: { summary: 'Get tenant' } },
      '/api/assets/': { get: { summary: 'List assets' }, post: {} },
    },
  }

  test('folds the /api prefix into the base URL from the spec origin', () => {
    const s = summarizeOpenApi(factoryos, 150, 'https://myfactory.ugx.ai/api/openapi.json')
    expect(s.ok).toBe(true)
    expect(s.commonPrefix).toBe('/api')
    expect(s.suggestedBaseUrl).toBe('https://myfactory.ugx.ai/api')
  })

  test('groups on the segments beneath the mount prefix, not "api"', () => {
    const s = summarizeOpenApi(factoryos, 150, 'https://myfactory.ugx.ai/api/openapi.json')
    expect(s.groups).toEqual(['accounts', 'assets', 'core'])
  })

  test('returns paths relative to the base URL (no /api), so base+path never doubles', () => {
    const s = summarizeOpenApi(factoryos, 150, 'https://myfactory.ugx.ai/api/openapi.json')
    expect(s.endpoints.every(e => !e.path.startsWith('/api/'))).toBe(true)
    expect(s.endpoints.map(e => e.path)).toContain('/core/tenants')
    expect(s.loginCandidates[0].path).toBe('/accounts/login')
    // The decisive invariant: base + a listed path hits the real endpoint once.
    expect(s.suggestedBaseUrl! + '/core/tenants').toBe('https://myfactory.ugx.ai/api/core/tenants')
  })

  test('peels a version prefix (/v1) too', () => {
    const s = summarizeOpenApi({
      openapi: '3.0.0', info: { title: 'X' }, servers: [{ url: 'https://api.acme.com' }],
      paths: { '/v1/users': { get: {} }, '/v1/orders': { get: {} } },
    })
    expect(s.commonPrefix).toBe('/v1')
    expect(s.suggestedBaseUrl).toBe('https://api.acme.com/v1')
    expect(s.groups).toEqual(['orders', 'users'])
  })

  test('does NOT over-peel a genuine single-group API', () => {
    // All paths share "/assets", but "/assets" itself is an endpoint — peeling
    // would empty it. Keep it as the group.
    const s = summarizeOpenApi({
      openapi: '3.0.0', info: { title: 'Y' }, servers: [{ url: 'https://h' }],
      paths: { '/assets': { get: {} }, '/assets/{id}': { get: {} }, '/assets/{id}/telemetry': { get: {} } },
    })
    expect(s.commonPrefix).toBe('')
    expect(s.groups).toEqual(['assets'])
    expect(s.suggestedBaseUrl).toBe('https://h')
  })
})
