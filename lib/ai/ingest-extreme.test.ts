// lib/ai/ingest-extreme.test.ts
// Adversarial audit of the API-ingestion funnel. The contract: condenseApiMaterials
// is the single door every dropped artifact goes through before the AI drafts, so
// it must NEVER throw and must always return a string (degrade to passthrough when
// it can't recognise the input). The spec parsers must survive malformed input.
import { describe, it, expect } from 'vitest'
import { condenseApiMaterials } from './api-materials'
import { parseSpec, extractSpecFromMaterials, summarizeOpenApi, mergeSpecBlocks } from './openapi-summary'
import { isEdmx, edmxToSummary } from './edmx'

const noThrow = (label: string, materials: string) => {
  it(`degrades (no throw) + returns a string: ${label}`, () => {
    let out: string | undefined
    expect(() => { out = condenseApiMaterials(materials) }).not.toThrow()
    expect(typeof out === 'string' || out === undefined).toBe(true)
  })
}

// ===== Block A — malformed / adversarial inputs must degrade, not throw ======
describe('Block A — malformed inputs degrade gracefully', () => {
  // A1 truncated JSON spec (cut mid-object)
  const bigSpec = JSON.stringify({ openapi: '3.0.0', info: { title: 'X', version: '1' }, servers: [{ url: 'https://api.x' }], paths: { '/a': { get: {} }, '/b': { get: {} } } })
  noThrow('A1 truncated JSON', bigSpec.slice(0, bigSpec.length - 40))
  // A2 BOM + leading junk + CRLF
  noThrow('A2 BOM + junk + CRLF', '\uFEFF   // a note\r\n' + bigSpec.replace(/\n/g, '\r\n'))
  // A3 YAML with tabs and anchors/aliases
  noThrow('A3 YAML anchors/aliases', `openapi: 3.0.0\ninfo: &i\n  title: T\n  version: '1'\nservers:\n  - url: https://api.x\npaths:\n  /a:\n    get:\n      responses: {}\n  /b:\n    get: *i\n`)
  // A4 EDMX with XML comment, DTD, mixed namespaces, no DataServiceVersion
  noThrow('A4 EDMX comments/DTD/ns', `<?xml version="1.0"?>\n<!-- a comment --><!DOCTYPE edmx>\n<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx"><edmx:DataServices><Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="NS"><EntityType Name="P"><Key><PropertyRef Name="Id"/></Key><Property Name="Id" Type="Edm.String"/></EntityType><EntityContainer Name="C"><EntitySet Name="Ps" EntityType="NS.P"/></EntityContainer></Schema></edmx:DataServices></edmx:Edmx>`)
  // A5 EDMX: entity set referencing a missing type, no keys
  noThrow('A5 EDMX dangling type', `<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx"><edmx:DataServices><Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="NS"><EntityContainer Name="C"><EntitySet Name="Orphans" EntityType="NS.DoesNotExist"/></EntityContainer></Schema></edmx:DataServices></edmx:Edmx>`)
  // A6 empty / whitespace / control bytes
  noThrow('A6a empty', '')
  noThrow('A6b whitespace', '   \n\t  ')
  noThrow('A6c control bytes', '\u0000\u0001\u0002 not a spec \u0007')
  // A7 Postman: deeply nested folders (>8) + url as object/array/missing
  const deep = (d: number): unknown => d > 0 ? { name: `f${d}`, item: [deep(d - 1)] } : { name: 'leaf', request: { method: 'GET', url: { raw: 'https://api.x/a' } } }
  noThrow('A7a Postman deep nesting', JSON.stringify({ info: { name: 'P', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, item: [deep(12)] }))
  noThrow('A7b Postman url shapes', JSON.stringify({ info: { name: 'P', schema: 'postman' }, item: [{ name: 'a', request: { method: 'GET', url: { host: ['api', 'x'], path: ['v1', 'a'] } } }, { name: 'b', request: { method: 'POST' } }, { name: 'c', request: {} }] }))
  // A8 HAR: no entries / non-http url / huge body
  noThrow('A8a HAR empty', JSON.stringify({ log: { entries: [] } }))
  noThrow('A8b HAR weird urls', JSON.stringify({ log: { entries: [{ request: { method: 'GET', url: 'ftp://nope/x', headers: [{ name: 'Authorization', value: 'secret' }] } }, { request: { method: 'GET', url: 'notaurl', headers: [] } }] } }))
  noThrow('A8c HAR huge body', JSON.stringify({ log: { entries: [{ request: { method: 'POST', url: 'https://api.x/a', headers: [], postData: { text: 'x'.repeat(200000) } } }] } }))
  // bonus: non-API prose passes through unchanged
  it('non-API prose passes through unchanged', () => {
    const prose = 'Our API lives at https://api.example.com and uses an API key.'
    expect(condenseApiMaterials(prose)).toBe(prose)
  })
  // bonus: HAR auth header VALUES are never leaked into the condensed summary
  it('A8 HAR never leaks auth header values', () => {
    const out = condenseApiMaterials(JSON.stringify({ log: { entries: [{ request: { method: 'GET', url: 'https://api.x/a', headers: [{ name: 'Authorization', value: 'Bearer SUPERSECRET' }] } }] } })) || ''
    expect(out).not.toContain('SUPERSECRET')
  })
})

// ===== Block B — degenerate-but-valid specs still yield a usable summary =====
describe('Block B — degenerate specs still summarise', () => {
  it('B1 OpenAPI 3.1 with paths + webhooks: endpoints found, webhooks ignored', () => {
    const spec = { openapi: '3.1.0', info: { title: 'T', version: '1' }, servers: [{ url: 'https://api.x' }], webhooks: { onEvent: { post: {} } }, paths: { '/widgets': { get: {} } } }
    const s = summarizeOpenApi(spec)
    expect(s.ok).toBe(true)
    expect(s.endpoints.some(e => e.path === '/widgets')).toBe(true)
  })
  it('B2 Swagger 2.0 with no host/schemes: summarises, servers empty, no "undefined://"', () => {
    const spec = { swagger: '2.0', info: { title: 'T', version: '1' }, paths: { '/a': { get: {} } } }
    const s = summarizeOpenApi(spec)
    expect(s.ok).toBe(true)
    expect(s.servers).toEqual([])
    expect(s.suggestedBaseUrl === undefined || !/undefined/.test(s.suggestedBaseUrl)).toBe(true)
    expect(s.endpoints.some(e => e.path === '/a')).toBe(true)
  })
  it('B3 multiple servers: prefers the fully-concrete one over a templated one', () => {
    const spec = { openapi: '3.0.0', info: { title: 'T', version: '1' }, servers: [{ url: 'https://{region}.api.x/v1' }, { url: 'https://api.concrete.com/v1' }], paths: { '/a': { get: {} } } }
    const s = summarizeOpenApi(spec)
    expect(s.suggestedBaseUrl).toContain('api.concrete.com')
  })
  it('B4 only a templated server: substitutes defaults AND surfaces the variables as fields', () => {
    const spec = { openapi: '3.0.0', info: { title: 'T', version: '1' }, servers: [{ url: 'https://{host}:{port}/odata', variables: { host: { default: 'sap.example.com' }, port: { default: '44300' } } }], paths: { '/a': { get: {} } } }
    const s = summarizeOpenApi(spec)
    const varNames = (s.serverVariables || []).map(v => v.name).sort()
    expect(varNames).toEqual(['host', 'port'])
    // default substitution gives a concrete suggestion to probe
    expect(s.suggestedBaseUrl).toContain('sap.example.com:44300')
  })
  it('B5 2000 paths: true count + all groups preserved, endpoint detail capped', () => {
    const paths: Record<string, unknown> = {}
    for (let i = 0; i < 2000; i++) paths[`/grp${i % 40}/res${i}`] = { get: {} }
    const spec = { openapi: '3.0.0', info: { title: 'T', version: '1' }, servers: [{ url: 'https://api.x' }], paths }
    const s = summarizeOpenApi(spec)
    expect(s.endpointCount).toBe(2000)            // true count NOT lost
    expect(s.groups.length).toBe(40)              // all groups discovered (builder makes 1 conn/group)
    expect(s.endpoints.length).toBeLessThanOrEqual(150)  // only the detail list is capped
  })
})

// ===== Block C — detection order / false positives ==========================
describe('Block C — detection precedence', () => {
  it('C1 a real OpenAPI whose TEXT contains <Edmx>/DataServices is NOT hijacked by EDMX', () => {
    const spec = JSON.stringify({ openapi: '3.0.0', info: { title: 'Legacy bridge', version: '1', description: 'Replaces the old <Edmx> DataServices SOAP gateway.' }, servers: [{ url: 'https://api.x' }], paths: { '/widgets': { get: {} } } })
    const out = condenseApiMaterials(spec) || ''
    expect(out).toMatch(/OpenAPI spec/i)         // routed to the OpenAPI summariser
    expect(out).not.toMatch(/EDMX/i)             // NOT the EDMX path
  })
  it('C2 real EDMX is still detected when its text also mentions openapi/swagger', () => {
    const edmx = `<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx"><!-- not an openapi/swagger file --><edmx:DataServices><Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="NS"><EntityType Name="P"><Key><PropertyRef Name="Id"/></Key><Property Name="Id" Type="Edm.String"/></EntityType><EntityContainer Name="C"><EntitySet Name="Ps" EntityType="NS.P"/></EntityContainer></Schema></edmx:DataServices></edmx:Edmx>`
    expect(isEdmx(edmx)).toBe(true)
    const out = condenseApiMaterials(edmx) || ''
    expect(out).toMatch(/EDMX/i)
  })
  it('C3 EDMX + OpenAPI dropped together: resolves to one summary, no crash', () => {
    const edmx = `=== metadata.xml ===\n<edmx:Edmx Version="2.0" xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx"><edmx:DataServices m:DataServiceVersion="2.0" xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata"><Schema xmlns="http://schemas.microsoft.com/ado/2008/09/edm" Namespace="NS"><EntityType Name="P"><Key><PropertyRef Name="Id"/></Key><Property Name="Id" Type="Edm.String"/></EntityType><EntityContainer Name="C"><EntitySet Name="Ps" EntityType="NS.P"/></EntityContainer></Schema></edmx:DataServices></edmx:Edmx>`
    const oas = `=== openapi.json ===\n${JSON.stringify({ openapi: '3.0.0', info: { title: 'T', version: '1' }, paths: { '/a': { get: {} } } })}`
    let out: string | undefined
    expect(() => { out = condenseApiMaterials(`${edmx}\n\n${oas}`) }).not.toThrow()
    expect((out || '').length).toBeGreaterThan(0)
  })
})

// ===== Block D — multi-file $ref edge cases =================================
describe('Block D — multi-file $ref robustness', () => {
  it('D1 circular cross-file $ref terminates (no infinite loop / stack overflow)', () => {
    const primary = JSON.stringify({ openapi: '3.0.0', info: { title: 'M', version: '1' }, servers: [{ url: 'https://api.x' }], paths: { '/login': { post: { requestBody: { content: { 'application/json': { schema: { $ref: 'types.json#/components/schemas/A' } } } } } } } })
    const types = JSON.stringify({ openapi: '3.0.0', info: { title: 'T', version: '1' }, components: { schemas: { A: { type: 'object', properties: { user: { type: 'string' }, b: { $ref: 'types.json#/components/schemas/B' } } }, B: { type: 'object', properties: { a: { $ref: 'types.json#/components/schemas/A' } } } } } })
    const materials = `=== openapi.json ===\n${primary}\n\n=== types.json ===\n${types}`
    let summarised = false
    expect(() => { const s = summarizeOpenApi(extractSpecFromMaterials(materials)); summarised = s.ok === true }).not.toThrow()
    expect(summarised).toBe(true)   // completed — the depth guard stopped the cycle
  })
  it('D2 $ref to a missing fragment degrades (no throw, empty fields)', () => {
    const primary = JSON.stringify({ openapi: '3.0.0', info: { title: 'M', version: '1' }, paths: { '/login': { post: { requestBody: { content: { 'application/json': { schema: { $ref: 'gone.json#/components/schemas/Nope' } } } } } } } })
    let s: ReturnType<typeof summarizeOpenApi> | undefined
    expect(() => { s = summarizeOpenApi(extractSpecFromMaterials(`=== openapi.json ===\n${primary}`)) }).not.toThrow()
    const login = s!.loginCandidates.find(l => l.path.endsWith('/login'))
    expect(login?.fields).toEqual([])   // unresolved ref → no fields, but no crash
  })
  it('D3 three files: paths split across two + shared components in the third', () => {
    const f1 = JSON.stringify({ openapi: '3.0.0', info: { title: 'A', version: '1' }, servers: [{ url: 'https://api.x' }], paths: { '/login': { post: { requestBody: { content: { 'application/json': { schema: { $ref: 'shared.json#/components/schemas/Login' } } } } } } } })
    const f2 = JSON.stringify({ openapi: '3.0.0', info: { title: 'B', version: '1' }, paths: { '/orders': { get: {} }, '/invoices': { get: {} } } })
    const f3 = JSON.stringify({ openapi: '3.0.0', info: { title: 'C', version: '1' }, components: { schemas: { Login: { type: 'object', required: ['user'], properties: { user: { type: 'string' }, pass: { type: 'string' } } } } } })
    const s = summarizeOpenApi(extractSpecFromMaterials(`=== a.json ===\n${f1}\n\n=== b.json ===\n${f2}\n\n=== shared.json ===\n${f3}`))
    const paths = s.endpoints.map(e => e.path)
    expect(paths).toContain('/orders')
    expect(paths).toContain('/invoices')
    const login = s.loginCandidates.find(l => l.path.endsWith('/login'))
    expect((login?.fields || []).map(f => f.name).sort()).toEqual(['pass', 'user'])
  })
})

// ===== Block E — the 24KB residual wall =====================================
// An UNRECOGNISED large artifact (not OpenAPI/Postman/HAR/EDMX) must not be passed
// through whole: downstream the AI prompt slices materials to 24000 chars (head),
// so critical info at the END (base URL, auth) is silently lost. The funnel must
// instead condense an unknown-but-large input to fit the budget WHILE keeping the
// signal — the "AI absorbs any variety" promise applied to formats we don't parse.
describe('Block E — large unrecognised artifact keeps its signal within budget', () => {
  const BUDGET = 24000
  it('E1 base URL + auth at the TAIL of a 30KB unknown doc survive condensation', () => {
    const filler = Array.from({ length: 1200 }, (_, i) => `Section ${i}: this is narrative API documentation prose describing behaviour, rate limits and examples in detail.`).join('\n')
    const tail = `\n\nConnect to Base URL: https://real.api.example.com/v2\nAuthentication: send the header X-Secret-Key: <your key>. Endpoints include GET /customers and GET /orders.`
    const doc = filler + tail
    expect(doc.length).toBeGreaterThan(30000)
    const out = condenseApiMaterials(doc) || ''
    expect(out.length).toBeLessThanOrEqual(BUDGET)                 // fits the prompt budget
    expect(out).toContain('https://real.api.example.com/v2')       // tail base URL preserved
    expect(out).toMatch(/X-Secret-Key/i)                           // tail auth preserved
  })
  it('E2 small unknown prose still passes through unchanged (no over-eager condensing)', () => {
    const prose = 'Our API is at https://api.example.com; use an API key in X-API-Key.'
    expect(condenseApiMaterials(prose)).toBe(prose)
  })
})

// ===== Block F — probe URL building edge cases ==============================
import { buildUrl } from '../api-probe'
describe('Block F — buildUrl joins cleanly', () => {
  it('F1 no double slash when base ends with / and path starts with /', () => {
    expect(buildUrl('https://api.x/', '', '/orders')).toBe('https://api.x/orders')
    expect(buildUrl('https://api.x', '/v1/', '/orders')).toBe('https://api.x/v1/orders')
  })
  it('F2 merges query when the path already has one', () => {
    expect(buildUrl('https://api.x', '', '/search?q=1', { limit: '10' })).toBe('https://api.x/search?q=1&limit=10')
    expect(buildUrl('https://api.x', '', '/search', { q: '1' })).toBe('https://api.x/search?q=1')
  })
  it('F3 adds a leading slash to a bare path and encodes query values', () => {
    expect(buildUrl('https://api.x', '', 'orders')).toBe('https://api.x/orders')
    expect(buildUrl('https://api.x', '', '/s', { q: 'a b&c' })).toBe('https://api.x/s?q=a%20b%26c')
  })
  it('F4 empty path and blank query values are handled', () => {
    expect(buildUrl('https://api.x/', '', '')).toBe('https://api.x')
    expect(buildUrl('https://api.x', '', '/a', { skip: '', top: '5' })).toBe('https://api.x/a?top=5')
  })
  it('F5 OData keyed-read path with parens/quotes is preserved', () => {
    expect(buildUrl('https://sap.x', '/odata', "/ProductSet('P1')", { $format: 'json' })).toBe("https://sap.x/odata/ProductSet('P1')?$format=json")
  })
})
