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
import { extractUrls, fetchUrlText, gatherMaterials, type FetchedDoc } from '@/lib/doc-fetch'

export const runtime = 'nodejs'

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

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
