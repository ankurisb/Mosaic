// lib/ai/api-agent.ts
// Agentic builder for a Type-2 live API source. Instead of a single guess +
// human probe, the model drives a tool loop that does what a careful engineer
// would: discover the API's spec, log in FOR REAL and read where the token
// actually lives, probe a cheap endpoint to confirm auth, and only then finish
// with a working candidate. Credentials are injected server-side — the model
// never sees or emits them.
import Anthropic from '@anthropic-ai/sdk'
import { getDefaultModelId, getAiClient } from '@/lib/models'
import { getKey } from '@/lib/keys'
import { fetchUrlText, type UrlTextResult } from '@/lib/doc-fetch'
import { summarizeOpenApi } from '@/lib/ai/openapi-summary'
import { runCandidateProbe, inspectLogin, type ProbeOutcome } from '@/lib/api-probe'
import type { AuthConfig } from '@/lib/api-auth'
import yaml from 'js-yaml'

export interface AgentCandidate {
  service?: Record<string, unknown>
  connections?: Array<Record<string, unknown>>
  probe?: { connection_index?: number; method?: string; path?: string }
  missing?: Array<{ field: string; label?: string; secret?: boolean }>
  message?: string
  ready_to_probe?: boolean
}

export interface AgentResult {
  ok: boolean
  candidate?: AgentCandidate
  transcript: string[]
  probe?: ProbeOutcome
  reason?: string
}

const MAX_STEPS = 16
const SPEC_PATHS = ['/openapi.json', '/swagger.json', '/openapi.yaml', '/swagger.yaml', '/api-docs', '/swagger/v1/swagger.json', '/v3/api-docs', '/llms.txt', '/docs']

const SYSTEM = `You connect a live REST API to Mosaic by INVESTIGATING it, not guessing. You have tools to discover the API's spec, log in, and probe endpoints. Work like a careful engineer:

1. If you were given a base URL or docs link, call discover_spec on the base to find an OpenAPI/Swagger spec (or inspect_openapi / fetch_text on a known URL). Read the auth scheme, the login endpoint and its request field names, and the available endpoints. discover_spec/inspect_openapi handle an AUTH-GATED spec automatically: if the spec returns 401/403, they log in with the server-held credentials and retry with the token — so still call them even when the spec needs a login.
2. If auth is a login endpoint that returns a token, call login_probe — it posts the (server-held) credentials for you and returns the RAW login response. LOOK at that response and set token_path to where the token actually is (e.g. "tokens.access", "data.token") instead of assuming "access_token". Note the token header/prefix.
3. Build a candidate and call probe on a cheap GET list endpoint to confirm the whole chain works (expect 2xx with data, or an empty array). If it fails, read the error and adjust auth_config / token_path / base_path / the path, then probe again.
4. When a probe succeeds, call finish with the candidate.

Rules:
- NEVER put credentials (username/password/token/key) in any tool argument or in the candidate's auth_config — the server injects them. Set only structural fields.
- Quote real endpoints from the spec; never invent paths.
- auth_type is one of: bearer, api_key_header, basic, oauth2_client, session_token, custom_headers. For a username/password login returning a token, use session_token with: login_url (path relative to base is fine), username_field, password_field, login_body_format, token_path, token_header, token_prefix.
- base_url: use the spec summary's \`suggestedBaseUrl\` VERBATIM as service.base_url (no trailing slash). It already includes the server origin and any shared mount prefix (shown as \`commonPrefix\`, e.g. "/api"). Every \`path\` and \`loginCandidates[].path\` in the summary is ALREADY RELATIVE to suggestedBaseUrl — use them as given and NEVER prepend the commonPrefix again (doing so is the #1 cause of 404s). Only fall back to deriving base_url yourself if suggestedBaseUrl is absent.
- The final request URL is base_url + connection.base_path + path (simple concatenation). Confirm your mental math lands exactly on a real endpoint before probing — e.g. base_url "https://h/api" + base_path "" + path "/core/tenants" = "https://h/api/core/tenants".
- Give the service a readable \`label\` from the API's own name (e.g. the OpenAPI info.title like "FactoryOS API"), not a generic "API source". The user can rename it afterwards.
- A "connection" is an endpoint GROUP (a base_path the agent can call any path under at query time), NOT a single endpoint. After auth is confirmed, create ONE connection for EACH group in the spec summary's \`groups\` (base_path = "/" + group, e.g. "/assets"), so the WHOLE API is reachable — not just the groups you happened to probe. You do NOT need to probe every group; 1–2 successful probes confirm the auth chain, then register all the groups. Give each connection a readable label and set pagination_data_path if the list responses nest their records. If the user named specific groups, make sure those are included, plus the rest.
- To CONFIRM auth with a probe, the simplest reliable call is base_path "" + a cheap GET \`path\` taken verbatim from the summary's endpoint list (which is already relative to base_url). Don't hand-assemble paths.
- Keep going until a probe succeeds, then finish with the full set of group connections. If you truly cannot (e.g. credentials rejected), finish with ready_to_probe:false and a message explaining what's needed.`

const TOOLS: Anthropic.Tool[] = [
  { name: 'discover_spec', description: 'Given a base URL, try common spec/doc locations (/openapi.json, /swagger.json, /api-docs, /llms.txt, …) and return any OpenAPI/Swagger summary found plus which URLs responded.', input_schema: { type: 'object', properties: { base_url: { type: 'string' } }, required: ['base_url'] } },
  { name: 'inspect_openapi', description: 'Fetch an OpenAPI/Swagger spec at a known URL and return a compact summary (servers, auth schemes, login endpoints with field names, endpoint list).', input_schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
  { name: 'fetch_text', description: 'Fetch the text of a docs URL (markdown/plain/llms.txt or HTML reduced to text).', input_schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
  { name: 'login_probe', description: 'POST the server-held credentials to a login endpoint and return the RAW response so you can see where the token is. Do NOT pass credentials.', input_schema: { type: 'object', properties: { login_url: { type: 'string' }, base_url: { type: 'string' }, username_field: { type: 'string' }, password_field: { type: 'string' }, login_body_format: { type: 'string', enum: ['json', 'form'] } }, required: ['login_url'] } },
  { name: 'probe', description: 'Run a live authenticated request against a candidate (server injects credentials into auth_config). Returns status + body.', input_schema: { type: 'object', properties: { service: { type: 'object' }, connection: { type: 'object' }, method: { type: 'string' }, path: { type: 'string' } }, required: ['service', 'method', 'path'] } },
  { name: 'finish', description: 'Return the final working candidate (service + connections + a suggested probe). Call only after a probe succeeded, or with ready_to_probe:false if blocked.', input_schema: { type: 'object', properties: { candidate: { type: 'object' }, summary: { type: 'string' } }, required: ['candidate'] } },
]

function parseSpec(text: string): unknown {
  try { return JSON.parse(text) } catch {}
  try { return yaml.load(text) } catch {}
  return null
}

function redactKeys(obj: unknown): string {
  if (!obj || typeof obj !== 'object') return typeof obj === 'string' ? `"${obj.slice(0, 40)}"` : String(obj)
  return `{ ${Object.keys(obj as Record<string, unknown>).slice(0, 8).join(', ')} }`
}

export interface DiagnoseResult extends AgentResult {
  // Plain-language root cause + what to change (from the model's finish summary).
  diagnosis?: string
}

const DIAGNOSE_SYSTEM = `You troubleshoot an EXISTING live REST API connection in Mosaic that isn't working. You are given the connection's current config (base_url, auth type + structural auth fields with secrets redacted, and the registered connections/base_paths) and a reported symptom. Credentials are available server-side — never type them. Work like an on-call engineer:

1. REPRODUCE first: call probe with the current config against the failing endpoint (or a cheap GET under the reported group) to see the real status + body. The final request URL is base_url + connection.base_path + path.
2. If it fails, INVESTIGATE: re-read the spec with discover_spec / inspect_openapi to find the correct base URL and paths; use login_probe to check auth and where the token really is. Look at the actual probe URL in the error — a doubled prefix (e.g. ".../api/api/...") or a missing prefix is the usual cause.
3. ROOT-CAUSE it and decide whether it's a CONFIG problem (fixable here) or EXTERNAL (API down, credentials rejected/expired, endpoint removed upstream, insufficient permissions, rate limit).
4. Call finish with:
   - summary: a clear, specific root cause and exactly what to change (or, if external, what the user must do). This is shown to the user verbatim — be concrete.
   - candidate: ONLY when a config change fixes it — the corrected service + connections (same shape the builder uses). Omit candidate for an external cause.

Rules:
- NEVER put credentials in any argument or in candidate.auth_config — set only structural auth fields; the server re-attaches the stored secrets on apply.
- Use the spec summary's \`suggestedBaseUrl\` verbatim as base_url and treat its paths as relative to it — never re-add the mount prefix (doubled prefixes are the #1 cause of 404s).
- Prefer confirming your proposed fix with a successful probe before finishing with a candidate.
- Quote real endpoints; never invent paths. Keep going until you've reproduced and explained the failure, then finish.`

const ASSIST_SYSTEM = `You help a user build and refine a live REST API connection in Mosaic, conversationally. You are given the connection's current draft config (base_url, auth type + structural auth fields with secrets redacted, and the endpoint groups) and the user's message. Credentials are available server-side — never type them. The user may:
- ASK a question about the API ("do all endpoints work?", "what does /materials return?", "which groups need an id in the path?"). ANSWER IT by actually checking: probe a cheap GET (or the specific endpoint they mention) and/or read the spec with inspect_openapi / discover_spec. Base the answer on real results, not assumptions. For "do all endpoints work", note that all groups share one base URL + auth, so 1–2 successful probes confirm the whole set; say so plainly rather than probing every group.
- REQUEST a change ("records are under data.results", "base path should be /v2", "add the orders group"). Make it, and confirm with a probe when you can.

The final request URL is base_url + connection.base_path + path. Use the spec summary's \`suggestedBaseUrl\` verbatim and treat its paths as relative to it — never re-add the mount prefix (doubled prefixes cause 404s).

Finish with:
- summary: a clear, direct answer to the user, shown verbatim. For a question, answer it (with what the probe/spec showed). For a change, say what you changed and the probe result.
- candidate: ONLY when you actually changed the configuration — the corrected service + connections (same shape the builder uses). For a pure question, OMIT candidate (don't propose a no-op change).

Rules: never put credentials in any argument or in candidate.auth_config (the server re-attaches the stored secrets). Quote real endpoints; never invent paths. Keep to a probe or two unless more is genuinely needed.`

// Credential field names whose VALUES must stay server-side (never shown to the
// model or written into a proposed candidate). Structural auth fields
// (login_url, token_path, token_header, token_prefix, *_field, client_id, …) are
// safe and necessary for diagnosis, so they are NOT treated as secret.
const SECRET_EXACT = new Set(['password', 'pass', 'token', 'access_token', 'refresh_token', 'api_key', 'apikey', 'key', 'client_secret', 'secret', 'username'])
function isSecretKey(k: string): boolean {
  const lk = k.toLowerCase()
  if (SECRET_EXACT.has(lk)) return true
  return /_(secret|password|token|key)$/.test(lk) // x_api_key, auth_token, … (NOT token_path/header/prefix/url)
}
function splitSecrets(auth: Record<string, unknown> | undefined): { secrets: Record<string, string>; structural: Record<string, unknown> } {
  const secrets: Record<string, string> = {}
  const structural: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(auth || {})) {
    if (isSecretKey(k)) { if (v != null && v !== '') secrets[k] = String(v) }
    else structural[k] = v
  }
  return { secrets, structural }
}

/** Re-attach the stored secret values onto a model-proposed (structural-only)
 *  auth_config, so applying a diagnosis fix keeps credentials intact. */
export function mergeStoredSecrets(proposedAuth: Record<string, unknown> | undefined, storedAuth: Record<string, unknown> | undefined): Record<string, unknown> {
  const { secrets } = splitSecrets(storedAuth)
  return { ...(proposedAuth || {}), ...secrets }
}

// Shared tool-loop driver for both the builder (runApiAgent) and the
// troubleshooter (diagnoseApiConnection): same tools, same probing, different
// system prompt and seed.
async function driveAgent(opts: { system: string; seedUserText: string; creds: Record<string, string> }): Promise<{
  finished?: AgentCandidate; finishedSummary?: string; finalText?: string; transcript: string[]; lastProbe?: ProbeOutcome; error?: string
}> {
  const creds = opts.creds
  const transcript: string[] = []
  let lastProbe: ProbeOutcome | undefined
  let finishedSummary: string | undefined
  const cacheKey = `agent:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`

  // Merge the real (server-held) credential values into a model-supplied auth_config.
  const withCreds = (authConfig: Record<string, unknown> | undefined): Record<string, unknown> =>
    ({ ...(authConfig || {}), ...creds })

  // ── Auth-aware discovery ──────────────────────────────────────────────────
  // Some APIs gate their own OpenAPI spec behind login (e.g. 403 "Superuser
  // session required"). This is a missing CAPABILITY, not a reasoning gap: the
  // fetcher couldn't send an authenticated request while discovering. We give it
  // a general primitive — log in with the server-held creds, then fetch the spec
  // with the token — so any login/JWT-shaped API's gated spec unlocks, without a
  // per-API special case.
  let session: { token: string; header: string; prefix: string } | null = null
  const COMMON_LOGIN_PATHS = ['/accounts/login', '/auth/login', '/login', '/users/login', '/sessions', '/auth/token', '/token', '/api-token-auth', '/authenticate']
  const COMMON_TOKEN_PATHS = ['tokens.access', 'data.tokens.access', 'access_token', 'data.access_token', 'data.token', 'access', 'token', 'jwt', 'id_token', 'key', 'api_key']
  const byPath = (obj: unknown, path: string): unknown => {
    let cur: unknown = obj
    for (const k of path.split('.')) { if (!cur || typeof cur !== 'object') return undefined; cur = (cur as Record<string, unknown>)[k] }
    return cur
  }
  const authHeaders = (): Record<string, string> =>
    session ? { [session.header]: session.prefix ? `${session.prefix} ${session.token}` : session.token } : {}

  /** Try the server-held creds against common login endpoints under `apiBase`,
   *  extract a token from common response paths, and cache it for the run. */
  async function establishSession(apiBase: string): Promise<boolean> {
    if (session) return true
    if (!creds.username || !creds.password) return false
    for (const lp of COMMON_LOGIN_PATHS) {
      const r = await inspectLogin({ baseUrl: apiBase, login_url: lp, username: creds.username, password: creds.password, login_body_format: 'json', ssrf: 'lan' })
      if (!r.ok) continue
      for (const tp of COMMON_TOKEN_PATHS) {
        const v = byPath(r.body, tp)
        if (typeof v === 'string' && v.length > 10) {
          session = { token: v, header: 'Authorization', prefix: 'Bearer' }
          transcript.push(`Spec was auth-gated — logged in at ${r.resolvedUrl} and got a token (${tp}) to read it.`)
          return true
        }
      }
    }
    return false
  }

  /** Fetch a spec URL; if it's auth-gated (401/403) and we have creds, log in
   *  against `apiBase` and retry with the token. */
  async function fetchSpecAuthed(url: string, apiBase: string): Promise<UrlTextResult> {
    const opts = { maxBytes: 12_000_000, maxText: 12_000_000, ssrf: 'lan' as const }
    let r = await fetchUrlText(url, { ...opts, headers: authHeaders() })
    if (r.ok) return r
    if ((r.status === 401 || r.status === 403) && !session) {
      if (await establishSession(apiBase)) r = await fetchUrlText(url, { ...opts, headers: authHeaders() })
    } else if (session && (r.status === 401 || r.status === 403)) {
      // token might have been needed but not yet carried on a direct URL fetch
      r = await fetchUrlText(url, { ...opts, headers: authHeaders() })
    }
    return r
  }

  async function runTool(name: string, input: Record<string, unknown>): Promise<{ result: unknown; finished?: AgentCandidate }> {
    if (name === 'discover_spec') {
      const base = String(input.base_url || '').replace(/\/$/, '')
      const tried: Array<{ url: string; status: string }> = []
      let summary: unknown = null; let foundUrl = ''; let docText = ''
      for (const sp of SPEC_PATHS) {
        const url = base + sp
        // Specs can be large (hundreds of KB) — fetch without the docs text cap
        // so a big OpenAPI JSON isn't truncated. Auth-aware: an auth-gated spec
        // (401/403) is retried after logging in with the server-held creds.
        const r = await fetchSpecAuthed(url, base)
        if (!r.ok) { tried.push({ url, status: (r as { ok: false; error: string }).error }); continue }
        tried.push({ url, status: 'ok' })
        const parsed = parseSpec((r as { ok: true; text: string }).text)
        const s = parsed ? summarizeOpenApi(parsed, 150, url) : { ok: false }
        if (s.ok) { summary = s; foundUrl = url; break }
        if (sp.endsWith('llms.txt') || sp.endsWith('/docs')) docText ||= (r as { ok: true; text: string }).text.slice(0, 8000)
      }
      const sm = summary as { endpointCount: number; groups: string[]; suggestedBaseUrl?: string } | null
      transcript.push(sm ? `Discovered API spec at ${foundUrl} — ${sm.endpointCount} endpoints across ${sm.groups.length} groups (${sm.groups.slice(0, 10).join(', ')}${sm.groups.length > 10 ? '…' : ''}); base URL ${sm.suggestedBaseUrl || '(from spec)'}.` : `Looked for a spec under ${base} — none found.`)
      return { result: { found: foundUrl || null, summary, docs_text: docText || undefined, tried } }
    }

    if (name === 'inspect_openapi') {
      const specUrl = String(input.url || '')
      const apiBase = specUrl.replace(/\/[^/]*$/, '') // strip the spec filename to get the API base for login
      const r = await fetchSpecAuthed(specUrl, apiBase)
      if (!r.ok) { transcript.push(`Couldn't fetch spec ${input.url}${r.status ? ` (HTTP ${r.status})` : ''}.`); return { result: { ok: false, error: (r as { ok: false; error: string }).error } } }
      const parsed = parseSpec((r as { ok: true; text: string }).text)
      const s = parsed ? summarizeOpenApi(parsed, 150, String(input.url || '')) : { ok: false, reason: 'not a spec' }
      transcript.push(s.ok ? `Read spec ${input.url} (${(s as { endpointCount: number }).endpointCount} endpoints).` : `URL ${input.url} wasn't a usable spec.`)
      return { result: s }
    }

    if (name === 'fetch_text') {
      const r = await fetchUrlText(String(input.url || ''))
      transcript.push(r.ok ? `Read ${input.url}.` : `Couldn't read ${input.url}.`)
      return { result: r.ok ? { ok: true, text: (r as { ok: true; text: string }).text.slice(0, 12000) } : { ok: false, error: (r as { ok: false; error: string }).error } }
    }

    if (name === 'login_probe') {
      const r = await inspectLogin({
        baseUrl: input.base_url ? String(input.base_url) : undefined,
        login_url: String(input.login_url || ''),
        username: creds.username || '', password: creds.password || '',
        username_field: input.username_field ? String(input.username_field) : undefined,
        password_field: input.password_field ? String(input.password_field) : undefined,
        login_body_format: input.login_body_format === 'form' ? 'form' : 'json',
      })
      transcript.push(`Logged in at ${r.resolvedUrl} → HTTP ${r.status}${r.ok ? ` (response ${redactKeys(r.body)})` : ''}.`)
      // Seed the run session from a model-driven login too, so a subsequently
      // inspected auth-gated spec is read with this token.
      if (r.ok && !session) {
        for (const tp of COMMON_TOKEN_PATHS) {
          const v = byPath(r.body, tp)
          if (typeof v === 'string' && v.length > 10) { session = { token: v, header: 'Authorization', prefix: 'Bearer' }; break }
        }
      }
      return { result: r }
    }

    if (name === 'probe') {
      const svc = (input.service || {}) as Record<string, unknown>
      const conn = (input.connection || {}) as Record<string, unknown>
      const out = await runCandidateProbe({
        cacheKey,
        baseUrl: String(svc.base_url || ''),
        basePath: String(conn.base_path || ''),
        authType: String(svc.auth_type || ''),
        authConfig: withCreds(svc.auth_config as Record<string, unknown>) as unknown as AuthConfig,
        defaultHeaders: (svc.default_headers as Record<string, string>) || {},
        apiVersion: svc.api_version ? String(svc.api_version) : undefined,
        versionHeader: svc.version_header ? String(svc.version_header) : undefined,
        method: String(input.method || 'GET'),
        path: String(input.path || '/'),
        ssrf: 'lan',
      })
      lastProbe = out
      transcript.push(`Probed ${String(input.method || 'GET')} ${out.url} → ${out.ok ? `${out.status} OK` : (out.status ? `HTTP ${out.status}` : 'failed')}.`)
      // Truncate body for the model's context.
      const body = typeof out.body === 'string' ? out.body.slice(0, 2000) : out.body
      return { result: { ok: out.ok, status: out.status, url: out.url, error: out.error, body } }
    }

    if (name === 'finish') {
      finishedSummary = input.summary ? String(input.summary) : undefined
      return { result: { ok: true }, finished: (input.candidate || {}) as AgentCandidate }
    }

    return { result: { error: `unknown tool ${name}` } }
  }

  try {
    const client = await getAiClient()
    const model = await getDefaultModelId()
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: opts.seedUserText }]
    let finished: AgentCandidate | undefined
    let finalText = ''

    const textOf = (content: Anthropic.ContentBlock[]) =>
      content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map(b => b.text).join('\n').trim()

    for (let step = 0; step < MAX_STEPS; step++) {
      const resp = await client.messages.create({ model, max_tokens: 2000, system: opts.system, tools: TOOLS, messages })
      messages.push({ role: 'assistant', content: resp.content })
      const toolUses = resp.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      if (!toolUses.length) {
        // The model answered in prose instead of calling finish — keep that text
        // as the answer rather than discarding it.
        finalText = textOf(resp.content)
        break
      }
      const toolResults: Anthropic.ToolResultBlockParam[] = []
      for (const tu of toolUses) {
        const { result, finished: fin } = await runTool(tu.name, (tu.input || {}) as Record<string, unknown>)
        if (fin) finished = fin
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result).slice(0, 20000) })
      }
      if (finished) break
      // Preserve any prose the model wrote alongside its tool calls, as a fallback
      // answer if it never reaches finish within the step budget.
      const stepText = textOf(resp.content)
      if (stepText) finalText = stepText
      messages.push({ role: 'user', content: toolResults })
    }
    return { finished, finishedSummary, finalText: finalText || undefined, transcript, lastProbe }
  } catch (e) {
    return { transcript, lastProbe, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function runApiAgent(params: {
  description: string
  materials?: string
  credentials?: Record<string, string>
}): Promise<AgentResult> {
  const creds = params.credentials || {}
  const seedUserText = [
    `Connect this API:\n${params.description}`,
    params.materials ? `\nMaterials provided:\n${params.materials.slice(0, 16000)}` : '',
    Object.keys(creds).length ? `\nCredentials are available server-side (fields: ${Object.keys(creds).join(', ')}). Use login_probe/probe — never type the values.` : `\nNo credentials were provided; discover what's needed and finish with ready_to_probe:false if auth can't be completed.`,
    `\nBegin by discovering the API.`,
  ].join('')

  const d = await driveAgent({ system: SYSTEM, seedUserText, creds })
  if (d.error) return { ok: false, transcript: d.transcript, probe: d.lastProbe, reason: d.error }
  if (!d.finished) return { ok: false, transcript: d.transcript, probe: d.lastProbe, reason: 'The agent did not reach a working connection in the step budget.' }
  return { ok: !!d.lastProbe?.ok, candidate: d.finished, transcript: d.transcript, probe: d.lastProbe }
}

/**
 * Troubleshoot an EXISTING connection that's misbehaving. Seeds the same tool
 * loop with the current (secret-redacted) config + a symptom + optional prior
 * turns, reproduces the failure, root-causes it, and returns a plain-language
 * diagnosis plus — if it's a config problem — a corrected candidate. Secrets are
 * split out of the stored auth_config and injected server-side only.
 */
export async function diagnoseApiConnection(params: {
  service: Record<string, unknown>
  connections: Array<Record<string, unknown>>
  symptom: string
  history?: Array<{ role: 'user' | 'assistant'; text: string }>
  // 'diagnose' (default): a saved connection is misbehaving. 'assist': a chat in
  // the builder cockpit — answer questions about the draft and make changes.
  mode?: 'diagnose' | 'assist'
}): Promise<DiagnoseResult> {
  const assist = params.mode === 'assist'
  const { secrets, structural } = splitSecrets(params.service.auth_config as Record<string, unknown>)
  const safeService: Record<string, unknown> = { ...params.service, auth_config: structural }
  const configText = JSON.stringify({
    service: {
      label: safeService.label, base_url: safeService.base_url, auth_type: safeService.auth_type,
      auth_config: structural, default_headers: safeService.default_headers,
      api_version: safeService.api_version, version_header: safeService.version_header,
    },
    connections: (params.connections || []).map(c => ({ label: c.label, base_path: c.base_path, pagination_data_path: c.pagination_data_path })),
  }, null, 1)
  const histText = (params.history || []).map(h => `${h.role === 'user' ? 'User' : 'You'}: ${h.text}`).join('\n')
  const seedUserText = assist ? [
    `You're helping build/refine an API connection in Mosaic. Here is the current draft and the user's message.`,
    `\nUser message:\n${params.symptom}`,
    `\nCurrent draft config (credentials redacted; the real values are available server-side as fields: ${Object.keys(secrets).join(', ') || 'none'}):\n${configText}`,
    histText ? `\nConversation so far:\n${histText}` : '',
    `\nAnswer the question or make the change; check with a probe where it helps.`,
  ].join('') : [
    `An existing Mosaic API connection is misbehaving. Troubleshoot it.`,
    `\nReported symptom:\n${params.symptom}`,
    `\nCurrent config (credentials redacted; the real values are available server-side as fields: ${Object.keys(secrets).join(', ') || 'none'}):\n${configText}`,
    histText ? `\nConversation so far:\n${histText}` : '',
    `\nReproduce the failure with a probe first, then investigate and root-cause.`,
  ].join('')

  const d = await driveAgent({ system: assist ? ASSIST_SYSTEM : DIAGNOSE_SYSTEM, seedUserText, creds: secrets })
  if (d.error) return { ok: false, transcript: d.transcript, probe: d.lastProbe, reason: d.error }
  // The answer is the finish summary if the model called finish, else the prose
  // it wrote directly. Either is a real answer to show the user.
  const answer = d.finishedSummary || d.finalText
  return {
    ok: !!(d.finished || answer),
    candidate: d.finished,
    diagnosis: answer,
    transcript: d.transcript,
    probe: d.lastProbe,
    reason: answer ? undefined : 'The assistant couldn’t complete an answer in the step budget — try asking again, more specifically.',
  }
}
