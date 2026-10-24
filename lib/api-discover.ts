// lib/api-discover.ts
// Multi-source endpoint discovery for a live REST API. The root failure this
// addresses: when an API exposes no reachable OpenAPI spec (absent, or gated —
// e.g. FactoryOS returns 403 "Superuser session required" for its openapi.json
// even with a valid token), the builder's agent has to guess the endpoint list
// and gets it inconsistently wrong (1 endpoint one time, 40 dead module
// prefixes another). Discovery here tries, in order:
//   1. an OpenAPI/Swagger spec (authenticated),
//   2. the server's own route map — specifically a Django DEBUG 404 page, which
//      lists every registered URL pattern (dev/on-prem only; a locked-down prod
//      app hides it).
// Whatever it finds is then validated by the caller (classifyProbe) so only real,
// data-returning collections are proposed. The two pure parsers are exported for
// unit testing.
import { runCandidateProbe } from '@/lib/api-probe'
import type { AuthConfig } from '@/lib/api-auth'
import { parseSpec, extractSpecFromMaterials } from '@/lib/ai/openapi-summary'
import { isEdmx, edmxToSummary } from '@/lib/ai/edmx'

export interface DiscoveredCollection { path: string; label: string; name?: string }
export interface DiscoverResult { source: 'spec' | 'metadata' | 'route-map' | 'none'; collections: DiscoveredCollection[]; note?: string; odataVersion?: '2' | '4' | 'unknown' }

// Both JSON and YAML spec filenames — many APIs serve openapi.yaml rather than .json.
const SPEC_PATHS = ['/openapi.json', '/swagger.json', '/v3/api-docs', '/api-docs', '/swagger/v1/swagger.json', '/openapi.yaml', '/openapi.yml', '/swagger.yaml']

// Title-case the last meaningful path segment for a readable label, keeping the
// module prefix so two "metrics" under different modules stay distinguishable.
function labelFor(path: string): string {
  const segs = path.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)
  return segs.join('/') || path
}

/**
 * Parse a Django DEBUG 404 "page not found" page into its registered URL
 * patterns. Returns [] for any page that isn't a Django debug URL dump. Each
 * pattern is in a <code> block, optionally followed by its [name='...'].
 */
export function parseDjangoDebugRoutes(html: string): { path: string; name?: string }[] {
  if (!/Using the URLconf|Django tried these URL patterns/i.test(html)) return []
  const out: { path: string; name?: string }[] = []
  // Each registered pattern is wrapped in a <code> block. On the real page the
  // route name sits INSIDE the block on the next line
  // ("mes/shifts/\n   [name='list_shifts']"), so the block spans newlines — take
  // only the first line as the path, and read the name from inside the block (or
  // just after it, for layouts that put it there). A single <code> prefix node
  // ("api/") repeats before each leaf; that's fine — it resolves to a redundant
  // path that live validation drops.
  const re = /<code>([\s\S]*?)<\/code>(?:\s*\[name=['"]([^'"]+)['"]\])?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const raw = m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    // The real page indents the content, so it starts with a newline — the path
    // is the first NON-EMPTY line, and the name (when present) is a later line.
    const lines = raw.split('\n').map(s => s.trim()).filter(Boolean)
    if (!lines.length) continue
    const path = lines[0]
    const nameLine = lines.find(l => /^\[name=/.test(l))
    const inName = nameLine ? (nameLine.match(/\[name=['"]([^'"]+)['"]\]/) || [])[1] : undefined
    out.push({ path, name: inName || m[2] })
  }
  return out
}

// First path segments that are never API data collections.
const SKIP_FIRST = new Set(['admin', 'static', 'media', '__debug__', 'silk', 'favicon.ico', 'docs', 'schema', 'swagger', 'redoc'])
// Auth / account-action endpoints (not listable data) to leave out.
const AUTH_ACTION_RE = /\/(login|logout|refresh|reset-password|verify|set|token|authenticate|sessions)(\/|$)/i

/**
 * From a set of raw routes (spec paths or route-map patterns), pick the ones
 * that look like **listable collections**: a clean resource path with NO path
 * parameter (no `<id>`, `{id}`, `:id`, or regex), not an auth action, not admin/
 * docs plumbing. Returns normalised paths ("/mes/shifts") relative to the API
 * base, de-duplicated and order-preserving. Non-/api routes that slip through are
 * filtered out later by live validation (they 404 under the base URL).
 */
export function selectCollectionPaths(routes: { path: string; name?: string }[]): DiscoveredCollection[] {
  const seen = new Set<string>()
  const out: DiscoveredCollection[] = []
  for (const r of routes) {
    let p = (r.path || '').trim().replace(/^\^/, '').replace(/\$$/, '')
    if (!p) continue
    if (/[<>{}():?*+\[\]]/.test(p)) continue                 // has a path param or regex metachar
    if (p.includes('.')) continue                            // openapi.json, project_config.urls, favicon.ico
    if (!/^\/?[a-z][a-z0-9/_-]*\/?$/i.test(p)) continue      // resource-ish only
    const norm = '/' + p.replace(/^\/+/, '').replace(/\/+$/, '')
    if (norm.length < 2) continue
    const first = norm.split('/')[1] || ''
    if (SKIP_FIRST.has(first)) continue
    if (AUTH_ACTION_RE.test(norm)) continue
    if (seen.has(norm)) continue
    seen.add(norm)
    out.push({ path: norm, label: labelFor(norm), name: r.name })
  }
  return out
}

/**
 * Collection paths from a live OData $metadata document: every entity set is a
 * listable GET at /{EntitySet}. edmxToSummary already emits those as GET
 * endpoints with hasPathParams=false (the keyed read has true), so we keep only
 * those. Returns [] for a non-EDMX body.
 */
export function collectionsFromEdmx(xml: string, serviceUrl?: string): { collections: DiscoveredCollection[]; odataVersion: '2' | '4' | 'unknown' } {
  const r = edmxToSummary(xml, serviceUrl)
  if (!r) return { collections: [], odataVersion: 'unknown' }
  const seen = new Set<string>()
  const out: DiscoveredCollection[] = []
  for (const e of r.summary.endpoints) {
    if (e.method !== 'GET' || e.hasPathParams) continue
    if (e.path.includes('(')) continue                 // keyed read, not a list
    const norm = '/' + e.path.replace(/^\/+/, '').replace(/\/+$/, '')
    if (norm.length < 2 || seen.has(norm)) continue
    seen.add(norm)
    out.push({ path: norm, label: labelFor(norm) })
  }
  return { collections: out, odataVersion: r.odataVersion }
}

/** Extract GET collection paths (no path templating) from an OpenAPI/Swagger doc. */
function collectionsFromOpenApi(spec: unknown): DiscoveredCollection[] {
  const paths = (spec as { paths?: Record<string, Record<string, unknown>> })?.paths
  if (!paths || typeof paths !== 'object') return []
  const routes: { path: string }[] = []
  for (const [p, ops] of Object.entries(paths)) {
    if (!ops || typeof ops !== 'object') continue
    if (!('get' in ops)) continue              // listable = has a GET
    routes.push({ path: p })
  }
  return selectCollectionPaths(routes)
}

/**
 * Discover endpoint collections for a service. Uses runCandidateProbe for every
 * fetch, so auth (incl. a session_token login) is applied exactly as in
 * production, and a shared cacheKey means the login happens once.
 */
export async function discoverEndpoints(input: {
  cacheKey: string
  baseUrl: string
  authType: string
  authConfig: AuthConfig
  defaultHeaders?: Record<string, string>
  specText?: string            // a spec the user supplied (uploaded/pasted) — tried first
  ssrf?: 'lan' | 'strict' | 'off'
}): Promise<DiscoverResult> {
  const common = {
    cacheKey: input.cacheKey, baseUrl: input.baseUrl, authType: input.authType,
    authConfig: input.authConfig, defaultHeaders: input.defaultHeaders || {},
    method: 'GET', ssrf: input.ssrf ?? ('lan' as const), timeoutMs: 12000,
  }

  // 0. A spec the user handed us (a dropped OpenAPI/Swagger file, JSON or YAML).
  // This is the generic "company shares their spec" path — it works even when the
  // live server exposes no reachable spec (gated or absent).
  if (input.specText) {
    const spec = extractSpecFromMaterials(input.specText)
    if (spec) {
      const cols = collectionsFromOpenApi(spec)
      if (cols.length) return { source: 'spec', collections: cols, note: `Read ${cols.length} GET collections from the spec you provided.` }
    }
  }

  // 1. Live OData $metadata (EDMX). A SAP on-prem / OData service root exposes its
  // whole shape at <base>/$metadata — no OpenAPI needed. This is the SAP-first
  // discovery path: point Mosaic at the service root and it reads the live entity
  // sets (which vary per SAP box), instead of relying on a curated preset.
  {
    const svcUrl = input.baseUrl.replace(/\/+$/, '')
    const md = await runCandidateProbe({ ...common, basePath: '', path: '/$metadata' })
    const xml = typeof md.body === 'string' ? md.body : ''
    if (md.status >= 200 && md.status < 300 && isEdmx(xml)) {
      const { collections, odataVersion } = collectionsFromEdmx(xml, `${svcUrl}/$metadata`)
      if (collections.length) {
        const v = odataVersion === 'unknown' ? '' : ` (OData V${odataVersion})`
        return { source: 'metadata', collections, odataVersion, note: `Read ${collections.length} entity sets live from ${svcUrl}/$metadata${v}.` }
      }
    }
  }

  // 2. OpenAPI/Swagger spec fetched from the live server (JSON or YAML), authenticated.
  for (const sp of SPEC_PATHS) {
    const out = await runCandidateProbe({ ...common, basePath: '', path: sp })
    if (out.status >= 200 && out.status < 300) {
      let spec: unknown = out.body
      if (typeof spec === 'string') spec = parseSpec(spec)
      if (spec && typeof spec === 'object' && (spec as { paths?: unknown }).paths) {
        const cols = collectionsFromOpenApi(spec)
        if (cols.length) return { source: 'spec', collections: cols, note: `Read ${cols.length} GET collections from the OpenAPI spec at ${sp}.` }
      }
    }
  }

  // 3. Server route map — a Django DEBUG 404 page lists every URL pattern.
  const probe404 = await runCandidateProbe({ ...common, basePath: '', path: '/__mosaic_discover_404__/' })
  const html = typeof probe404.body === 'string' ? probe404.body : ''
  const routes = parseDjangoDebugRoutes(html)
  if (routes.length) {
    const cols = selectCollectionPaths(routes)
    if (cols.length) return { source: 'route-map', collections: cols, note: `No machine-readable spec was reachable (it may be gated). Read ${cols.length} candidate collections from the server's URL map.` }
  }

  // 4. Nothing discoverable. Before giving up, check whether this is a SAP
  // service root that simply isn't ACTIVATED — a very common SAP stumble — and
  // return the real fix instead of a generic "nothing found".
  {
    const root = await runCandidateProbe({ ...common, basePath: '', path: '/' })
    const act = diagnoseSapActivation(root.status, root.body)
    if (act.likelyInactive) return { source: 'none', collections: [], note: act.message }
  }

  return { source: 'none', collections: [], note: 'No OpenAPI spec was reachable and the server exposes no readable route map. Add endpoints manually, or expose the spec to this login.' }
}

// ---- SAP activation signal --------------------------------------------------
// A SAP OData service that exists in the system but has not been ACTIVATED in
// transaction /IWFND/MAINT_SERVICE answers its service root with a Gateway error
// (404/403) whose body carries a tell-tale signature — "Resource not found for
// the segment", "Service ... not active/registered", a /IWFND/ or /IWBEP/ error
// code, or a SICF reference. Distinguishing that from a plain dead URL lets us
// give the real fix ("ask Basis to activate it") instead of "not a data endpoint".
const SAP_INACTIVE_RE = /not found for the segment|is not active|not registered in the system|could not be found in the system|\/IWFND\/|\/IWBEP\/|SICF|MAINT_SERVICE|service is not active|resource not found/i

export interface SapActivation { likelyInactive: boolean; message?: string }

export function diagnoseSapActivation(status: number, body: unknown): SapActivation {
  if (status !== 404 && status !== 403 && status !== 501) return { likelyInactive: false }
  let text = ''
  if (typeof body === 'string') text = body
  else if (body && typeof body === 'object') { try { text = JSON.stringify(body) } catch { text = '' } }
  if (!SAP_INACTIVE_RE.test(text)) return { likelyInactive: false }
  return {
    likelyInactive: true,
    message: `The SAP service root answered HTTP ${status} with a Gateway "service not found/active" error. In SAP the OData service must be activated in transaction /IWFND/MAINT_SERVICE (add the service, then activate its ICF node). Ask your Basis team to activate it, then retry discovery.`,
  }
}

// ---- SAP service catalogue --------------------------------------------------
// "Every SAP implementation is different" — the set of ACTIVATED OData services
// is whatever that customer's Basis team switched on. Rather than ship a curated
// preset and hope, we read the SAP Gateway service catalogue live: it lists every
// activated service with its technical name and service-root URL. The user then
// picks one, and we discover its entity sets via $metadata (above).

export interface SapService { name: string; title?: string; serviceUrl: string; version?: '2' | '4' }
export interface SapCatalogResult { ok: boolean; services: SapService[]; note?: string }

// Known SAP Gateway catalogue endpoints. V2 gateway and the newer V4 catalogue
// differ in path and casing; we try each. $format=json so we get JSON, not XML.
const SAP_CATALOG_PATHS = [
  "/sap/opu/odata/IWFND/CATALOGSERVICE;v=2/ServiceCollection?$format=json",
  "/sap/opu/odata/iwfnd/catalogservice;v=2/ServiceCollection?$format=json",
  "/sap/opu/odata4/IWFND/CONFIG/default/IWFND/CATALOG_0002/ServiceGroups?$format=json",
]

/**
 * Parse a SAP Gateway catalogue response into a flat service list. Handles the
 * OData V2 shape ({ d: { results: [...] } }) and the V4 shape ({ value: [...] }).
 * Each service exposes a technical name and a service-root URL under varying
 * field names across gateway versions, so we read the common ones defensively.
 */
export function parseSapCatalog(body: unknown): SapService[] {
  const rows: unknown[] = (() => {
    if (!body || typeof body !== 'object') return []
    const d = (body as { d?: { results?: unknown[] } }).d
    if (d && Array.isArray(d.results)) return d.results
    const value = (body as { value?: unknown[] }).value
    if (Array.isArray(value)) return value
    return []
  })()
  const out: SapService[] = []
  const seen = new Set<string>()
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    const name = String(o.TechnicalServiceName || o.ServiceId || o.ID || o.Name || o.ServiceGroupId || '').trim()
    const serviceUrl = String(o.ServiceUrl || o.Url || o.MetadataUrl || '').trim().replace(/\/\$metadata.*$/i, '').replace(/\/+$/, '')
    const title = String(o.Title || o.Description || '').trim() || undefined
    const verRaw = String(o.TechnicalServiceVersion || o.ODataVersion || '')
    const version = /4/.test(verRaw) ? '4' : /^\d/.test(verRaw) ? '2' : undefined
    if (!name && !serviceUrl) continue
    const key = serviceUrl || name
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ name: name || serviceUrl, title, serviceUrl, version: version as '2' | '4' | undefined })
  }
  return out
}

/**
 * Probe the SAP Gateway catalogue at a gateway root and return every activated
 * OData service. `gatewayBase` is the host root (e.g. https://host:44300). Uses
 * the production auth exactly as the probe does, so Basic / mTLS / OAuth all work.
 */
export async function discoverSapServices(input: {
  cacheKey: string
  gatewayBase: string
  authType: string
  authConfig: AuthConfig
  defaultHeaders?: Record<string, string>
  ssrf?: 'lan' | 'strict' | 'off'
}): Promise<SapCatalogResult> {
  const base = input.gatewayBase.replace(/\/+$/, '')
  const common = {
    cacheKey: input.cacheKey, baseUrl: base, authType: input.authType,
    authConfig: input.authConfig, defaultHeaders: input.defaultHeaders || {},
    method: 'GET', ssrf: input.ssrf ?? 'lan' as const, timeoutMs: 15000,
  }
  for (const p of SAP_CATALOG_PATHS) {
    const qIdx = p.indexOf('?')
    const path = qIdx >= 0 ? p.slice(0, qIdx) : p
    const queryParams = qIdx >= 0 ? Object.fromEntries(new URLSearchParams(p.slice(qIdx + 1))) : undefined
    const out = await runCandidateProbe({ ...common, basePath: '', path, queryParams })
    if (out.status >= 200 && out.status < 300) {
      let body: unknown = out.body
      if (typeof body === 'string') { try { body = JSON.parse(body) } catch { /* not json */ } }
      const services = parseSapCatalog(body)
      if (services.length) {
        return { ok: true, services, note: `Found ${services.length} activated OData service${services.length === 1 ? '' : 's'} in the SAP Gateway catalogue.` }
      }
    }
  }
  return { ok: false, services: [], note: 'No SAP Gateway catalogue was reachable at the standard paths (/sap/opu/odata/IWFND/CATALOGSERVICE). The gateway may be locked down, or this host is not an SAP Gateway — point at a specific service root and use $metadata instead.' }
}
