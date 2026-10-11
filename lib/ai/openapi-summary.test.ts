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
