import { getSession } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { encrypt, decrypt } from '@/lib/encrypt'
import { setupDatabase } from '@/lib/setup'
import { testMcpEndpoint } from '@/lib/tools'
export const runtime = 'nodejs'

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
           (token_enc IS NOT NULL) AS has_token, created_at, updated_at
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
    if (!endpoint && body.id) {
      const rows = await sql`SELECT endpoint_url, token_enc FROM mcp_connections WHERE id=${body.id}`
      if (!rows.length) return Response.json({ error: 'Not found' }, { status: 404 })
      endpoint = (rows[0] as { endpoint_url: string }).endpoint_url
      const enc = (rows[0] as { token_enc: string | null }).token_enc
      token = enc ? decrypt(enc) : undefined
    }
    if (!endpoint) return Response.json({ error: 'endpoint_url required' }, { status: 400 })
    const result = await testMcpEndpoint(endpoint, token)
    return Response.json(result)
  }

  // -- CREATE ----------------------------------------------------
  if (action === 'create') {
    const { label, endpoint_url, transport, token, description } = body
    if (!label) return Response.json({ error: 'Label is required' }, { status: 400 })
    if (!endpoint_url) return Response.json({ error: 'Endpoint URL is required' }, { status: 400 })
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
    await sql`DELETE FROM mcp_connections WHERE id=${id}`
    return Response.json({ ok: true })
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 })
}
