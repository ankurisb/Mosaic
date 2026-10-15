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

export interface DiscoveredCollection { path: string; label: string; name?: string }
export interface DiscoverResult { source: 'spec' | 'route-map' | 'none'; collections: DiscoveredCollection[]; note?: string }

const SPEC_PATHS = ['/openapi.json', '/swagger.json', '/v3/api-docs', '/api-docs', '/swagger/v1/swagger.json']

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
}): Promise<DiscoverResult> {
  const common = {
    cacheKey: input.cacheKey, baseUrl: input.baseUrl, authType: input.authType,
    authConfig: input.authConfig, defaultHeaders: input.defaultHeaders || {},
    method: 'GET', ssrf: 'lan' as const, timeoutMs: 12000,
  }

  // 1. OpenAPI/Swagger spec (authenticated).
  for (const sp of SPEC_PATHS) {
    const out = await runCandidateProbe({ ...common, basePath: '', path: sp })
    if (out.status >= 200 && out.status < 300) {
      let spec: unknown = out.body
      if (typeof spec === 'string') { try { spec = JSON.parse(spec) } catch { spec = null } }
      if (spec && typeof spec === 'object' && (spec as { paths?: unknown }).paths) {
        const cols = collectionsFromOpenApi(spec)
        if (cols.length) return { source: 'spec', collections: cols, note: `Read ${cols.length} GET collections from the OpenAPI spec at ${sp}.` }
      }
    }
  }

  // 2. Server route map — a Django DEBUG 404 page lists every URL pattern.
  const probe404 = await runCandidateProbe({ ...common, basePath: '', path: '/__mosaic_discover_404__/' })
  const html = typeof probe404.body === 'string' ? probe404.body : ''
  const routes = parseDjangoDebugRoutes(html)
  if (routes.length) {
    const cols = selectCollectionPaths(routes)
    if (cols.length) return { source: 'route-map', collections: cols, note: `No machine-readable spec was reachable (it may be gated). Read ${cols.length} candidate collections from the server's URL map.` }
  }

  return { source: 'none', collections: [], note: 'No OpenAPI spec was reachable and the server exposes no readable route map. Add endpoints manually, or expose the spec to this login.' }
}
