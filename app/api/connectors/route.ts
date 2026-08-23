// app/api/connectors/route.ts
// Custom-connector authoring API (admin-only). Orchestrates the AI-driven
// declarative-connector flow on top of Airbyte's connector-builder:
//   test    -> read_stream against the live source, return real records (the iterate loop)
//   create  -> create a builder project to hold a draft
//   publish -> promote a working draft to a custom source definition
//
// AI generation (description/sample -> manifest) is a separate action wired to
// the LLM; this route is the Airbyte-side orchestration + the human-in-the-loop
// test/publish gates. The connector runs in Airbyte's sandbox, never in Mosaic.
import { getSession } from '@/lib/auth'
import { createProject, readStream, publish, listProjects, deleteProject, deleteSourceDefinition, listCustomConnectors, getDestinationConfig } from '@/lib/airbyte-connector-builder'
import { generateManifest, refineManifest } from '@/lib/ai/connector-prompt'
import { getDb } from '@/lib/db'
import { encrypt } from '@/lib/encrypt'
import { syncToSuperset } from '@/lib/superset-sync'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  if (session.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const { action } = body as { action?: string }

  try {
    if (action === 'generate') {
      // AI: plain-English description (+ optional sample/docs) -> draft manifest.
      const { description, sample } = body
      if (!description) return Response.json({ error: 'description required' }, { status: 400 })
      const r = await generateManifest(description, sample)
      if (!r.ok) return Response.json({ error: r.reason }, { status: 502 })
      return Response.json({ ok: true, manifest: r.manifest, streamName: r.streamName })
    }

    if (action === 'refine') {
      // AI: previous manifest + REAL test outcome -> corrected manifest.
      const { previousManifest, testRecords, testError, testLogs, userNote } = body
      if (!previousManifest) return Response.json({ error: 'previousManifest required' }, { status: 400 })
      const r = await refineManifest({ previousManifest, testRecords, testError, testLogs, userNote })
      if (!r.ok) return Response.json({ error: r.reason }, { status: 502 })
      return Response.json({ ok: true, manifest: r.manifest, streamName: r.streamName })
    }

    if (action === 'test') {
      // Iterate loop: run the draft manifest against the real source, return records.
      const { manifest, streamName, config, projectId, instanceId } = body
      if (!manifest || !streamName) return Response.json({ error: 'manifest and streamName required' }, { status: 400 })
      const r = await readStream({ manifest, streamName, config: config || {}, projectId, instanceId })
      if (!r.ok) return Response.json({ error: r.reason }, { status: 502 })
      return Response.json({ ok: true, records: r.records, recordCount: r.records?.length ?? 0, logs: r.logs })
    }

    if (action === 'create') {
      const { name, manifest, instanceId } = body
      if (!name || !manifest) return Response.json({ error: 'name and manifest required' }, { status: 400 })
      const r = await createProject(name, manifest, instanceId)
      if (!r.ok) return Response.json({ error: r.reason }, { status: 502 })
      return Response.json({ ok: true, projectId: r.projectId })
    }

    if (action === 'publish') {
      const { projectId, name, manifest, instanceId } = body
      if (!projectId || !name || !manifest) return Response.json({ error: 'projectId, name and manifest required' }, { status: 400 })
      const r = await publish({ projectId, name, manifest, instanceId })
      if (!r.ok) return Response.json({ error: r.reason }, { status: 502 })
      return Response.json({ ok: true, sourceDefinitionId: r.sourceDefinitionId })
    }

    if (action === 'register_connection') {
      // Register the Airbyte destination (where the connector's data lands) as a
      // queryable Mosaic connection. Host/port/db/schema/username come from the
      // destination config; the password is operator-supplied (Airbyte redacts it).
      const { destinationId, password, label, instanceId } = body
      if (!destinationId || !label) return Response.json({ error: 'destinationId and label required' }, { status: 400 })
      const dc = await getDestinationConfig(destinationId, instanceId)
      if (!dc.ok) return Response.json({ error: dc.reason }, { status: 502 })
      const cfg = dc.config || {}
      const host = cfg.host as string | undefined
      const port = (cfg.port as number | undefined) ?? 5432
      const database = cfg.database as string | undefined
      const schema = (cfg.schema as string | undefined) || 'public'
      const username = cfg.username as string | undefined
      if (!host || !database) return Response.json({ error: 'Destination config missing host/database' }, { status: 422 })
      // Airbyte redacts the password as "**********" — require a real one from the operator.
      const realPassword = (password && password !== '**********') ? password : null
      const sql = getDb()
      const passwordEnc = realPassword ? encrypt(realPassword) : null
      const rows = await sql`
        INSERT INTO db_connections(label,dialect,environment,host,port,database_name,username,password_enc,schema_name,read_only,description)
        VALUES(${label},'postgres','development',${host},${port},${database},${username || null},${passwordEnc},${schema},true,${'Landed by custom connector via Airbyte'})
        RETURNING id`
      const newId = (rows[0] as { id: string }).id
      // Register with Superset too, so the landed data is dashboard-able like any
      // other SQL connection (best-effort — don't fail registration if it lags).
      syncToSuperset({ id: newId, label, dialect: 'postgres', host, port: Number(port), database_name: database, username: username || undefined, password: realPassword || undefined, schema_name: schema }).catch(() => {})
      return Response.json({ ok: true, connectionId: newId, host, database, schema })
    }

    if (action === 'list_connectors') {
      const r = await listCustomConnectors(body.instanceId)
      if (!r.ok) return Response.json({ error: r.reason }, { status: 502 })
      return Response.json({ ok: true, connectors: r.connectors })
    }

    if (action === 'list_projects') {
      const r = await listProjects(body.instanceId)
      if (!r.ok) return Response.json({ error: r.reason }, { status: 502 })
      return Response.json({ ok: true, projects: r.projects })
    }

    if (action === 'delete_project') {
      const { projectId, instanceId } = body
      if (!projectId) return Response.json({ error: 'projectId required' }, { status: 400 })
      const r = await deleteProject(projectId, instanceId)
      if (!r.ok) return Response.json({ error: r.reason }, { status: 502 })
      return Response.json({ ok: true })
    }

    if (action === 'delete_source_definition') {
      const { sourceDefinitionId, instanceId } = body
      if (!sourceDefinitionId) return Response.json({ error: 'sourceDefinitionId required' }, { status: 400 })
      const r = await deleteSourceDefinition(sourceDefinitionId, instanceId)
      if (!r.ok) return Response.json({ error: r.reason }, { status: 502 })
      return Response.json({ ok: true })
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 })
  }
}
