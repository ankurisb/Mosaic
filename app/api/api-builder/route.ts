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
import { assertUrlSafe } from '@/lib/ssrf-guard'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  if (session.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const { action } = body as { action?: string }

  try {
    if (action === 'generate') {
      const { description, materials } = body
      if (!description || !String(description).trim()) {
        return Response.json({ error: 'description required' }, { status: 400 })
      }
      const r = await generateApiCandidate(String(description), materials ? String(materials) : undefined)
      if (!r.ok) return Response.json({ error: r.reason }, { status: 502 })
      return Response.json({ ok: true, candidate: r.candidate })
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
      // Pull the text of a public docs URL (e.g. https://docs.host.com/llms.txt)
      // to feed the model as material. Public web only -> strict SSRF.
      const url = String(body.url || '')
      if (!url) return Response.json({ error: 'url required' }, { status: 400 })
      try { new URL(url) } catch { return Response.json({ error: 'Invalid URL' }, { status: 400 }) }
      const safe = await assertUrlSafe(url, 'strict')
      if (!safe.ok) return Response.json({ error: `Blocked: ${safe.reason}` }, { status: 400 })
      try {
        const res = await fetch(url, {
          headers: { Accept: 'text/plain, text/markdown, application/json, text/yaml, */*' },
          signal: AbortSignal.timeout(10000),
          redirect: 'manual',
        })
        if (res.status >= 300 && res.status < 400) {
          return Response.json({ error: 'Upstream redirected; provide the final URL directly.' }, { status: 400 })
        }
        if (!res.ok) return Response.json({ error: `Upstream returned ${res.status}` }, { status: 502 })
        const reader = res.body?.getReader()
        if (!reader) return Response.json({ error: 'Empty response' }, { status: 502 })
        const chunks: Uint8Array[] = []; let total = 0; const MAX = 2 * 1024 * 1024
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          if (value) { chunks.push(value); total += value.length; if (total > MAX) break }
        }
        const text = Buffer.concat(chunks).toString('utf8').slice(0, 200_000)
        return Response.json({ ok: true, text })
      } catch (e) {
        return Response.json({ error: e instanceof Error ? e.message : 'Fetch failed' }, { status: 502 })
      }
    }

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
