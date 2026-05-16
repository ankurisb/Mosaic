// POST /api/connections/fts
// Enables or disables full-text search sync for a db_connection via Airbyte.
// When enabled:
//   1. Finds the matching Airbyte source for this connection
//   2. Finds or creates an ES destination pointing at the internal ES instance
//   3. Creates an Airbyte connection with text-column streams selected
//   4. Triggers an initial sync
//   5. Updates db_connections.full_text_search = 1
// When disabled:
//   1. Deletes the Airbyte connection
//   2. Updates db_connections.full_text_search = 0

import { NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { decrypt } from '@/lib/encrypt'

const TEXT_TYPES = new Set([
  'text', 'varchar', 'character varying', 'char', 'nvarchar', 'ntext',
  'string', 'mediumtext', 'longtext', 'clob', 'memo',
])

const TEXT_NAME_PATTERNS = [
  /notes?$/i, /description$/i, /comment$/i, /narrative$/i,
  /summary$/i, /detail$/i, /reason$/i, /remarks?$/i,
  /message$/i, /text$/i, /body$/i, /content$/i, /log$/i,
]

const ALWAYS_INCLUDE_PATTERNS = [
  /^id$/i, /_id$/i, /^timestamp$/i, /^created_at$/i, /^updated_at$/i,
  /^date$/i, /^asset/i, /^machine/i, /^line$/i, /^shift$/i, /^status$/i,
]

function shouldInclude(name: string, type: string): boolean {
  const t = type.toLowerCase()
  if (TEXT_TYPES.has(t)) return true
  if (TEXT_NAME_PATTERNS.some(p => p.test(name))) return true
  if (ALWAYS_INCLUDE_PATTERNS.some(p => p.test(name))) return true
  return false
}

async function ab(inst: Record<string, unknown>, pathV2: string, pathV1: string, method: string, body?: unknown) {
  const baseUrl = (inst.url as string).replace(/\/$/, '')
  const password = decrypt((inst.password_enc as string) || '')
  const auth = 'Basic ' + Buffer.from(`${inst.username}:${password}`).toString('base64')
  for (const path of [pathV2, pathV1]) {
    const res = await fetch(`${baseUrl}/api/v1${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'Authorization': auth },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    })
    if (res.ok) return res.json()
    if (res.status !== 404) { const txt = await res.text(); const clean = txt.includes('<html') ? `HTTP ${res.status} — is Airbyte running?` : txt.slice(0, 200); throw new Error(`Airbyte ${res.status}: ${clean}`) }
  }
  throw new Error('Airbyte: endpoint not found')
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || session.role !== 'admin') {
    return Response.json({ error: 'Admin required' }, { status: 403 })
  }

  const body = await req.json()
  const { connectionId, enable } = body as { connectionId: string; enable: boolean }
  if (!connectionId) return Response.json({ error: 'connectionId required' }, { status: 400 })

  const sql = getDb()
  const [conn] = await sql`SELECT * FROM db_connections WHERE id = ${connectionId}`
  if (!conn) return Response.json({ error: 'Connection not found' }, { status: 404 })

  if (conn.dialect === 'elasticsearch') {
    return Response.json({ error: 'Cannot enable full-text search on an Elasticsearch connection' }, { status: 400 })
  }

  // ── DISABLE ────────────────────────────────────────────────
  if (!enable) {
    if (conn.fts_airbyte_conn_id) {
      try {
        const [inst] = await sql`SELECT * FROM airbyte_instances WHERE active = 1 ORDER BY created_at ASC LIMIT 1`
        if (inst) {
          await ab(inst, `/connections/${conn.fts_airbyte_conn_id}`, '/connections/delete', 'DELETE', { connectionId: conn.fts_airbyte_conn_id })
        }
      } catch (e) {
        console.warn('FTS disable: could not delete Airbyte connection:', (e as Error).message)
      }
    }
    await sql`UPDATE db_connections SET full_text_search = 0, fts_airbyte_conn_id = NULL WHERE id = ${connectionId}`
    return Response.json({ ok: true, enabled: false })
  }

  // ── ENABLE ─────────────────────────────────────────────────

  // 1. Airbyte instance
  const [inst] = await sql`SELECT * FROM airbyte_instances WHERE active = 1 ORDER BY created_at ASC LIMIT 1`
  if (!inst) return Response.json({ error: 'No Airbyte instance configured. Add one in Settings → Airbyte.' }, { status: 400 })

  // 2. Internal ES connection
  const [esConn] = await sql`SELECT * FROM db_connections WHERE managed = 1 AND dialect = 'elasticsearch' LIMIT 1`
  if (!esConn) return Response.json({ error: 'Mosaic Search Index not found. Ensure ELASTICSEARCH_INTERNAL_URL is set and Mosaic has restarted.' }, { status: 400 })

  try {
    // 3. Workspace ID
    const wsData = await ab(inst, '/workspaces', '/workspaces/list', 'GET') as Record<string, unknown>
    const workspaces = (wsData?.data || (wsData as Record<string,unknown>)?.workspaces) as Array<Record<string,unknown>>
    const workspaceId = workspaces?.[0]?.workspaceId
    if (!workspaceId) throw new Error('Could not determine Airbyte workspace ID')

    // 4. Find or create ES destination
    const destData = await ab(inst, `/destinations?workspaceIds=${workspaceId}&limit=100`, '/destinations/list', 'GET', { workspaceId }) as Record<string,unknown>
    const destinations = (destData?.data || (destData as Record<string,unknown>)?.destinations || []) as Array<Record<string,unknown>>
    let esDestId = (destinations.find((d) =>
      d.name === 'Mosaic Search Index' ||
      (d.connectionConfiguration as Record<string,unknown>)?.host === 'elasticsearch'
    ) as Record<string,unknown>)?.destinationId as string | undefined

    if (!esDestId) {
      const defData = await ab(inst, '/destination_definitions?limit=200', '/destination_definitions/list', 'GET', { workspaceId }) as Record<string,unknown>
      const defs = (defData?.data || (defData as Record<string,unknown>)?.destinationDefinitions || []) as Array<Record<string,unknown>>
      const esDef = defs.find(d =>
        String(d.dockerRepository || '').includes('elasticsearch') ||
        String(d.name || '').toLowerCase().includes('elasticsearch')
      )
      if (!esDef) throw new Error('Elasticsearch destination connector not found in Airbyte.')
      const newDest = await ab(inst, '/destinations', '/destinations/create', 'POST', {
        workspaceId,
        name: 'Mosaic Search Index',
        destinationDefinitionId: esDef.destinationDefinitionId || esDef.id,
        connectionConfiguration: { host: 'elasticsearch', port: 9200, upsert: true, index_prefix: 'mosaic-' },
      }) as Record<string,unknown>
      esDestId = (newDest.destinationId || newDest.id) as string
    }

    // 5. Find matching Airbyte source
    const srcData = await ab(inst, `/sources?workspaceIds=${workspaceId}&limit=100`, '/sources/list', 'GET', { workspaceId }) as Record<string,unknown>
    const sources = (srcData?.data || (srcData as Record<string,unknown>)?.sources || []) as Array<Record<string,unknown>>
    const matched = sources.find(s =>
      (s.connectionConfiguration as Record<string,unknown>)?.host === conn.host ||
      s.name === conn.label
    )
    if (!matched) return Response.json({
      error: `No Airbyte source found matching "${conn.label}". Create a source in Airbyte for this database first.`,
    }, { status: 400 })
    const sourceId = (matched.sourceId || matched.id) as string

    // 6. Discover schema
    const schemaData = await ab(inst, `/sources/${sourceId}/schema_catalog`, '/sources/discover_schema', 'GET', { sourceId }) as Record<string,unknown>
    const streams = ((schemaData?.catalog || schemaData) as Record<string,unknown>)?.streams as Array<Record<string,unknown>> || []

    // 7. Build sync catalog — text columns + context fields only
    const selectedStreams = streams.map(s => {
      const stream = s.stream as Record<string,unknown>
      const props = ((stream?.jsonSchema as Record<string,unknown>)?.properties || {}) as Record<string, Record<string,unknown>>
      const selectedFields = Object.entries(props)
        .filter(([name, def]) => shouldInclude(name, String(def?.type || def?.format || '')))
        .map(([name]) => name)
      if (selectedFields.length === 0) return null
      const hasCursor = ['updated_at','created_at','timestamp'].find(f => props[f])
      return {
        stream,
        config: {
          selected: true,
          syncMode: hasCursor ? 'incremental' : 'full_refresh',
          destinationSyncMode: 'append_dedup',
          cursorField: hasCursor ? [hasCursor] : [],
          primaryKey: [['id']],
          fieldSelectionEnabled: true,
          selectedFields: selectedFields.map(f => ({ fieldPath: [f] })),
        },
      }
    }).filter(Boolean)

    if (selectedStreams.length === 0) return Response.json({
      error: 'No suitable text columns found. Full-text search works best with tables that have notes, description, or comment fields.',
    }, { status: 400 })

    // 8. Create Airbyte connection
    const newABConn = await ab(inst, '/connections', '/connections/create', 'POST', {
      sourceId,
      destinationId: esDestId,
      name: `Mosaic FTS — ${conn.label}`,
      status: 'active',
      schedule: { scheduleType: 'cron', cronExpression: '0 */30 * * * ?' },
      syncCatalog: { streams: selectedStreams },
    }) as Record<string,unknown>
    const airbyteConnectionId = (newABConn.connectionId || newABConn.id) as string

    // 9. Trigger initial sync
    await ab(inst, '/jobs', '/connections/sync', 'POST', { type: 'sync', connectionId: airbyteConnectionId })

    // 10. Mark connection as FTS-enabled
    await sql`UPDATE db_connections SET full_text_search = 1, fts_airbyte_conn_id = ${airbyteConnectionId} WHERE id = ${connectionId}`

    return Response.json({
      ok: true,
      enabled: true,
      airbyteConnectionId,
      streamsSelected: selectedStreams.length,
      message: `Full-text search enabled. ${selectedStreams.length} stream(s) syncing to Mosaic Search Index every 30 minutes.`,
    })

  } catch (e) {
    console.error('FTS enable error:', e)
    return Response.json({ error: (e as Error).message }, { status: 500 })
  }
}
