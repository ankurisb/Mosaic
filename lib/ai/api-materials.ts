// lib/ai/api-materials.ts
// Generic "drop any API artifact" ingestion. One entry — condenseApiMaterials —
// detects what the user dropped (OpenAPI/Swagger spec, Postman collection, or a
// HAR capture) and condenses it to a compact, structured summary the AI builder
// can read in full, instead of raw JSON/YAML that gets truncated. Non-API text
// (plain docs, a sample response) is returned unchanged.
//
// OpenAPI goes through the existing summariser; Postman and HAR get lightweight
// server-side extractors here (the mature client-side Postman import in TabAPIs
// stays as its own flow — this just lets the single AI drop zone handle the file).

import { condenseSpecMaterials, extractSpecFromMaterials, parseSpec, splitMaterialBlocks, renderSummaryText } from './openapi-summary'
import { isEdmx, edmxToSummary } from './edmx'

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

// ---- detectors --------------------------------------------------------------
function isPostman(o: unknown): o is Obj {
  if (!isObj(o)) return false
  const info = o.info
  const hasItems = Array.isArray(o.item)
  const schema = isObj(info) ? String(info.schema || '') : ''
  return hasItems && (isObj(info) === true) && (schema.includes('postman') || hasItems)
}
function isHar(o: unknown): o is Obj {
  return isObj(o) && isObj(o.log) && Array.isArray((o.log as Obj).entries)
}

// ---- Postman ----------------------------------------------------------------
interface PmLeaf { name: string; method: string; url: string; auth?: string }
function postmanUrl(url: unknown): string {
  if (typeof url === 'string') return url
  if (isObj(url)) {
    if (typeof url.raw === 'string') return url.raw
    const host = Array.isArray(url.host) ? (url.host as unknown[]).join('.') : String(url.host || '')
    const path = Array.isArray(url.path) ? '/' + (url.path as unknown[]).map(String).join('/') : ''
    return host + path
  }
  return ''
}
function authType(a: unknown): string | undefined {
  if (!isObj(a)) return undefined
  return typeof a.type === 'string' ? a.type : undefined
}
function walkPostman(items: unknown[], out: PmLeaf[], depth = 0) {
  if (depth > 8) return
  for (const it of items) {
    if (!isObj(it)) continue
    if (Array.isArray(it.item)) { walkPostman(it.item, out, depth + 1); continue }
    const req = it.request
    if (isObj(req)) {
      out.push({
        name: String(it.name || ''),
        method: String(req.method || 'GET').toUpperCase(),
        url: postmanUrl(req.url),
        auth: authType(req.auth),
      })
    }
  }
}
function condensePostman(o: Obj): string {
  const info = isObj(o.info) ? o.info : {}
  const leaves: PmLeaf[] = []
  walkPostman(o.item as unknown[], leaves)
  // base URL guess: a {{baseUrl}}-style var, or the origin of the first absolute URL
  let base = ''
  const vars = Array.isArray(o.variable) ? (o.variable as Obj[]) : []
  const baseVar = vars.find(v => /base|host|url|server/i.test(String(v.key || '')))
  if (baseVar && typeof baseVar.value === 'string') base = baseVar.value
  if (!base) { const abs = leaves.map(l => l.url).find(u => /^https?:\/\//.test(u)); if (abs) { try { base = new URL(abs).origin } catch { /* */ } } }
  const colAuth = authType(o.auth)
  const auths = Array.from(new Set([colAuth, ...leaves.map(l => l.auth)].filter(Boolean))) as string[]
  const lines: string[] = []
  lines.push(`Postman collection: ${String(info.name || 'Untitled')} — ${leaves.length} requests.`)
  if (base) lines.push(`Base URL (from collection): ${base}`)
  if (auths.length) lines.push(`Auth (from collection): ${auths.join(', ')}`)
  if (vars.length) lines.push(`Variables: ${vars.map(v => String(v.key)).filter(Boolean).slice(0, 20).join(', ')}`)
  lines.push('Requests:')
  for (const l of leaves.slice(0, 200)) lines.push(`  ${l.method} ${l.url}${l.name ? ` — ${l.name}` : ''}`)
  return `[Postman collection provided — condensed to its structure]\n${lines.join('\n')}`
}

// ---- HAR --------------------------------------------------------------------
function condenseHar(o: Obj): string {
  const entries = ((o.log as Obj).entries as Obj[]) || []
  const seen = new Set<string>()
  const rows: string[] = []
  let base = ''
  const authHeaders = new Set<string>()
  for (const e of entries) {
    const req = isObj(e.request) ? e.request : null
    if (!req) continue
    const method = String(req.method || 'GET').toUpperCase()
    const urlStr = String(req.url || '')
    let path = urlStr
    try { const u = new URL(urlStr); if (!base) base = u.origin; path = u.pathname } catch { /* keep raw */ }
    const key = `${method} ${path}`
    if (!seen.has(key)) { seen.add(key); rows.push(`  ${key}`) }
    const headers = Array.isArray(req.headers) ? (req.headers as Obj[]) : []
    for (const h of headers) { const n = String(h.name || ''); if (/^(authorization|x-api-key|api-key|x-auth-token|cookie)$/i.test(n)) authHeaders.add(n.toLowerCase()) }
  }
  const lines: string[] = []
  lines.push(`HAR capture — ${entries.length} requests across ${seen.size} endpoints.`)
  if (base) lines.push(`Base URL (observed): ${base}`)
  if (authHeaders.size) lines.push(`Auth headers observed (names only): ${Array.from(authHeaders).join(', ')}`)
  lines.push('Endpoints:')
  lines.push(...rows.slice(0, 200))
  return `[HAR capture provided — condensed to its endpoints]\n${lines.join('\n')}`
}

// ---- entry ------------------------------------------------------------------
/** Detect and condense any dropped API artifact (OpenAPI/Swagger, Postman, HAR).
 *  Returns the materials unchanged when none is detected. */
export function condenseApiMaterials(materials: string | undefined): string | undefined {
  if (!materials) return materials
  // OData $metadata (EDMX XML) — SAP on-prem and other OData services ship this
  // instead of OpenAPI. Checked first because it's XML (not JSON/YAML).
  for (const b of splitMaterialBlocks(materials)) {
    if (isEdmx(b)) { const out = condenseEdmx(b); if (out) return out }
  }
  // OpenAPI/Swagger (handles its own block extraction + non-spec passthrough).
  if (extractSpecFromMaterials(materials)) return condenseSpecMaterials(materials)
  // Postman / HAR: scan each block.
  for (const b of splitMaterialBlocks(materials)) {
    const o = parseSpec(b)
    if (isPostman(o)) return condensePostman(o)
    if (isHar(o)) return condenseHar(o)
  }
  return materials
}

function condenseEdmx(xml: string): string | null {
  const r = edmxToSummary(xml)
  if (!r) return null
  const conv = r.odataVersion === '2'
    ? "OData V2 — list: GET /{EntitySet}; filter $filter, select $select, expand $expand, paginate $top/$skip; add $format=json; read one: /{EntitySet}(Key='value') with string keys single-quoted."
    : r.odataVersion === '4'
    ? 'OData V4 — list: GET /{EntitySet}; filter $filter, select $select, expand $expand, paginate $top/$skip, $count=true; read one: /{EntitySet}(Key=value).'
    : 'OData service.'
  const ver = r.odataVersion === 'unknown' ? 'version unknown' : `V${r.odataVersion}`
  return `[OData $metadata (EDMX, ${ver}) — condensed to its structure]\n${renderSummaryText(r.summary)}\nConventions: ${conv}\nNote: $metadata carries no auth or host. The base URL is the service root (the $metadata URL without /$metadata); ask the user for the host and auth (SAP is commonly Basic, OAuth2, or x509 client certificate).`
}
