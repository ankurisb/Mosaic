import { getSession } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { encrypt, decrypt } from '@/lib/encrypt'
import { setupDatabase } from '@/lib/setup'
import { testMcpEndpoint, getMcpTools } from '@/lib/tools'
import { catalogForClient, getCatalogEntry, sidecarEndpoint } from '@/lib/mcp-catalog'
import { managerConfigured, provisionSidecar, removeSidecar, sidecarStatus } from '@/lib/mcp-manager'
export const runtime = 'nodejs'

// A short, collision-resistant suffix for sidecar container names.
function shortId(): string {
  return Math.random().toString(36).slice(2, 8)
}
// Build the full sidecar env from the catalog descriptor's fixedEnv + the user's values,
// dropping blanks so the server sees only what was actually filled in.
function buildSidecarEnv(entry: ReturnType<typeof getCatalogEntry>, values: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = { ...(entry?.fixedEnv || {}) }
  for (const f of entry?.fields || []) {
    const v = values[f.key]
    if (v != null && String(v).trim() !== '') env[f.key] = String(v)
  }
  return env
}

// MCP connections: first-class Model Context Protocol data sources.
// CRUD + a live "test" that lists the server's tools. Admin-only (Data
// sources is admin scoped). Secrets (bearer token) stored encrypted.

// -- GET -- list all MCP connections ----------------------------
export async function GET() {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  await setupDatabase()  // ensures the mcp_connections table exists
  const sql = getDb()
  const rows = await sql`
    SELECT id, label, endpoint_url, transport, description, enabled,
           (token_enc IS NOT NULL) AS has_token,
           managed, catalog_id, sidecar_name, created_at, updated_at
    FROM mcp_connections ORDER BY created_at ASC`
  return Response.json({ mcp_connections: rows })
}

// -- POST -- create / update / delete / test --------------------
export async function POST(req: Request) {
  const session = await getSession()
  if (!session || session.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 })
  await setupDatabase()  // ensures the mcp_connections table exists
  const sql = getDb()
  const body = await req.json()
  const { action } = body

  // -- TEST (also usable before saving: endpoint/token in body) --
  if (action === 'test') {
    let endpoint: string | undefined = body.endpoint_url
    let token: string | undefined = body.token
    let transport: string | undefined = body.transport
    if (!endpoint && body.id) {
      const rows = await sql`SELECT endpoint_url, token_enc, transport FROM mcp_connections WHERE id=${body.id}`
      if (!rows.length) return Response.json({ error: 'Not found' }, { status: 404 })
      endpoint = (rows[0] as { endpoint_url: string }).endpoint_url
      const enc = (rows[0] as { token_enc: string | null }).token_enc
      token = enc ? decrypt(enc) : undefined
      transport = (rows[0] as { transport: string | null }).transport || 'http'
    }
    if (!endpoint) return Response.json({ error: 'endpoint_url required' }, { status: 400 })
    const result = await testMcpEndpoint(endpoint, token, (transport as 'http' | 'sse' | 'stdio') || 'http')
    return Response.json(result)
  }

  // -- LIST-TOOLS -- full tool inventory (name + description) for a saved connection --
  if (action === 'list-tools') {
    const { id } = body as { id?: string }
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    const rows = await sql`SELECT endpoint_url FROM mcp_connections WHERE id=${id}`
    if (!rows.length) return Response.json({ error: 'Not found' }, { status: 404 })
    const endpoint = (rows[0] as { endpoint_url: string }).endpoint_url
    const tools = await getMcpTools(id, endpoint)   // loads token + transport from the row
    return Response.json({ ok: true, tools: tools.map(t => ({ name: t.name, description: t.description || '' })) })
  }

  // -- CATALOG -- list the provisionable managed-server descriptors (redacted) --
  if (action === 'catalog') {
    return Response.json({ catalog: catalogForClient(), manager_ready: managerConfigured() })
  }

  // -- PROVISION -- create a managed sidecar from a catalog entry + user values --
  // The web app never touches Docker; it asks the mcp-manager to start the sidecar,
  // then registers an MCP connection pointed at it. User-entered values are encrypted
  // at rest (env_enc) so edits can re-provision without re-prompting for secrets.
  if (action === 'provision') {
    if (!managerConfigured()) return Response.json({ error: 'Managed MCP servers are not enabled on this install (the MCP manager is not configured).' }, { status: 400 })
    const { catalog_id, label, values } = body as { catalog_id?: string; label?: string; values?: Record<string, string> }
    const entry = catalog_id ? getCatalogEntry(catalog_id) : undefined
    if (!entry) return Response.json({ error: 'Unknown catalog entry' }, { status: 400 })
    const vals = (values && typeof values === 'object') ? values : {}
    // Required-field validation against the descriptor.
    const missing = entry.fields.filter(f => f.required && String(vals[f.key] || '').trim() === '').map(f => f.label)
    if (missing.length) return Response.json({ error: `Missing required field(s): ${missing.join(', ')}` }, { status: 400 })

    const sidecarName = `mcp-${entry.id}-${shortId()}`
    const env = buildSidecarEnv(entry, vals)
    try {
      await provisionSidecar({ name: sidecarName, image: entry.image, env, port: entry.port })
    } catch (e) {
      return Response.json({ error: `Could not start the server: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 })
    }
    const endpoint = sidecarEndpoint(entry, sidecarName)
    const envEnc = encrypt(JSON.stringify(vals))
    const rows = await sql`
      INSERT INTO mcp_connections (label, endpoint_url, transport, description, managed, catalog_id, sidecar_name, env_enc)
      VALUES (${label || entry.name}, ${endpoint}, ${entry.transport}, ${entry.blurb}, 1, ${entry.id}, ${sidecarName}, ${envEnc})
      RETURNING id`
    return Response.json({ ok: true, id: (rows[0] as { id: string })?.id, sidecar_name: sidecarName, endpoint_url: endpoint })
  }

  // -- MANAGED STATUS -- inspect a managed sidecar (running state + log tail) --
  if (action === 'managed-status') {
    const { id } = body as { id?: string }
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    const rows = await sql`SELECT sidecar_name, managed FROM mcp_connections WHERE id=${id}`
    if (!rows.length) return Response.json({ error: 'Not found' }, { status: 404 })
    const name = (rows[0] as { sidecar_name: string | null }).sidecar_name
    if (!name) return Response.json({ error: 'Not a managed connection' }, { status: 400 })
    try {
      return Response.json({ ok: true, status: await sidecarStatus(name) })
    } catch (e) {
      return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 })
    }
  }

  // -- MANAGED UPDATE -- re-provision a managed sidecar with edited values --
  if (action === 'managed-update') {
    const { id, label, values } = body as { id?: string; label?: string; values?: Record<string, string> }
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    const rows = await sql`SELECT catalog_id, sidecar_name, env_enc, managed FROM mcp_connections WHERE id=${id}`
    if (!rows.length) return Response.json({ error: 'Not found' }, { status: 404 })
    const row = rows[0] as { catalog_id: string | null; sidecar_name: string | null; env_enc: string | null; managed: number }
    if (!row.managed || !row.sidecar_name || !row.catalog_id) return Response.json({ error: 'Not a managed connection' }, { status: 400 })
    const entry = getCatalogEntry(row.catalog_id)
    if (!entry) return Response.json({ error: 'Unknown catalog entry' }, { status: 400 })
    if (!managerConfigured()) return Response.json({ error: 'Managed MCP servers are not enabled on this install.' }, { status: 400 })
    // Merge: start from stored values, overlay any newly supplied (a blank secret keeps the old one).
    let stored: Record<string, string> = {}
    try { stored = row.env_enc ? JSON.parse(decrypt(row.env_enc)) : {} } catch { /* corrupt/absent */ }
    const next = { ...stored }
    for (const f of entry.fields) {
      const v = (values || {})[f.key]
      if (v != null && String(v).trim() !== '') next[f.key] = String(v)
    }
    const env = buildSidecarEnv(entry, next)
    try {
      await provisionSidecar({ name: row.sidecar_name, image: entry.image, env, port: entry.port })
    } catch (e) {
      return Response.json({ error: `Could not restart the server: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 })
    }
    await sql`
      UPDATE mcp_connections SET
        label=${label || entry.name}, env_enc=${encrypt(JSON.stringify(next))},
        updated_at=${new Date().toISOString()}
      WHERE id=${id}`
    return Response.json({ ok: true })
  }

  // -- CREATE ----------------------------------------------------
  if (action === 'create') {
    const { label, endpoint_url, transport, token, description } = body
    if (!label) return Response.json({ error: 'Label is required' }, { status: 400 })
    if (!endpoint_url) return Response.json({ error: 'Endpoint URL is required' }, { status: 400 })
    // SSRF guard at registration for URL transports (defense-in-depth; call-time is also enforced).
    // stdio's endpoint_url is a launcher command, not a URL, so the URL check doesn't apply there.
    if ((transport || 'http') !== 'stdio') {
      const { assertUrlSafe } = await import('@/lib/ssrf-guard')
      const safe = await assertUrlSafe(String(endpoint_url), 'lan') // on-prem MCP sidecars live on the LAN; loopback + metadata stay blocked
      if (!safe.ok) return Response.json({ error: safe.reason }, { status: 400 })
    }
    const tokenEnc = token ? encrypt(token) : null
    const rows = await sql`
      INSERT INTO mcp_connections (label, endpoint_url, transport, token_enc, description)
      VALUES (${label}, ${endpoint_url}, ${transport || 'http'}, ${tokenEnc}, ${description || null})
      RETURNING id`
    return Response.json({ ok: true, id: (rows[0] as { id: string })?.id })
  }

  // -- UPDATE ----------------------------------------------------
  if (action === 'update') {
    const { id, label, endpoint_url, transport, token, description, enabled } = body
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    // Only re-encrypt the token if a new one was supplied (empty = leave as-is).
    if (token) {
      await sql`UPDATE mcp_connections SET token_enc=${encrypt(token)} WHERE id=${id}`
    }
    await sql`
      UPDATE mcp_connections SET
        label=${label}, endpoint_url=${endpoint_url}, transport=${transport || 'http'},
        description=${description || null}, enabled=${enabled ? 1 : 0},
        updated_at=${new Date().toISOString()}
      WHERE id=${id}`
    return Response.json({ ok: true })
  }

  // -- DELETE ----------------------------------------------------
  if (action === 'delete') {
    const { id } = body
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    // Managed connections own a sidecar container — tear it down first (best-effort:
    // a manager that's down or a container already gone shouldn't block removing the row).
    const rows = await sql`SELECT sidecar_name, managed FROM mcp_connections WHERE id=${id}`
    const row = rows[0] as { sidecar_name: string | null; managed: number } | undefined
    if (row?.managed && row.sidecar_name) {
      try { await removeSidecar(row.sidecar_name) } catch { /* best-effort cleanup */ }
    }
    await sql`DELETE FROM mcp_connections WHERE id=${id}`
    return Response.json({ ok: true })
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 })
}
