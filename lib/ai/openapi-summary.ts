// lib/ai/openapi-summary.ts
// Compress an OpenAPI 3.x / Swagger 2.0 spec into a compact summary the builder
// agent can read in-context (a real spec can be hundreds of KB). Surfaces the
// decisive facts: the base URL to call (resolved, including any shared mount
// prefix), the auth schemes, the login endpoint(s) WITH their request field
// names (so the agent posts the right keys), the endpoint GROUPS, and a capped
// list of endpoints — all with paths RELATIVE to the resolved base URL, so the
// agent never has to reason about prefixes. Pure — the caller fetches/parses
// (JSON or YAML) and passes the object plus (ideally) the spec's own URL.

import yaml from 'js-yaml'

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
  // The base URL the agent should use verbatim as service.base_url: the resolved
  // server origin + any shared mount prefix (e.g. "https://host/api"). All paths
  // below are relative to THIS — the agent must not re-add the prefix.
  suggestedBaseUrl?: string
  // The shared leading path prefix folded into suggestedBaseUrl (e.g. "/api"), or
  // "" when paths don't share one. Informational.
  commonPrefix: string
  securitySchemes: Record<string, { type?: string; scheme?: string; in?: string; name?: string }>
  loginCandidates: LoginCandidate[]
  groups: string[]
  endpoints: EndpointRef[]
  endpointCount: number
  // Unresolved server-URL variables (e.g. SAP's {host}/{port}) the caller must
  // supply to target their own host. Empty when the base URL is fully concrete.
  serverVariables?: { name: string; description?: string }[]
}

const LOGIN_RE = /(login|authenticate|signin|sign-in|token|session|oauth)/i
const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete']
// Leading segments that are mount points, not meaningful groups — peel them so
// grouping happens on the real resource segments underneath.
const MOUNT_SEG = /^(api|apis|rest|public|internal|services?|v\d+(?:[._]\d+)*)$/i

/**
 * Resolve a $ref against the spec. Handles a local ref ("#/components/schemas/X")
 * and an external-file ref ("components.yaml#/components/schemas/X" or
 * "./types.json#/Foo") — for the latter we resolve the FRAGMENT after '#' against
 * the spec, which works once co-dropped files have been merged into one component
 * pool (see mergeSpecBlocks). An external ref with no fragment can't be resolved.
 */
function resolveRef(spec: Obj, ref: string): Obj | null {
  const hashIdx = ref.indexOf('#')
  const frag = hashIdx >= 0 ? ref.slice(hashIdx + 1) : ''   // "/components/schemas/X"
  if (!frag.startsWith('/')) return null
  let cur: unknown = spec
  for (const part of frag.slice(1).split('/')) {
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

/**
 * Resolve the server base URL (scheme+host+path) the paths are relative to.
 * - absolute server → use as-is
 * - relative/empty server → spec document's origin (+ the relative server path)
 * Returns '' when nothing can be resolved (no absolute server, no spec URL).
 */
function resolveServerBase(spec: Obj, specUrl?: string): string {
  const s = (serversOf(spec)[0] || '').trim()
  let origin = ''
  if (specUrl) { try { origin = new URL(specUrl).origin } catch {} }
  if (/^https?:\/\//i.test(s)) return s.replace(/\/+$/, '')
  if (!s) return origin
  return (origin + (s.startsWith('/') ? s : '/' + s)).replace(/\/+$/, '')
}

interface ServerVar { name: string; description?: string }
/**
 * Choose the base URL from the servers list, substituting each server's variable
 * defaults. PREFER a fully-concrete absolute server (no leftover {vars}) — e.g.
 * SAP ships a templated "https://{host}:{port}/sap/opu/odata/sap/API_X" first and
 * a concrete sandbox URL second; we pick the sandbox so the connection is testable
 * out of the box. The unresolved variables from any server (e.g. {host}/{port})
 * are returned so the builder can SURFACE them as fields to point at the user's
 * own host.
 */
function pickServerBase(spec: Obj, specUrl?: string): { base: string; variables: ServerVar[] } {
  const servers = Array.isArray(spec.servers) ? (spec.servers as Obj[]) : []
  const resolved: { url: string; unresolved: ServerVar[] }[] = []
  for (const s of servers) {
    if (typeof s.url !== 'string') continue
    const vars = isObj(s.variables) ? (s.variables as Obj) : {}
    const unresolved: ServerVar[] = []
    const url = s.url.replace(/\{([^}]+)\}/g, (_m: string, name: string) => {
      const v = isObj(vars[name]) ? (vars[name] as Obj) : undefined
      const def = v && typeof v.default === 'string' ? v.default.trim() : ''
      if (!def) unresolved.push({ name, description: v && typeof v.description === 'string' ? v.description : undefined })
      return def || `{${name}}`
    }).replace(/\/+$/, '')
    resolved.push({ url, unresolved })
  }
  const allVars = new Map<string, ServerVar>()
  for (const r of resolved) for (const v of r.unresolved) if (!allVars.has(v.name)) allVars.set(v.name, v)

  // 1. a fully concrete absolute server
  const concrete = resolved.find(r => r.unresolved.length === 0 && /^https?:\/\//i.test(r.url) && !/\{[^}]+\}/.test(r.url))
  if (concrete) return { base: concrete.url, variables: [...allVars.values()] }
  // 2. first server (may be templated / relative — resolve relative against the spec origin)
  if (resolved.length) {
    let base = resolved[0].url
    if (!/^https?:\/\//i.test(base) && specUrl) { try { base = (new URL(specUrl).origin + (base.startsWith('/') ? base : '/' + base)).replace(/\/+$/, '') } catch { /* keep */ } }
    return { base, variables: [...allVars.values()] }
  }
  // 3. swagger2 host / spec origin fallback
  return { base: resolveServerBase(spec, specUrl), variables: [] }
}

/**
 * Peel leading path segments shared by ALL endpoints when they are mount points
 * (api, v1, …) or when peeling turns a single top-level group into several real
 * ones — but never so far that a path would be left empty. Returns the peeled
 * prefix ("/api", "") and a strip() that rewrites a raw path to be relative to it.
 */
function peelPrefix(paths: string[]): { prefix: string; strip: (p: string) => string } {
  const splits = paths.map(p => p.split('/').filter(Boolean))
  const prefixSegs: string[] = []
  let cur = splits
  // guard against pathological specs
  for (let guard = 0; guard < 8; guard++) {
    if (!cur.length) break
    // Stripping must leave every path with at least one segment.
    if (!cur.every(s => s.length >= 2)) break
    const first = cur[0][0]
    if (!cur.every(s => s[0] === first)) break
    const distinctNext = new Set(cur.map(s => s[1]))
    // Peel if it's a recognised mount segment, OR if everything currently sits
    // under this one segment but branches into several real groups beneath it.
    if (!MOUNT_SEG.test(first) && distinctNext.size < 2) break
    prefixSegs.push(first)
    cur = cur.map(s => s.slice(1))
  }
  const prefix = prefixSegs.length ? '/' + prefixSegs.join('/') : ''
  const strip = (p: string): string => {
    if (!prefix) return p
    if (p === prefix) return '/'
    const rest = p.startsWith(prefix + '/') ? p.slice(prefix.length) : p
    return rest.startsWith('/') ? rest : '/' + rest
  }
  return { prefix, strip }
}

export function summarizeOpenApi(spec: unknown, endpointCap = 150, specUrl?: string): OpenApiSummary {
  const empty = { servers: [], commonPrefix: '', securitySchemes: {}, loginCandidates: [], groups: [], endpoints: [], endpointCount: 0 }
  if (!isObj(spec)) return { ok: false, reason: 'Not a spec object', ...empty }
  const paths = isObj(spec.paths) ? (spec.paths as Obj) : undefined
  if (!paths) return { ok: false, reason: 'No paths in spec', ...empty }

  const info = isObj(spec.info) ? spec.info : {}

  // Peel any shared mount prefix so grouping and base_url are correct even when
  // servers is empty and every path carries the mount (e.g. "/api/...").
  const rawPaths = Object.keys(paths).filter(p => isObj(paths[p]))
  const { prefix, strip } = peelPrefix(rawPaths)

  const endpoints: EndpointRef[] = []
  const loginCandidates: LoginCandidate[] = []

  for (const p of rawPaths) {
    const item = paths[p]
    if (!isObj(item)) continue
    const rel = strip(p)
    for (const m of HTTP_METHODS) {
      const op = item[m]
      if (!isObj(op)) continue
      const summary = typeof op.summary === 'string' ? op.summary : (typeof op.operationId === 'string' ? op.operationId : undefined)
      endpoints.push({ method: m.toUpperCase(), path: rel, summary, hasPathParams: /\{[^}]+\}/.test(rel) })
      if (m === 'post' && LOGIN_RE.test(p)) {
        loginCandidates.push({ method: 'POST', path: rel, summary, fields: operationRequestFields(spec, op) })
      }
    }
  }

  // Prefer GETs without path params first in the capped list — those are the
  // cheap "list" endpoints the agent should probe to confirm auth.
  endpoints.sort((a, b) => {
    const score = (e: EndpointRef) => (e.method === 'GET' ? 0 : 2) + (e.hasPathParams ? 1 : 0)
    return score(a) - score(b)
  })

  // Distinct top-level segments of the RELATIVE paths — the natural
  // "connections" (endpoint groups) to register, one per group.
  const groups = Array.from(new Set(endpoints.map(e => e.path.split('/').filter(Boolean)[0] || '').filter(Boolean))).sort()

  const picked = pickServerBase(spec, specUrl)
  const serverBase = picked.base
  const suggestedBaseUrl = serverBase ? (serverBase + prefix).replace(/\/+$/, '') || serverBase : (prefix || undefined)

  return {
    ok: true,
    title: typeof info.title === 'string' ? info.title : undefined,
    version: typeof info.version === 'string' ? info.version : undefined,
    servers: serversOf(spec),
    suggestedBaseUrl: suggestedBaseUrl || undefined,
    commonPrefix: prefix,
    securitySchemes: securityOf(spec),
    loginCandidates,
    groups,
    endpoints: endpoints.slice(0, endpointCap),
    endpointCount: endpoints.length,
    serverVariables: picked.variables.length ? picked.variables : undefined,
  }
}

// ---- Spec ingestion from uploaded/pasted/fetched text (JSON or YAML) --------
// Shared by the AI builder's generate/agent paths and by endpoint discovery, so a
// spec a company hands us as a file is treated exactly like one we fetch live.

/** Parse spec text as JSON, falling back to YAML. (JSON is valid YAML, but we try
 *  JSON first for speed/accuracy.) Returns null if neither parses. */
export function parseSpec(text: string): unknown {
  if (!text || !text.trim()) return null
  try { return JSON.parse(text) } catch { /* not json */ }
  try { return yaml.load(text) } catch { /* not yaml */ }
  return null
}

/** True when the object looks like an OpenAPI 3.x / Swagger 2.0 document. */
export function isOpenApiSpec(o: unknown): boolean {
  return isObj(o) && !!o.paths && (!!o.openapi || !!o.swagger)
}

// Materials from the builder are a concatenation of "===== name =====" blocks.
// Split them back out (or return the whole string when there are no headers).
export function splitMaterialBlocks(materials: string): string[] {
  const parts = materials.split(/[ \t]*={3,}[^\n]*={3,}[ \t]*\r?\n?/g).map(s => s.trim()).filter(Boolean)
  return parts.length ? parts : (materials.trim() ? [materials.trim()] : [])
}

/**
 * Deep-merge source's plain-object maps into target (shallow per top-level key,
 * recursive for nested objects), without overwriting an existing concrete value.
 * Used to pool components/definitions from several co-dropped spec files.
 */
function mergePools(target: Obj, source: unknown): void {
  if (!isObj(source)) return
  for (const [k, v] of Object.entries(source)) {
    if (isObj(v)) { if (!isObj(target[k])) target[k] = {}; mergePools(target[k] as Obj, v) }
    else if (!(k in target)) target[k] = v
  }
}

/**
 * Merge several co-dropped OpenAPI spec blocks into one. The primary is the block
 * that actually has `paths`; the others contribute their `components`,
 * `definitions`, parameters, responses and security schemes to a shared pool, so
 * an external-file `$ref` (resolved by fragment) finds its target. A single spec
 * is returned unchanged.
 */
export function mergeSpecBlocks(materials: string): unknown | null {
  // A block counts if it is a full spec OR a fragment file carrying a shared
  // component pool (components/definitions) or extra paths — the latter has no
  // `paths`+`openapi`, so isOpenApiSpec rejects it, but its schemas are exactly
  // what an external $ref points at.
  const isFragment = (o: unknown): o is Obj => isObj(o) && (isObj(o.components) || isObj(o.definitions) || isObj(o.paths))
  const blocks: Obj[] = []
  const whole = parseSpec(materials)
  if (isOpenApiSpec(whole) && isObj(whole)) blocks.push(whole)
  if (!blocks.length) {
    for (const b of splitMaterialBlocks(materials)) {
      const s = parseSpec(b)
      if ((isOpenApiSpec(s) || isFragment(s)) && isObj(s)) blocks.push(s)
    }
  }
  if (!blocks.length) return null
  if (blocks.length === 1) return blocks[0]
  // Primary = the first real spec (paths + openapi/swagger); else the first block
  // that at least has paths; else the first block.
  let primaryIdx = blocks.findIndex(s => isOpenApiSpec(s))
  if (primaryIdx < 0) primaryIdx = blocks.findIndex(s => isObj(s.paths))
  if (primaryIdx < 0) primaryIdx = 0
  const primary = blocks[primaryIdx]
  for (let i = 0; i < blocks.length; i++) {
    if (i === primaryIdx) continue
    const s = blocks[i]
    if (isObj(s.components)) { if (!isObj(primary.components)) primary.components = {}; mergePools(primary.components as Obj, s.components) }
    if (isObj(s.definitions)) { if (!isObj(primary.definitions)) primary.definitions = {}; mergePools(primary.definitions as Obj, s.definitions) }
    // Fold in paths too, so a spec split across files keeps all its endpoints.
    if (isObj(s.paths)) { if (!isObj(primary.paths)) primary.paths = {}; mergePools(primary.paths as Obj, s.paths) }
  }
  return primary
}

/** Find the first OpenAPI/Swagger spec inside materials (whole text or any block),
 *  merging co-dropped spec files into one so cross-file $refs resolve. */
export function extractSpecFromMaterials(materials: string): unknown | null {
  if (!materials) return null
  return mergeSpecBlocks(materials)
}

/** Render a summary as compact text for an LLM prompt. */
export function renderSummaryText(s: OpenApiSummary): string {
  const lines: string[] = []
  lines.push(`OpenAPI spec${s.title ? `: ${s.title}` : ''}${s.version ? ` (v${s.version})` : ''} — ${s.endpointCount} endpoints.`)
  if (s.suggestedBaseUrl) lines.push(`Base URL to call: ${s.suggestedBaseUrl}`)
  if (s.serverVariables?.length) lines.push(`Base-URL variables the user must provide (e.g. to target their own host instead of the default/sandbox base): ${s.serverVariables.map(v => v.name + (v.description ? ` (${v.description})` : '')).join(', ')} — treat each as a required field to fill.`)
  const sec = Object.entries(s.securitySchemes || {})
  if (sec.length) lines.push(`Auth: ${sec.map(([k, v]) => `${k} (${[v.type, v.scheme, v.in && `in ${v.in}`, v.name].filter(Boolean).join(' ')})`).join('; ')}`)
  if (s.loginCandidates?.length) lines.push(`Login endpoints: ${s.loginCandidates.map(l => `${l.method} ${l.path} {${l.fields.map(f => f.name).join(', ')}}`).join('; ')}`)
  if (s.groups?.length) lines.push(`Groups: ${s.groups.join(', ')}`)
  lines.push('Endpoints (relative to base URL):')
  for (const e of s.endpoints) lines.push(`  ${e.method.toUpperCase()} ${e.path}${e.summary ? ` — ${e.summary}` : ''}`)
  return lines.join('\n')
}

/** If materials contain an OpenAPI/Swagger spec (often hundreds of KB of YAML/JSON),
 *  replace it with a compact structured summary so the model sees the whole API
 *  instead of a truncated fragment. Non-spec docs are preserved (capped). Returns
 *  the materials unchanged when no spec is present. */
export function condenseSpecMaterials(materials: string | undefined, endpointCap = 200): string | undefined {
  if (!materials) return materials
  const spec = extractSpecFromMaterials(materials)
  if (!spec) return materials
  const sum = summarizeOpenApi(spec, endpointCap)
  if (!sum.ok) return materials
  const nonSpec = splitMaterialBlocks(materials).filter(b => !isOpenApiSpec(parseSpec(b)))
  const extras = nonSpec.join('\n\n').slice(0, 8000)
  return `[OpenAPI spec provided — condensed to its structure]\n${renderSummaryText(sum)}${extras ? `\n\n===== other materials =====\n${extras}` : ''}`
}
