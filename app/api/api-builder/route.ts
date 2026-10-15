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
import { runApiAgent, diagnoseApiConnection } from '@/lib/ai/api-agent'
import { getServiceConfigById } from '@/lib/api-source-store'
import { runCandidateProbe, classifyProbe } from '@/lib/api-probe'
import { discoverEndpoints } from '@/lib/api-discover'
import { mapLimit } from '@/lib/concurrency'
import type { AuthConfig } from '@/lib/api-auth'
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

    if (action === 'validate_endpoints') {
      // Probe every registered endpoint group with a cheap GET and report which
      // actually return data — separating "connected" (auth works) from "serves
      // data" (a real, reachable collection). Accepts an inline draft (service +
      // connections, secrets inline like the diagnose action) or a saved
      // service_id (config + secrets loaded here). One shared cacheKey means a
      // session_token login happens once and is reused across all probes
      // (single-flight), so validating 40 endpoints doesn't stampede the login.
      const { service_id, service, connections } = body
      let svc: Record<string, unknown> | undefined = service
      let conns: Array<Record<string, unknown>> = Array.isArray(connections) ? connections : []
      if (service_id) {
        const cfg = await getServiceConfigById(String(service_id))
        if (!cfg) return Response.json({ error: 'Connection not found' }, { status: 404 })
        svc = cfg.service as unknown as Record<string, unknown>
        conns = cfg.connections as unknown as Array<Record<string, unknown>>
      }
      if (!svc || !svc.base_url) return Response.json({ error: 'service or service_id required' }, { status: 400 })
      if (!conns.length) return Response.json({ ok: true, results: [], summary: { total: 0, data: 0, empty: 0, dead: 0, auth: 0, error: 0 } })
      const cacheKey = `validate:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`
      const authConfig = (svc.auth_config || {}) as unknown as AuthConfig
      const results = await mapLimit(conns, 6, async (c, i) => {
        const out = await runCandidateProbe({
          cacheKey,
          baseUrl: String(svc!.base_url),
          basePath: String(c.base_path || ''),
          authType: String(svc!.auth_type || ''),
          authConfig,
          defaultHeaders: (svc!.default_headers as Record<string, string>) || {},
          apiVersion: svc!.api_version ? String(svc!.api_version) : undefined,
          versionHeader: svc!.version_header ? String(svc!.version_header) : undefined,
          method: 'GET', path: '/', ssrf: 'lan', timeoutMs: 12000,
        })
        const cl = classifyProbe(out)
        return { index: i, label: (c.label as string) || `Endpoint ${i + 1}`, base_path: String(c.base_path || ''), status: out.status, url: out.url, ...cl }
      })
      const summary: Record<string, number> = { total: results.length, data: 0, empty: 0, dead: 0, auth: 0, error: 0 }
      for (const r of results) summary[r.cls] = (summary[r.cls] || 0) + 1
      return Response.json({ ok: true, results, summary })
    }

    if (action === 'discover_endpoints') {
      // Enumerate real endpoint collections for a service that under-covers the
      // API (e.g. only 1 endpoint saved). Multi-source: OpenAPI spec first, then
      // the server's route map. Each discovered collection is then validated with
      // a live probe so we only propose ones that actually return data — the
      // non-/api routes and param-only routes fall out here (they 404 under base).
      const { service_id, service } = body
      let svc: Record<string, unknown> | undefined = service
      if (service_id) {
        const cfg = await getServiceConfigById(String(service_id))
        if (!cfg) return Response.json({ error: 'Connection not found' }, { status: 404 })
        svc = cfg.service as unknown as Record<string, unknown>
      }
      if (!svc || !svc.base_url) return Response.json({ error: 'service or service_id required' }, { status: 400 })
      const cacheKey = `discover:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`
      const authConfig = (svc.auth_config || {}) as unknown as AuthConfig
      const disc = await discoverEndpoints({
        cacheKey, baseUrl: String(svc.base_url), authType: String(svc.auth_type || ''),
        authConfig, defaultHeaders: (svc.default_headers as Record<string, string>) || {},
      })
      const candidates = disc.collections.slice(0, 120)
      const validated = await mapLimit(candidates, 8, async (c) => {
        const out = await runCandidateProbe({
          cacheKey, baseUrl: String(svc!.base_url), basePath: c.path,
          authType: String(svc!.auth_type || ''), authConfig,
          defaultHeaders: (svc!.default_headers as Record<string, string>) || {},
          apiVersion: svc!.api_version ? String(svc!.api_version) : undefined,
          versionHeader: svc!.version_header ? String(svc!.version_header) : undefined,
          method: 'GET', path: '/', ssrf: 'lan', timeoutMs: 8000,
        })
        const cl = classifyProbe(out)
        return { path: c.path, label: c.label, status: out.status, ...cl }
      })
      // Propose the reachable data endpoints (data + reachable-but-empty); the
      // dead/auth/error ones are returned too so the UI can show what was skipped.
      const proposed = validated.filter(v => v.cls === 'data' || v.cls === 'empty')
      const summary: Record<string, number> = { scanned: disc.collections.length, probed: validated.length, data: 0, empty: 0, dead: 0, auth: 0, error: 0 }
      for (const v of validated) summary[v.cls] = (summary[v.cls] || 0) + 1
      return Response.json({ ok: true, source: disc.source, note: disc.note, proposed, all: validated, summary })
    }

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
