/**
 * fetch_url content + redirect tests (mocked network) — complements the 13 SSRF
 * guard cases. Verifies HTML→text extraction, title parsing, truncation,
 * content-type handling, HTTP errors, and redirect-to-internal blocking.
 *
 *   tsx tests/research/fetch_url.test.ts
 */
import { runTool } from '@/lib/tools'

let pass = 0, fail = 0
const ok = (n: string, c: boolean, d = '') => { console.log(`  [${c ? 'PASS' : 'FAIL'}] ${n}${d ? '  ' + d : ''}`); c ? pass++ : fail++ }
const call = (url: string) => runTool('fetch_url', { url }, { userId: 'u', userEmail: 'e', userRole: 'admin' } as never) as Promise<Record<string, unknown>>

function mockFetch(resp: { ok?: boolean; status?: number; url?: string; ct?: string; body?: string; throwMsg?: string }) {
  ;(globalThis as { fetch: unknown }).fetch = async (input: string) => {
    if (resp.throwMsg) throw new Error(resp.throwMsg)
    return {
      ok: resp.ok ?? true, status: resp.status ?? 200, url: resp.url ?? String(input),
      headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? (resp.ct ?? 'text/html; charset=utf-8') : null) },
      text: async () => resp.body ?? '',
    }
  }
}

async function main() {
  const realFetch = globalThis.fetch
  try {
    // 1. HTML → text, title, tags/scripts stripped, entities decoded
    mockFetch({ url: 'https://example.com/a', body: '<html><head><title>Hi &amp; Bye</title></head><body><script>steal()</script><style>x{}</style><h1>Head</h1><p>Para &lt;x&gt; &quot;q&quot;</p></body></html>' })
    const r1 = await call('https://example.com/a')
    ok('title parsed + entities decoded', r1.title === 'Hi & Bye', `title=${JSON.stringify(r1.title)}`)
    ok('text has visible content', String(r1.text).includes('Head') && String(r1.text).includes('Para <x>'))
    ok('scripts/styles/tags stripped', !String(r1.text).includes('steal()') && !String(r1.text).includes('<h1>') && !String(r1.text).includes('x{}'))

    // 2. Truncation at 12k
    mockFetch({ url: 'https://example.com/big', body: '<p>' + 'word '.repeat(6000) + '</p>' })
    const r2 = await call('https://example.com/big')
    ok('long page truncated to 12k with flag', String(r2.text).length === 12000 && r2.truncated === true, `len=${String(r2.text).length}`)

    // 3. Non-text content-type → no text, note
    mockFetch({ url: 'https://example.com/img', ct: 'image/png', body: 'PNGDATA' })
    const r3 = await call('https://example.com/img')
    ok('non-text content-type not parsed', r3.text === '' && typeof r3.note === 'string')

    // 4. HTTP error surfaced
    mockFetch({ url: 'https://example.com/404', ok: false, status: 404 })
    const r4 = await call('https://example.com/404')
    ok('HTTP error surfaced', /404/.test(String(r4.error)))

    // 5. Redirect landing on an internal host is blocked (even though the request URL was public)
    mockFetch({ url: 'http://superset:8088/', body: '<title>internal</title>' })
    const r5 = await call('https://example.com/redir')
    ok('redirect to internal host blocked', /disallowed/i.test(String(r5.error)))

    // 6. Network error → clean message
    mockFetch({ throwMsg: 'The operation timed out' })
    const r6 = await call('https://example.com/slow')
    ok('timeout reported cleanly', /timed out/i.test(String(r6.error)))

    // 7. SSRF guards reject before any network call is made
    ;(globalThis as { fetch: unknown }).fetch = async () => { throw new Error('should-not-be-called') }
    const blocked = [
      'http://localhost/', 'http://127.0.0.1:8080/', 'http://10.1.2.3/', 'http://192.168.1.1/',
      'http://172.20.0.5/', 'http://169.254.169.254/latest/meta-data/', 'http://superset:8088/',
      'http://mosaic-stats:8001/', 'http://printer.local/', 'file:///etc/passwd', 'gopher://x/',
      'not a url', 'http://[::1]/',
    ]
    let allBlocked = true
    for (const u of blocked) { const r = await call(u); if (!r.error) { allBlocked = false; console.log('     NOT blocked:', u) } }
    ok(`all ${blocked.length} SSRF/invalid URLs refused before fetch`, allBlocked)
  } finally {
    globalThis.fetch = realFetch
  }

  console.log(`\n${pass}/${pass + fail} passed — ${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}`)
  process.exit(fail === 0 ? 0 : 1)
}
main().catch(e => { console.error(e); process.exit(2) })
