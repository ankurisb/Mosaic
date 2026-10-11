// lib/ai/openapi-summary.ts
// Compress an OpenAPI 3.x / Swagger 2.0 spec into a compact summary the builder
// agent can read in-context (a real spec can be hundreds of KB). Surfaces the
// decisive facts: base URLs, auth schemes, the login endpoint(s) WITH their
// request field names (so the agent posts the right keys), and a capped list of
// endpoints. Pure — the caller fetches/parses (JSON or YAML) and passes the object.

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

export interface LoginCandidate { method: string; path: string; fields: { name: string; required: boolean }[]; summary?: string }
export interface EndpointRef { method: string; path: string; summary?: string; hasPathParams: boolean }
export interface OpenApiSummary {
  ok: boolean
  reason?: string
  title?: string
  version?: string
  servers: string[]
  securitySchemes: Record<string, { type?: string; scheme?: string; in?: string; name?: string }>
  loginCandidates: LoginCandidate[]
  endpoints: EndpointRef[]
  endpointCount: number
}

const LOGIN_RE = /(login|authenticate|signin|sign-in|token|session|oauth)/i
const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete']

/** Resolve a local $ref ("#/components/schemas/X" or "#/definitions/X"). */
function resolveRef(spec: Obj, ref: string): Obj | null {
  if (!ref.startsWith('#/')) return null
  let cur: unknown = spec
  for (const part of ref.slice(2).split('/')) {
    if (!isObj(cur)) return null
    cur = cur[decodeURIComponent(part.replace(/~1/g, '/').replace(/~0/g, '~'))]
  }
  return isObj(cur) ? cur : null
}

/** Field names (+required) from a request schema, resolving $ref and allOf shallowly. */
function schemaFields(spec: Obj, schema: unknown, depth = 0): { name: string; required: boolean }[] {
  if (!isObj(schema) || depth > 4) return []
  if (typeof schema.$ref === 'string') return schemaFields(spec, resolveRef(spec, schema.$ref), depth + 1)
  const out: { name: string; required: boolean }[] = []
  const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : [])
  if (isObj(schema.properties)) {
    for (const name of Object.keys(schema.properties)) out.push({ name, required: required.has(name) })
  }
  for (const key of ['allOf', 'oneOf', 'anyOf']) {
    if (Array.isArray(schema[key])) for (const s of schema[key] as unknown[]) out.push(...schemaFields(spec, s, depth + 1))
  }
  // de-dupe by name
  const seen = new Set<string>()
  return out.filter(f => (seen.has(f.name) ? false : (seen.add(f.name), true)))
}

/** Request-body fields for an operation (OpenAPI 3 requestBody, or Swagger 2 body param). */
function operationRequestFields(spec: Obj, op: Obj): { name: string; required: boolean }[] {
  // OpenAPI 3: requestBody.content['application/json' | first].schema
  const rb = op.requestBody
  if (isObj(rb) && isObj(rb.content)) {
    const content = rb.content as Obj
    const media = (content['application/json'] || content[Object.keys(content)[0]]) as Obj | undefined
    if (isObj(media) && media.schema) return schemaFields(spec, media.schema)
  }
  // Swagger 2: a body parameter with a schema, plus formData params
  if (Array.isArray(op.parameters)) {
    const body = (op.parameters as Obj[]).find(p => p.in === 'body' && p.schema)
    if (body) return schemaFields(spec, body.schema)
    const form = (op.parameters as Obj[]).filter(p => p.in === 'formData').map(p => ({ name: String(p.name), required: !!p.required }))
    if (form.length) return form
  }
  return []
}

function serversOf(spec: Obj): string[] {
  const out: string[] = []
  if (Array.isArray(spec.servers)) for (const s of spec.servers as Obj[]) if (typeof s.url === 'string') out.push(s.url)
  // Swagger 2
  if (!out.length && typeof spec.host === 'string') {
    const schemes = Array.isArray(spec.schemes) && (spec.schemes as string[]).length ? (spec.schemes as string[]) : ['https']
    const base = typeof spec.basePath === 'string' ? spec.basePath : ''
    out.push(`${schemes[0]}://${spec.host}${base}`)
  }
  return out
}

function securityOf(spec: Obj): OpenApiSummary['securitySchemes'] {
  const out: OpenApiSummary['securitySchemes'] = {}
  const comp = isObj(spec.components) ? (spec.components.securitySchemes as Obj) : undefined
  const swagger2 = spec.securityDefinitions as Obj | undefined
  const src = isObj(comp) ? comp : isObj(swagger2) ? swagger2 : undefined
  if (isObj(src)) for (const [k, v] of Object.entries(src)) {
    if (isObj(v)) out[k] = { type: v.type as string, scheme: v.scheme as string, in: v.in as string, name: v.name as string }
  }
  return out
}

export function summarizeOpenApi(spec: unknown, endpointCap = 80): OpenApiSummary {
  if (!isObj(spec)) return { ok: false, reason: 'Not a spec object', servers: [], securitySchemes: {}, loginCandidates: [], endpoints: [], endpointCount: 0 }
  const paths = isObj(spec.paths) ? (spec.paths as Obj) : undefined
  if (!paths) return { ok: false, reason: 'No paths in spec', servers: [], securitySchemes: {}, loginCandidates: [], endpoints: [], endpointCount: 0 }

  const info = isObj(spec.info) ? spec.info : {}
  const endpoints: EndpointRef[] = []
  const loginCandidates: LoginCandidate[] = []

  for (const p of Object.keys(paths)) {
    const item = paths[p]
    if (!isObj(item)) continue
    for (const m of HTTP_METHODS) {
      const op = item[m]
      if (!isObj(op)) continue
      const summary = typeof op.summary === 'string' ? op.summary : (typeof op.operationId === 'string' ? op.operationId : undefined)
      endpoints.push({ method: m.toUpperCase(), path: p, summary, hasPathParams: /\{[^}]+\}/.test(p) })
      if (m === 'post' && LOGIN_RE.test(p)) {
        loginCandidates.push({ method: 'POST', path: p, summary, fields: operationRequestFields(spec, op) })
      }
    }
  }

  // Prefer GETs without path params first in the capped list — those are the
  // cheap "list" endpoints the agent should probe to confirm auth.
  endpoints.sort((a, b) => {
    const score = (e: EndpointRef) => (e.method === 'GET' ? 0 : 2) + (e.hasPathParams ? 1 : 0)
    return score(a) - score(b)
  })

  return {
    ok: true,
    title: typeof info.title === 'string' ? info.title : undefined,
    version: typeof info.version === 'string' ? info.version : undefined,
    servers: serversOf(spec),
    securitySchemes: securityOf(spec),
    loginCandidates,
    endpoints: endpoints.slice(0, endpointCap),
    endpointCount: endpoints.length,
  }
}
