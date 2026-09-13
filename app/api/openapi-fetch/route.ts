import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { assertUrlSafe } from '@/lib/ssrf-guard'

// Fetches an OpenAPI/Swagger spec from a URL so the API-connector wizard can import it.
// SECURITY: this makes the SERVER fetch an arbitrary URL, so it MUST be (1) authenticated
// — it's an admin config-time action, not a public proxy — and (2) SSRF-guarded, or it
// becomes an open server-side request-forgery vector (internal APIs, cloud metadata).
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 })

  const url = req.nextUrl.searchParams.get('url')
  if (!url) return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 })

  try { new URL(url) } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
  }

  const safe = await assertUrlSafe(url)
  if (!safe.ok) return NextResponse.json({ error: `Blocked: ${safe.reason}` }, { status: 400 })

  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json, application/yaml, text/yaml, */*' },
      signal: AbortSignal.timeout(10000),
      redirect: 'manual', // don't auto-follow redirects (a redirect could bypass the SSRF check)
    })
    if (res.status >= 300 && res.status < 400) {
      return NextResponse.json({ error: 'Upstream redirected; provide the final spec URL directly.' }, { status: 400 })
    }
    if (!res.ok) return NextResponse.json({ error: `Upstream returned ${res.status}` }, { status: 502 })
    // Cap the response so a hostile/huge upstream can't exhaust memory.
    const reader = res.body?.getReader()
    if (!reader) return NextResponse.json({ error: 'Empty response' }, { status: 502 })
    const chunks: Uint8Array[] = []; let total = 0; const MAX = 5 * 1024 * 1024
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) { total += value.length; if (total > MAX) { try { await reader.cancel() } catch {} ; return NextResponse.json({ error: 'Spec too large (>5MB)' }, { status: 413 }) } chunks.push(value) }
    }
    const text = Buffer.concat(chunks.map(c => Buffer.from(c))).toString('utf8')
    return new NextResponse(text, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  } catch (e) {
    return NextResponse.json({ error: (e instanceof Error ? e.message : 'Fetch failed') }, { status: 502 })
  }
}
