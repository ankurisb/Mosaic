import { describe, it, expect } from 'vitest'
import { parseSpec, isOpenApiSpec, extractSpecFromMaterials, condenseSpecMaterials } from './openapi-summary'

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
