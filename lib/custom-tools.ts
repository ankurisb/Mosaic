// lib/custom-tools.ts
// Phase E: admin-authored custom HTTP tools. An admin registers a named capability (an HTTP
// endpoint with a URL template + a small input schema); agents can then be given that tool and
// the runner turns it into an Anthropic tool and executes it. This widens the trust boundary,
// so it is the most locked-down surface:
//   * read-only by default — a read-only tool may only issue GET/HEAD; a write tool must be
//     explicitly marked and (in the runner) is gated behind the same write-approval guardrail.
//   * every call is SSRF-checked (no loopback / link-local / cloud-metadata / private hosts).
//   * the tool name must be a safe slug and must NOT collide with a built-in tool.
// The HTTP + SSRF dependencies are injected so the logic is unit-testable offline.
import { TOOLS } from './tools'

export interface CustomToolDef {
  name: string
  description: string
  method: 'GET' | 'POST'
  url_template: string
  headers?: Record<string, string>
  body_template?: string
  read_only: boolean
  input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
}

const BUILTIN_NAMES = new Set(TOOLS.map(t => (t as { name: string }).name))
const SLUG = /^[a-z][a-z0-9_]{1,39}$/

export function validateToolName(name: string): string | null {
  if (!SLUG.test(name)) return 'Name must be a lower-case slug (letters, digits, underscore; 2–40 chars).'
  if (BUILTIN_NAMES.has(name)) return `"${name}" collides with a built-in tool — pick another name.`
  return null
}

/** The Anthropic tool schema the model sees. */
export function toAnthropicTool(def: CustomToolDef): { name: string; description: string; input_schema: object } {
  return {
    name: def.name,
    description: (def.description || `Custom tool ${def.name}`).slice(0, 1000),
    input_schema: def.input_schema && def.input_schema.type === 'object' ? def.input_schema : { type: 'object', properties: {} },
  }
}

/** Substitute {placeholders} in a template from the input object. Returns the filled string and
 *  any placeholders that had no value. Values are URL-encoded for url templates. */
export function fillTemplate(tpl: string, input: Record<string, unknown>, encode: boolean): { filled: string; missing: string[] } {
  const missing: string[] = []
  const filled = (tpl || '').replace(/\{(\w+)\}/g, (_m, k: string) => {
    const v = input[k]
    if (v === undefined || v === null) { missing.push(k); return '' }
    const s = String(v)
    return encode ? encodeURIComponent(s) : s
  })
  return { filled, missing }
}

export interface CustomToolDeps {
  fetchImpl?: typeof fetch
  ssrf?: (url: string) => Promise<{ ok: boolean; reason?: string }>
  timeoutMs?: number
}

/** Execute a custom tool call. Never throws — returns an { error } object on any failure. */
export async function runCustomTool(def: CustomToolDef, input: Record<string, unknown>, deps: CustomToolDeps = {}): Promise<unknown> {
  const doFetch = deps.fetchImpl || fetch
  const ssrf = deps.ssrf || (async (u: string) => (await import('./ssrf-guard')).assertUrlSafe(u))
  const method = (def.method || 'GET').toUpperCase()
  try {
    if (def.read_only && method !== 'GET' && method !== 'HEAD') return { error: `Tool "${def.name}" is read-only; ${method} is not allowed.` }
    const u = fillTemplate(def.url_template, input, true)
    if (u.missing.length) return { error: `Missing required input(s): ${u.missing.join(', ')}` }
    const safe = await ssrf(u.filled)
    if (!safe.ok) return { error: `Blocked: ${safe.reason || 'URL points to an internal/blocked host.'}` }
    let body: string | undefined
    if (method === 'POST' && def.body_template) body = fillTemplate(def.body_template, input, false).filled
    const res = await doFetch(u.filled, {
      method,
      headers: { ...(def.headers || {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body,
      // SSRF: the guard above only vetted the initial URL. Do NOT auto-follow redirects — a
      // public URL that 302s to 169.254.169.254 / a private host would otherwise bypass it.
      redirect: 'manual',
      signal: AbortSignal.timeout(deps.timeoutMs ?? 10_000),
    })
    if (res.status >= 300 && res.status < 400) {
      return { error: `Blocked: the endpoint returned a redirect (${res.status} → ${res.headers.get('location') || '?'}). Custom tools do not follow redirects (SSRF protection); point the tool at the final URL.` }
    }
    const text = await res.text()
    let data: unknown
    try { data = JSON.parse(text) } catch { data = text.slice(0, 20_000) }
    return { status: res.status, ok: res.ok, data }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}
