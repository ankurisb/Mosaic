// lib/ai/api-agent.ts
// Agentic builder for a Type-2 live API source. Instead of a single guess +
// human probe, the model drives a tool loop that does what a careful engineer
// would: discover the API's spec, log in FOR REAL and read where the token
// actually lives, probe a cheap endpoint to confirm auth, and only then finish
// with a working candidate. Credentials are injected server-side — the model
// never sees or emits them.
import Anthropic from '@anthropic-ai/sdk'
import { getDefaultModelId } from '@/lib/models'
import { getKey } from '@/lib/keys'
import { fetchUrlText } from '@/lib/doc-fetch'
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

1. If you were given a base URL or docs link, call discover_spec on the base to find an OpenAPI/Swagger spec (or inspect_openapi / fetch_text on a known URL). Read the auth scheme, the login endpoint and its request field names, and the available endpoints.
2. If auth is a login endpoint that returns a token, call login_probe — it posts the (server-held) credentials for you and returns the RAW login response. LOOK at that response and set token_path to where the token actually is (e.g. "tokens.access", "data.token") instead of assuming "access_token". Note the token header/prefix.
3. Build a candidate and call probe on a cheap GET list endpoint to confirm the whole chain works (expect 2xx with data, or an empty array). If it fails, read the error and adjust auth_config / token_path / base_path / the path, then probe again.
4. When a probe succeeds, call finish with the candidate.

Rules:
- NEVER put credentials (username/password/token/key) in any tool argument or in the candidate's auth_config — the server injects them. Set only structural fields.
- Quote real endpoints from the spec; never invent paths.
- auth_type is one of: bearer, api_key_header, basic, oauth2_client, session_token, custom_headers. For a username/password login returning a token, use session_token with: login_url (path relative to base is fine), username_field, password_field, login_body_format, token_path, token_header, token_prefix.
- base_url is scheme+host(+stable prefix) with no trailing slash.
- A "connection" is an endpoint GROUP (a base_path the agent can call any path under at query time), NOT a single endpoint. After auth is confirmed, create ONE connection for EACH group in the spec summary's \`groups\` (base_path = "/" + group, e.g. "/assets"), so the WHOLE API is reachable — not just the groups you happened to probe. You do NOT need to probe every group; 1–2 successful probes confirm the auth chain, then register all the groups. Give each connection a readable label and set pagination_data_path if the list responses nest their records. If the user named specific groups, make sure those are included, plus the rest.
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

export async function runApiAgent(params: {
  description: string
  materials?: string
  credentials?: Record<string, string>
}): Promise<AgentResult> {
  const creds = params.credentials || {}
  const transcript: string[] = []
  let lastProbe: ProbeOutcome | undefined
  const cacheKey = `agent:${Date.now().toString(36)}`

  // Merge the real (server-held) credential values into a model-supplied auth_config.
  const withCreds = (authConfig: Record<string, unknown> | undefined): Record<string, unknown> =>
    ({ ...(authConfig || {}), ...creds })

  async function runTool(name: string, input: Record<string, unknown>): Promise<{ result: unknown; finished?: AgentCandidate }> {
    if (name === 'discover_spec') {
      const base = String(input.base_url || '').replace(/\/$/, '')
      const tried: Array<{ url: string; status: string }> = []
      let summary: unknown = null; let foundUrl = ''; let docText = ''
      for (const sp of SPEC_PATHS) {
        const url = base + sp
        // Specs can be large (hundreds of KB) — fetch without the docs text cap
        // so a big OpenAPI JSON isn't truncated before it parses.
        const r = await fetchUrlText(url, { maxBytes: 12_000_000, maxText: 12_000_000 })
        if (!r.ok) { tried.push({ url, status: (r as { ok: false; error: string }).error }); continue }
        tried.push({ url, status: 'ok' })
        const parsed = parseSpec((r as { ok: true; text: string }).text)
        const s = parsed ? summarizeOpenApi(parsed) : { ok: false }
        if (s.ok) { summary = s; foundUrl = url; break }
        if (sp.endsWith('llms.txt') || sp.endsWith('/docs')) docText ||= (r as { ok: true; text: string }).text.slice(0, 8000)
      }
      const sm = summary as { endpointCount: number; groups: string[] } | null
      transcript.push(sm ? `Discovered API spec at ${foundUrl} — ${sm.endpointCount} endpoints across ${sm.groups.length} groups (${sm.groups.slice(0, 10).join(', ')}${sm.groups.length > 10 ? '…' : ''}).` : `Looked for a spec under ${base} — none found.`)
      return { result: { found: foundUrl || null, summary, docs_text: docText || undefined, tried } }
    }

    if (name === 'inspect_openapi') {
      const r = await fetchUrlText(String(input.url || ''), { maxBytes: 12_000_000, maxText: 12_000_000 })
      if (!r.ok) { transcript.push(`Couldn't fetch spec ${input.url}.`); return { result: { ok: false, error: (r as { ok: false; error: string }).error } } }
      const parsed = parseSpec((r as { ok: true; text: string }).text)
      const s = parsed ? summarizeOpenApi(parsed) : { ok: false, reason: 'not a spec' }
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
      return { result: { ok: true }, finished: (input.candidate || {}) as AgentCandidate }
    }

    return { result: { error: `unknown tool ${name}` } }
  }

  try {
    const client = new Anthropic({ apiKey: (await getKey('ANTHROPIC_API_KEY')) || undefined })
    const model = await getDefaultModelId()
    const userText = [
      `Connect this API:\n${params.description}`,
      params.materials ? `\nMaterials provided:\n${params.materials.slice(0, 16000)}` : '',
      Object.keys(creds).length ? `\nCredentials are available server-side (fields: ${Object.keys(creds).join(', ')}). Use login_probe/probe — never type the values.` : `\nNo credentials were provided; discover what's needed and finish with ready_to_probe:false if auth can't be completed.`,
      `\nBegin by discovering the API.`,
    ].join('')

    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userText }]
    let finished: AgentCandidate | undefined

    for (let step = 0; step < MAX_STEPS; step++) {
      const resp = await client.messages.create({ model, max_tokens: 2000, system: SYSTEM, tools: TOOLS, messages })
      messages.push({ role: 'assistant', content: resp.content })
      const toolUses = resp.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      if (!toolUses.length) break
      const toolResults: Anthropic.ToolResultBlockParam[] = []
      for (const tu of toolUses) {
        const { result, finished: fin } = await runTool(tu.name, (tu.input || {}) as Record<string, unknown>)
        if (fin) finished = fin
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result).slice(0, 20000) })
      }
      if (finished) break
      messages.push({ role: 'user', content: toolResults })
    }

    if (!finished) return { ok: false, transcript, probe: lastProbe, reason: 'The agent did not reach a working connection in the step budget.' }
    return { ok: !!lastProbe?.ok, candidate: finished, transcript, probe: lastProbe }
  } catch (e) {
    return { ok: false, transcript, reason: e instanceof Error ? e.message : String(e) }
  }
}
