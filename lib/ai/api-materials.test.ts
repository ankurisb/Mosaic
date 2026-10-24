import { describe, it, expect } from 'vitest'
import { condenseApiMaterials } from './api-materials'

const POSTMAN = JSON.stringify({
  info: { name: 'Widgets', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  variable: [{ key: 'baseUrl', value: 'https://api.acme.com' }],
  auth: { type: 'bearer' },
  item: [
    { name: 'List widgets', request: { method: 'GET', url: { raw: '{{baseUrl}}/widgets', host: ['{{baseUrl}}'], path: ['widgets'] } } },
    { name: 'Orders folder', item: [
      { name: 'List orders', request: { method: 'GET', url: 'https://api.acme.com/orders' } },
    ] },
  ],
})

const HAR = JSON.stringify({
  log: { entries: [
    { request: { method: 'GET', url: 'https://api.acme.com/v1/widgets?x=1', headers: [{ name: 'x-api-key', value: 'SECRET' }] } },
    { request: { method: 'GET', url: 'https://api.acme.com/v1/widgets?x=2', headers: [] } },
    { request: { method: 'POST', url: 'https://api.acme.com/v1/orders', headers: [{ name: 'Authorization', value: 'Bearer z' }] } },
  ] },
})

describe('condenseApiMaterials', () => {
  it('condenses a Postman collection (dedups folders, finds base + auth)', () => {
    const out = condenseApiMaterials(`===== widgets.postman_collection.json =====\n${POSTMAN}`)!
    expect(out).toContain('Postman collection: Widgets')
    expect(out).toContain('api.acme.com')
    expect(out).toContain('bearer')
    expect(out).toContain('GET {{baseUrl}}/widgets')
    expect(out).toContain('GET https://api.acme.com/orders')
  })
  it('condenses a HAR capture (dedups endpoints, lists auth header names, no secrets)', () => {
    const out = condenseApiMaterials(HAR)!
    expect(out).toContain('HAR capture')
    expect(out).toContain('GET /v1/widgets')     // the two ?x= requests collapse to one
    expect(out).toContain('POST /v1/orders')
    expect(out).toContain('x-api-key')
    expect(out).not.toContain('SECRET')          // values are never surfaced
    expect(out.match(/GET \/v1\/widgets/g)!.length).toBe(1)
  })
  it('leaves non-API text unchanged', () => {
    const docs = 'Plain prose about an API, no structured artifact here.'
    expect(condenseApiMaterials(docs)).toBe(docs)
  })
})
