// lib/ai/api-builder-prompt.ts
// AI authoring of a Mosaic "Type 2" live API source (api_services +
// api_connections) from a plain-English description plus whatever materials the
// user has — pasted docs, an OpenAPI/Postman export, a sample response, a docs
// URL's text.
//
// Two entry points mirror the Airbyte connector builder's proven loop:
//   generateApiCandidate(description, materials) -> a first-draft candidate
//   refineApiCandidate({previous, probe, userNote}) -> a corrected candidate
//     given the REAL outcome of probing the previous draft live (/api/test-api
//     candidate mode). The model iterates against ground truth, not its guesses.
//
// The candidate is shaped so the UI can (a) probe it unsaved and (b) register
// it via the existing /api/services createService + createConnection actions
// with no translation.
import Anthropic from '@anthropic-ai/sdk'
import { getDefaultModelId } from '@/lib/models'

const SYSTEM = `You configure a live REST/HTTP API as a data source for Mosaic. Mosaic calls the API in real time (during an analysis/chat), so you are NOT writing an ingestion pipeline — you are producing a connection definition Mosaic can call.

You output ONLY a single JSON object (no prose, no markdown, no code fences) with this shape:
{
  "service": {
    "label": "<short human name, e.g. 'Terralayr'>",
    "base_url": "https://api.host.com",            // scheme + host (+ stable prefix), NO trailing slash
    "auth_type": "bearer | api_key_header | basic | oauth2_client | session_token | custom_headers",
    "auth_config": { /* fields for the chosen auth_type — see below */ },
    "default_headers": { /* optional extra headers sent on every request, {} if none */ },
    "api_version": null,                             // or a version string if the API pins one
    "version_header": null                           // header name the version goes in, if any
  },
  "connections": [
    {
      "label": "<endpoint group name, e.g. 'Auctions'>",
      "description": "<what this returns>",
      "base_path": "/path",                          // path appended to base_url for this group; may bake mandatory query params
      "pagination_style": "none | page | cursor | offset",
      "pagination_limit_param": "limit",
      "pagination_cursor_param": "cursor",
      "pagination_data_path": null                   // dot-path to the records array in the response, e.g. "data.results"; null if the body IS the array
    }
  ],
  "probe": { "connection_index": 0, "method": "GET", "path": "/" },   // a cheap first call that proves auth + shape
  "missing": [ { "field": "password", "label": "Terralayr password", "secret": true } ],  // config the user must still supply
  "message": "<one or two sentences: what you concluded and what (if anything) you need from the user>",
  "ready_to_probe": true
}

AUTH TYPES and their auth_config fields:
- bearer           -> { "token": "<token>" }                                  Authorization: Bearer <token>
- api_key_header   -> { "header": "X-API-Key", "key": "<key>" }               sends that header
- basic            -> { "username": "...", "password": "..." }                Authorization: Basic base64(user:pass)
- oauth2_client    -> { "client_id", "client_secret", "token_url", "refresh_token"? , "header_prefix"? }  OAuth2 (form-encoded grant)
- session_token    -> login endpoint that returns a token in its JSON body. Fields:
     { "login_url": "<absolute or path relative to base_url>",
       "username": "...", "password": "...",
       "username_field": "username",      // body key for username if not 'username'
       "password_field": "password",      // body key for password if not 'password'
       "login_body_format": "json",       // or "form"
       "login_body_extra": "{\\"grant_type\\":\\"password\\"}",  // JSON string, optional extra body fields
       "token_path": "access_token",      // dot-path to the token in the login response
       "token_header": "Authorization",   // header to put the token on
       "token_prefix": "Bearer",          // value prefix ('' for a bare token)
       "expiry_path": null,               // dot-path to a lifetime-in-seconds field, if returned
       "token_ttl_seconds": "3600" }      // fallback lifetime
- custom_headers   -> an object of header:value pairs sent verbatim

CHOOSING auth_type:
- A username/password that is POSTed to a login/authenticate endpoint which returns a token (then used as a Bearer) => session_token. This is common; prefer it over bearer when the docs show a login step.
- A pre-issued static token the user pastes => bearer.
- A key sent in a header => api_key_header.
- OAuth2 with client_id/secret and a token endpoint => oauth2_client.
- HTTP Basic => basic.

RULES:
- Infer base_url, auth, and endpoints from the description and any provided docs/sample. Quote real paths from the docs; do not invent endpoints.
- For every credential/secret you do NOT have a concrete value for, put it in "missing" (secret:true for passwords/keys/tokens) and set "ready_to_probe": false. NEVER fabricate a credential value — leave the field out of auth_config and list it in "missing".
- Put non-secret, user-specific values you still need (an account id, a region) in "missing" too (secret:false).
- Set pagination_data_path to where the records live so Mosaic can find them; use null if the top-level body is the array.
- "probe" should be the cheapest call that proves auth works and reveals the record shape (prefer a small list endpoint).
- Create one connection per logical endpoint group the user cares about; if they named specific domains, cover those.
- Output the JSON object only.`

function extractJson(text: string): Record<string, unknown> {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('AI did not return a JSON candidate')
  return JSON.parse(cleaned.slice(start, end + 1))
}

export interface ApiCandidateResult {
  ok: boolean
  candidate?: Record<string, unknown>
  reason?: string
}

/** First-draft candidate from a description plus optional materials (docs text, sample, spec). */
export async function generateApiCandidate(description: string, materials?: string): Promise<ApiCandidateResult> {
  try {
    const client = new Anthropic()
    const user = [
      `What the user wants to connect:\n${description}`,
      materials ? `\nMaterials they provided (docs / sample response / spec — use these to get base_url, auth and the record path right):\n${materials.slice(0, 24000)}` : '',
      `\nProduce the API source candidate JSON.`,
    ].join('')
    const msg = await client.messages.create({
      model: await getDefaultModelId(),
      max_tokens: 3000,
      system: SYSTEM,
      messages: [{ role: 'user', content: user }],
    })
    const text = (msg.content.find(b => b.type === 'text') as { text: string } | undefined)?.text ?? ''
    return { ok: true, candidate: extractJson(text) }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Refine a candidate using the REAL outcome of probing the previous draft.
 * `probe` carries what actually happened: HTTP status, the returned body (so
 * the model can confirm/locate the records) and/or an error string.
 */
export async function refineApiCandidate(params: {
  previousCandidate: Record<string, unknown>
  probeStatus?: number
  probeBody?: unknown
  probeError?: string
  userNote?: string
}): Promise<ApiCandidateResult> {
  try {
    const client = new Anthropic()
    const bodyPreview = params.probeBody !== undefined
      ? JSON.stringify(params.probeBody, null, 2).slice(0, 4000)
      : ''
    const parts = [
      `Here is the previous candidate you produced:\n${JSON.stringify(params.previousCandidate, null, 2)}`,
      typeof params.probeStatus === 'number' ? `\nProbing it live returned HTTP ${params.probeStatus}.` : '',
      params.probeError ? `\nError: ${params.probeError}` : '',
      bodyPreview ? `\nResponse body (use this to fix the record path / pagination / fields):\n${bodyPreview}` : '',
      params.userNote ? `\nUser correction: ${params.userNote}` : '',
      `\nReturn a corrected candidate JSON that fixes the problem. Keep any working parts; only change what the evidence shows is wrong. If auth failed (401/403), reconsider auth_type/auth_config or what is still 'missing'. If records came back but under a different key, fix pagination_data_path. Output JSON only.`,
    ]
    const msg = await client.messages.create({
      model: await getDefaultModelId(),
      max_tokens: 3000,
      system: SYSTEM,
      messages: [{ role: 'user', content: parts.join('') }],
    })
    const text = (msg.content.find(b => b.type === 'text') as { text: string } | undefined)?.text ?? ''
    return { ok: true, candidate: extractJson(text) }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}
