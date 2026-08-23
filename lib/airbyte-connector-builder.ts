// lib/airbyte-connector-builder.ts
// Engine for AI-generated custom Airbyte connectors (declarative / low-code CDK).
//
// Flow: describe a source -> LLM generates a declarative manifest (YAML/JSON) ->
// test it against the LIVE source via Airbyte's connector-builder read_stream ->
// refine using the real returned records -> publish as a custom source definition.
//
// The connector runs entirely inside Airbyte's sandbox (a builder project, then a
// custom source definition), NEVER in Mosaic's process — so this adds no
// arbitrary-code-execution surface to Mosaic itself. Mosaic orchestrates + adds
// the AI layer.
//
// NOTE (tech debt): this mirrors the OAuth/Basic auth logic in
// app/api/airbyte/route.ts's private `ab()`. That client should be extracted to a
// shared lib and both call sites consolidated. Kept local here to avoid
// refactoring the 600-line route mid-build.
import { getDb } from './db'
import { decrypt } from './encrypt'
import { log } from './logger'

interface AirbyteInstance {
  id: string
  url: string
  username: string
  password_enc?: string | null
  client_id?: string | null
  client_secret_enc?: string | null
  workspace_id?: string | null
}

async function loadInstance(id?: string): Promise<AirbyteInstance> {
  const sql = getDb()
  const rows = id
    ? await sql`SELECT * FROM airbyte_instances WHERE id = ${id}`
    : await sql`SELECT * FROM airbyte_instances ORDER BY created_at ASC LIMIT 1`
  if (!rows.length) throw new Error('No Airbyte instance configured')
  return rows[0] as unknown as AirbyteInstance
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>()

async function getToken(inst: AirbyteInstance): Promise<string | null> {
  const base = inst.url.replace(/\/$/, '')
  const password = inst.password_enc ? decrypt(inst.password_enc) : 'password'
  const looksAbctl = inst.username.includes('@') || (password.length > 20 && password !== 'password')
  if (!looksAbctl) return null // Basic-auth (Docker) mode — caller builds Basic header

  const clientId = inst.client_id || inst.username
  const clientSecret = inst.client_secret_enc ? decrypt(inst.client_secret_enc) : password
  const cacheKey = `${base}:${clientId}`
  const cached = tokenCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now() + 30_000) return cached.token

  for (const url of [`${base}/api/v1/applications/token`, `${base}/api/public/v1/applications/token`]) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret }),
        signal: AbortSignal.timeout(10_000),
      })
      if (res.ok) {
        const data = await res.json() as { access_token: string; expires_in?: number }
        // abctl tokens expire in ~15 min. Honour expires_in (default 14 min) and
        // refresh 30s early — hardcoding a long TTL serves stale/dead tokens.
        const expiresAt = Date.now() + ((data.expires_in || 840) * 1000)
        tokenCache.set(cacheKey, { token: data.access_token, expiresAt })
        return data.access_token
      }
    } catch { /* try next url */ }
  }
  throw new Error('Airbyte token exchange failed')
}

async function authHeader(inst: AirbyteInstance): Promise<string> {
  const token = await getToken(inst)
  if (token) return `Bearer ${token}`
  const password = inst.password_enc ? decrypt(inst.password_enc) : 'password'
  return `Basic ${Buffer.from(`${inst.username}:${password}`).toString('base64')}`
}

/** Call an Airbyte config-API endpoint (/api/v1/...). */
async function config(inst: AirbyteInstance, path: string, body: unknown): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const base = inst.url.replace(/\/$/, '')
  const res = await fetch(`${base}/api/v1${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: await authHeader(inst) },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(60_000), // read_stream hits the live source — allow time
  })
  const text = await res.text()
  let json: Record<string, unknown> = {}
  try { json = text ? JSON.parse(text) : {} } catch { json = { raw: text } }
  return { ok: res.ok, status: res.status, json }
}

async function workspaceId(inst: AirbyteInstance): Promise<string> {
  if (inst.workspace_id) return inst.workspace_id
  const r = await config(inst, '/workspaces/list', {})
  const list = (r.json.workspaces as { workspaceId: string }[]) || []
  if (!list.length) throw new Error('No Airbyte workspace found')
  return list[0].workspaceId
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface ManifestDraft {
  projectId?: string
  manifest: Record<string, unknown> // the declarative manifest (JSON form of the YAML)
}

/** Create a connector-builder project to hold an iterating draft. */
export async function createProject(name: string, manifest: Record<string, unknown>, instanceId?: string): Promise<{ ok: boolean; projectId?: string; reason?: string }> {
  const inst = await loadInstance(instanceId)
  const ws = await workspaceId(inst)
  const r = await config(inst, '/connector_builder_projects/create', {
    workspaceId: ws,
    builderProject: { name, draftManifest: manifest },
  })
  if (!r.ok) return { ok: false, reason: reasonFrom(r) }
  const id = (r.json.builderProjectId as string) || ((r.json.builderProject as { builderProjectId?: string })?.builderProjectId)
  return { ok: true, projectId: id }
}

/**
 * Test a stream against the LIVE source and return the real records. This is the
 * iteration primitive — the "run the draft and show me what actually came back"
 * call that makes refine-until-right possible.
 */
export async function readStream(params: {
  manifest: Record<string, unknown>
  streamName: string
  config: Record<string, unknown> // user-supplied source config (auth, base url, etc.)
  projectId?: string
  instanceId?: string
}): Promise<{ ok: boolean; records?: unknown[]; requestResponse?: unknown; logs?: unknown[]; reason?: string }> {
  const inst = await loadInstance(params.instanceId)
  const ws = await workspaceId(inst)
  const r = await config(inst, '/connector_builder_projects/read_stream', {
    workspaceId: ws,
    builderProjectId: params.projectId,
    manifest: params.manifest,
    streamName: params.streamName,
    config: params.config,
    recordLimit: 10,
  })
  if (!r.ok) return { ok: false, reason: reasonFrom(r) }
  const slices = (r.json.slices as { pages?: { records?: unknown[] }[] }[]) || []
  const records = slices.flatMap(s => (s.pages || []).flatMap(p => p.records || []))
  return {
    ok: true,
    records,
    requestResponse: (r.json.slices as unknown) ?? null,
    logs: (r.json.logs as unknown[]) || [],
  }
}

/** Promote a working draft into a real custom source definition (usable like the built-in connectors). */
export async function publish(params: { projectId: string; name: string; manifest: Record<string, unknown>; instanceId?: string }): Promise<{ ok: boolean; sourceDefinitionId?: string; reason?: string }> {
  const inst = await loadInstance(params.instanceId)
  const ws = await workspaceId(inst)
  // Airbyte's DeclarativeSourceManifestInjector reads spec.connectionSpecification
  // as an ObjectNode (camelCase). The declarative manifest embeds its spec as
  // {type:'Spec', connection_specification:{...}} (snake_case) — the wrong shape
  // here, causing a MissingNode->ObjectNode cast error. Build the API-model spec
  // explicitly with connectionSpecification.
  const manifestSpec = params.manifest.spec as { connection_specification?: Record<string, unknown> } | undefined
  const connectionSpecification = manifestSpec?.connection_specification ?? {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    properties: {},
    additionalProperties: true,
  }
  const r = await config(inst, '/connector_builder_projects/publish', {
    workspaceId: ws,
    builderProjectId: params.projectId,
    name: params.name,
    initialDeclarativeManifest: {
      manifest: params.manifest,
      spec: { connectionSpecification },
      version: 1,
      description: `Custom connector "${params.name}" created via Mosaic`,
    },
  })
  if (!r.ok) return { ok: false, reason: reasonFrom(r) }
  return { ok: true, sourceDefinitionId: r.json.sourceDefinitionId as string }
}

/** List connector-builder projects (drafts) in the workspace. */
export async function listProjects(instanceId?: string): Promise<{ ok: boolean; projects?: { builderProjectId: string; name: string }[]; reason?: string }> {
  const inst = await loadInstance(instanceId)
  const ws = await workspaceId(inst)
  const r = await config(inst, '/connector_builder_projects/list', { workspaceId: ws })
  if (!r.ok) return { ok: false, reason: reasonFrom(r) }
  const projects = (r.json.projects as { builderProjectId: string; name: string }[]) || []
  return { ok: true, projects }
}

/** Delete a connector-builder project (draft). */
export async function deleteProject(projectId: string, instanceId?: string): Promise<{ ok: boolean; reason?: string }> {
  const inst = await loadInstance(instanceId)
  const ws = await workspaceId(inst)
  const r = await config(inst, '/connector_builder_projects/delete', { workspaceId: ws, builderProjectId: projectId })
  if (!r.ok) return { ok: false, reason: reasonFrom(r) }
  return { ok: true }
}

/** Delete a published custom source definition. */
export async function deleteSourceDefinition(sourceDefinitionId: string, instanceId?: string): Promise<{ ok: boolean; reason?: string }> {
  const inst = await loadInstance(instanceId)
  const r = await config(inst, '/source_definitions/delete', { sourceDefinitionId })
  if (!r.ok) return { ok: false, reason: reasonFrom(r) }
  return { ok: true }
}

function reasonFrom(r: { status: number; json: Record<string, unknown> }): string {
  const msg = (r.json.message as string) || (r.json.detail as string) || (r.json.raw as string) ||
    (r.json.exceptionClassName ? `${r.json.exceptionClassName}: ${String(r.json.exceptionStack ?? '').slice(0, 200)}` : '') ||
    JSON.stringify(r.json).slice(0, 300)
  return `Airbyte ${r.status}${msg ? ': ' + String(msg).slice(0, 300) : ''}`
}
