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
import { createProject, readStream, publish } from '@/lib/airbyte-connector-builder'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  if (session.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const { action } = body as { action?: string }

  try {
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
      const { projectId, name, instanceId } = body
      if (!projectId || !name) return Response.json({ error: 'projectId and name required' }, { status: 400 })
      const r = await publish({ projectId, name, instanceId })
      if (!r.ok) return Response.json({ error: r.reason }, { status: 502 })
      return Response.json({ ok: true, sourceDefinitionId: r.sourceDefinitionId })
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 })
  }
}
