import { validateDevApiKey, logDevApiUsage } from '@/lib/dev-api-auth'
import { getDb } from '@/lib/db'
import { decrypt } from '@/lib/encrypt'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const start = Date.now()
  const auth = await validateDevApiKey(req, ['read'])
  if (!auth.ok) return auth.response

  const sql = getDb()

  // Get the active Airbyte instance
  const instances = await sql`SELECT * FROM airbyte_instances WHERE active = 1 LIMIT 1`
  const inst = instances[0] as Record<string, unknown> | undefined

  if (!inst) {
    await logDevApiUsage(auth.keyId, '/api/v1/connections/airbyte', 'GET', 200, Date.now() - start)
    return Response.json({ sources: [], connections: [], instance: null })
  }

  const base = (inst.url as string).replace(/\/$/, '')
  const username = inst.username as string
  const password = inst.password_enc ? decrypt(inst.password_enc as string) : ''
  const authHeader = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64')

  try {
    // Fetch sources and connections from Airbyte
    const [sourcesRes, connectionsRes] = await Promise.all([
      fetch(`${base}/api/public/v1/sources?workspaceId=${inst.workspace_id}`, {
        headers: { Authorization: authHeader }, signal: AbortSignal.timeout(8000),
      }),
      fetch(`${base}/api/public/v1/connections?workspaceId=${inst.workspace_id}`, {
        headers: { Authorization: authHeader }, signal: AbortSignal.timeout(8000),
      }),
    ])

    const [sourcesData, connectionsData] = await Promise.all([
      sourcesRes.ok ? sourcesRes.json() : { data: [] },
      connectionsRes.ok ? connectionsRes.json() : { data: [] },
    ])

    const sources = (sourcesData.data || []).map((s: Record<string, unknown>) => ({
      id: s.sourceId || s.id,
      name: s.name,
      source_type: s.sourceType || s.sourceName,
      status: s.connectionStatus || 'active',
    }))

    const connections = (connectionsData.data || []).map((c: Record<string, unknown>) => ({
      id: c.connectionId || c.id,
      name: c.name,
      status: c.status,
      schedule: c.scheduleType,
      last_sync: c.latestSyncJobCreatedAt,
    }))

    await logDevApiUsage(auth.keyId, '/api/v1/connections/airbyte', 'GET', 200, Date.now() - start)
    return Response.json({
      instance: { url: inst.url, workspace_id: inst.workspace_id },
      sources,
      connections,
    })
  } catch (err) {
    await logDevApiUsage(auth.keyId, '/api/v1/connections/airbyte', 'GET', 503, Date.now() - start)
    return Response.json({ error: 'Airbyte unreachable', detail: (err as Error).message }, { status: 503 })
  }
}
