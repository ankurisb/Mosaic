// app/api/api-builder/route.ts
// AI-assisted authoring of a Mosaic Type-2 live API source. Admin-only,
// config-time. Orchestrates the generate -> probe -> refine loop:
//   generate    -> description + materials -> draft candidate (lib/ai/api-builder-prompt)
//   refine      -> previous candidate + REAL probe outcome -> corrected candidate
//   fetch_docs  -> SSRF-guarded fetch of a docs URL (e.g. llms.txt) as material
//
// Probing a draft is /api/test-api (candidate mode); registering a finished
// candidate is /api/services (createService + createConnection) — both already
// exist, so this route is only the LLM brain + the docs fetch.
import { getSession } from '@/lib/auth'
import { generateApiCandidate, refineApiCandidate } from '@/lib/ai/api-builder-prompt'
import { runApiAgent, diagnoseApiConnection, mergeStoredSecrets } from '@/lib/ai/api-agent'
import { getServiceConfigById, upsertApiSource, type ApiServiceConfig } from '@/lib/api-source-store'
import { audit, AUDIT } from '@/lib/audit'
import { extractUrls, fetchUrlText, gatherMaterials, type FetchedDoc } from '@/lib/doc-fetch'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  if (session.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const { action } = body as { action?: string }

  try {
    if (action === 'generate') {
      const { description, materials, docs_urls } = body
      if (!description || !String(description).trim()) {
        return Response.json({ error: 'description required' }, { status: 400 })
      }
      // Auto-fetch any links the user put in the description (plus any explicit
      // docs_urls) so pasting a doc link "just works" — no manual Fetch step.
      const urls = Array.from(new Set([
        ...extractUrls(String(description)),
        ...(Array.isArray(docs_urls) ? docs_urls.map(String) : []),
      ]))
      let fetched: FetchedDoc[] = []
      let fetchedText = ''
      if (urls.length) {
        const g = await gatherMaterials(urls)
        fetched = g.fetched
        fetchedText = g.text
      }
      const combined = [materials ? String(materials) : '', fetchedText].filter(Boolean).join('\n\n')
      const r = await generateApiCandidate(String(description), combined || undefined)
      if (!r.ok) return Response.json({ error: r.reason, fetched }, { status: 502 })
      return Response.json({ ok: true, candidate: r.candidate, fetched })
    }

    if (action === 'agent_build') {
      // Agentic path: the model investigates the API itself (discover spec, log
      // in and read the real token path, probe), returning a working candidate
      // + a transcript. Credentials are injected server-side.
      const { description, materials, credentials } = body
      if (!description || !String(description).trim()) {
        return Response.json({ error: 'description required' }, { status: 400 })
      }
      // Fold any URLs in the description into materials (same as generate).
      const urls = extractUrls(String(description))
      let fetchedText = ''; let fetched: FetchedDoc[] = []
      if (urls.length) { const g = await gatherMaterials(urls); fetchedText = g.text; fetched = g.fetched }
      const combined = [materials ? String(materials) : '', fetchedText].filter(Boolean).join('\n\n')
      const creds = (credentials && typeof credentials === 'object') ? credentials as Record<string, string> : undefined
      const r = await runApiAgent({ description: String(description), materials: combined || undefined, credentials: creds })
      return Response.json({ ok: r.ok, candidate: r.candidate, transcript: r.transcript, probe: r.probe, reason: r.reason, fetched })
    }

    if (action === 'refine') {
      const { previousCandidate, probeStatus, probeBody, probeError, userNote } = body
      if (!previousCandidate) return Response.json({ error: 'previousCandidate required' }, { status: 400 })
      const r = await refineApiCandidate({
        previousCandidate,
        probeStatus: typeof probeStatus === 'number' ? probeStatus : undefined,
        probeBody,
        probeError: probeError ? String(probeError) : undefined,
        userNote: userNote ? String(userNote) : undefined,
      })
      if (!r.ok) return Response.json({ error: r.reason }, { status: 502 })
      return Response.json({ ok: true, candidate: r.candidate })
    }

    if (action === 'fetch_docs') {
      // Manually pull one docs URL's text (e.g. https://docs.host.com/llms.txt).
      // Public web only -> strict SSRF, redirects followed, HTML reduced to text.
      const url = String(body.url || '')
      if (!url) return Response.json({ error: 'url required' }, { status: 400 })
      const r = await fetchUrlText(url)
      if (!r.ok) return Response.json({ error: (r as { ok: false; error: string }).error }, { status: 502 })
      return Response.json({ ok: true, text: (r as { ok: true; text: string }).text })
    }

    if (action === 'diagnose') {
      // Troubleshoot a misbehaving connection. Either a saved service (service_id,
      // config + decrypted secrets loaded here) or an inline draft candidate.
      const { service_id, service, connections, symptom, history, mode } = body
      if (!symptom || !String(symptom).trim()) return Response.json({ error: 'symptom required' }, { status: 400 })
      let svc: Record<string, unknown> | undefined = service
      let conns: Array<Record<string, unknown>> = Array.isArray(connections) ? connections : []
      if (service_id) {
        const cfg = await getServiceConfigById(String(service_id))
        if (!cfg) return Response.json({ error: 'Connection not found' }, { status: 404 })
        svc = cfg.service as unknown as Record<string, unknown>
        conns = cfg.connections as unknown as Array<Record<string, unknown>>
      }
      if (!svc) return Response.json({ error: 'service or service_id required' }, { status: 400 })
      const r = await diagnoseApiConnection({ service: svc, connections: conns, symptom: String(symptom), history: Array.isArray(history) ? history : undefined, mode: mode === 'assist' ? 'assist' : 'diagnose' })
      return Response.json({ ok: r.ok, diagnosis: r.diagnosis, candidate: r.candidate, transcript: r.transcript, probe: r.probe, reason: r.reason, service_id: service_id || null })
    }

    if (action === 'apply_fix') {
      // Apply a diagnosis-proposed config fix to a SAVED service. Stored secrets
      // are re-attached server-side (the candidate carries structural auth only),
      // then the whole source is re-published through the shared upsert.
      const { service_id, candidate } = body as { service_id?: string; candidate?: { service?: Record<string, unknown>; connections?: Array<Record<string, unknown>> } }
      if (!service_id) return Response.json({ error: 'service_id required' }, { status: 400 })
      if (!candidate || !candidate.service) return Response.json({ error: 'candidate.service required' }, { status: 400 })
      const existing = await getServiceConfigById(String(service_id))
      if (!existing) return Response.json({ error: 'Connection not found' }, { status: 404 })
      const mergedAuth = mergeStoredSecrets(candidate.service.auth_config as Record<string, unknown>, existing.service.auth_config)
      const svc: ApiServiceConfig = { ...(candidate.service as ApiServiceConfig), auth_config: mergedAuth }
      const r = await upsertApiSource({ id: String(service_id), service: svc, connections: candidate.connections || [], status: 'published' })
      await audit(req, { id: session.id, email: session.email, role: session.role }, AUDIT.CONNECTION_UPDATE, `api_service:${service_id}`, 'success', { via: 'ai_diagnose', base_url: svc.base_url, connections: (candidate.connections || []).length })
      return Response.json({ ok: true, id: r.id })
    }

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
