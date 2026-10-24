import { describe, it, expect } from 'vitest'
import { mergeSpecBlocks, extractSpecFromMaterials, summarizeOpenApi } from './openapi-summary'

// Two co-dropped files: the primary spec (paths) whose /login requestBody
// references a schema that lives in a SEPARATE file via an external $ref. Stage 5
// merges the component pools and resolves the ref by fragment.
const PRIMARY = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'Main', version: '1' },
  servers: [{ url: 'https://api.example.com' }],
  paths: {
    '/login': {
      post: {
        summary: 'Log in',
        requestBody: { content: { 'application/json': { schema: { $ref: 'common.yaml#/components/schemas/LoginReq' } } } },
      },
    },
    '/widgets': { get: { summary: 'List widgets' } },
  },
})
const COMMON = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'Common', version: '1' },
  components: { schemas: { LoginReq: { type: 'object', required: ['username'], properties: { username: { type: 'string' }, password: { type: 'string' } } } } },
})
const MATERIALS = `=== openapi.json ===\n${PRIMARY}\n\n=== common.yaml ===\n${COMMON}`

describe('mergeSpecBlocks', () => {
  it('folds a second file\'s components into the primary (which has the paths)', () => {
    const merged = mergeSpecBlocks(MATERIALS) as { paths?: Record<string, unknown>; components?: { schemas?: Record<string, unknown> } }
    expect(merged.paths && '/login' in merged.paths).toBe(true)
    expect(merged.components?.schemas && 'LoginReq' in merged.components.schemas).toBe(true)
  })
  it('returns a single spec unchanged', () => {
    const merged = mergeSpecBlocks(PRIMARY) as { paths?: Record<string, unknown> }
    expect(merged.paths && '/login' in merged.paths).toBe(true)
  })
})

describe('cross-file $ref resolves end-to-end into login fields', () => {
  it('resolves common.yaml#/.../LoginReq referenced by the primary /login body', () => {
    const spec = extractSpecFromMaterials(MATERIALS)
    const sum = summarizeOpenApi(spec)
    expect(sum.ok).toBe(true)
    const login = sum.loginCandidates.find(l => l.path.endsWith('/login'))
    expect(login).toBeDefined()
    const names = (login?.fields || []).map(f => f.name).sort()
    expect(names).toEqual(['password', 'username'])
    expect(login?.fields.find(f => f.name === 'username')?.required).toBe(true)
  })
})
