import { describe, it, expect } from 'vitest'
import { parseSpec, isOpenApiSpec, extractSpecFromMaterials, condenseSpecMaterials, summarizeOpenApi } from './openapi-summary'

const YAML_SPEC = `openapi: 3.0.0
info:
  title: Widgets API
  version: "2.1"
servers:
  - url: https://api.acme.com/v1
paths:
  /widgets:
    get:
      summary: List widgets
      responses: { "200": { description: ok } }
  /widgets/{id}:
    get:
      summary: Get a widget
      responses: { "200": { description: ok } }
  /orders:
    get: { summary: List orders, responses: { "200": { description: ok } } }
`

describe('spec ingestion (YAML + condense)', () => {
  it('parseSpec reads YAML and JSON', () => {
    expect(isOpenApiSpec(parseSpec(YAML_SPEC))).toBe(true)
    expect(isOpenApiSpec(parseSpec(JSON.stringify({ openapi: '3.0.0', paths: { '/x': {} } })))).toBe(true)
    expect(parseSpec('not a spec at all')).toBeTruthy() // yaml parses a bare string
    expect(isOpenApiSpec(parseSpec('just prose, no paths'))).toBe(false)
  })

  it('extractSpecFromMaterials finds a spec inside a wrapped block', () => {
    const materials = `===== openapi.yaml =====\n${YAML_SPEC}`
    const spec = extractSpecFromMaterials(materials)
    expect(isOpenApiSpec(spec)).toBe(true)
  })

  it('condenseSpecMaterials replaces a big spec with a compact summary', () => {
    const materials = `===== openapi.yaml =====\n${YAML_SPEC}`
    const out = condenseSpecMaterials(materials)!
    expect(out).toContain('Widgets API')
    expect(out).toContain('GET /widgets')
    expect(out).toContain('api.acme.com')
    expect(out.length).toBeLessThan(materials.length + 400) // condensed, structured
  })

  it('leaves non-spec materials unchanged', () => {
    const docs = 'Here are some API docs in prose. Base URL is https://x.com.'
    expect(condenseSpecMaterials(docs)).toBe(docs)
  })
})

describe('server selection (templated host)', () => {
  const sap = {
    openapi: '3.0.0', info: { title: 'X', version: '1' },
    servers: [
      { url: 'https://{host}:{port}/sap/opu/odata/sap/API_X', variables: { host: { default: '' }, port: { default: '' } } },
      { url: 'https://sandbox.api.sap.com/s4/sap/opu/odata/sap/API_X' },
    ],
    paths: { '/A_Thing': { get: { summary: 'list' } } },
  }
  it('prefers the concrete server and surfaces the templated vars', () => {
    const s = summarizeOpenApi(sap, 50)
    expect(s.suggestedBaseUrl).toBe('https://sandbox.api.sap.com/s4/sap/opu/odata/sap/API_X')
    expect((s.serverVariables || []).map(v => v.name).sort()).toEqual(['host', 'port'])
  })
  it('falls back to the templated base when no concrete server exists', () => {
    const only = { ...sap, servers: [sap.servers[0]] }
    const s = summarizeOpenApi(only, 50)
    expect(s.suggestedBaseUrl).toContain('{host}')
    expect((s.serverVariables || []).length).toBe(2)
  })
})
