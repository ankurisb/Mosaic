// lib/doc-fetch.ts
// Fetch public documentation referenced by URL so the AI API builder can read
// links the user pastes (instead of making them copy/paste content). Strict
// SSRF (public web only), redirect-following, HTML-reduced-to-text, and a
// one-level llms.txt index expansion so a docs index yields the actual pages.
import { assertUrlSafe } from '@/lib/ssrf-guard'

const FETCH_MAX_BYTES = 2 * 1024 * 1024
const FETCH_MAX_TEXT = 200_000
const MATERIALS_BUDGET = 120_000

/** Extract up to `cap` distinct http(s) URLs from free text. */
export function extractUrls(text: string, cap = 8): string[] {
  const re = /https?:\/\/[^\s<>"')\]]+/gi
  const seen = new Set<string>(); const out: string[] = []
  for (const m of text.matchAll(re)) {
    const u = m[0].replace(/[.,;:]+$/, '') // trailing sentence punctuation
    if (!seen.has(u)) { seen.add(u); out.push(u) }
    if (out.length >= cap) break
  }
  return out
}

/** Crude HTML -> text so server-rendered doc pages yield usable content. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

export type UrlTextResult = { ok: true; text: string } | { ok: false; error: string }

export interface FetchTextOpts { hops?: number; maxBytes?: number; maxText?: number }

/**
 * Fetch one URL as text, SSRF-guarded (strict), following up to `hops` redirects.
 * Defaults cap at 2MB / 200k chars (good for docs); callers fetching a spec to
 * PARSE pass larger caps so a big OpenAPI JSON isn't truncated mid-document.
 */
export async function fetchUrlText(rawUrl: string, opts: FetchTextOpts = {}): Promise<UrlTextResult> {
  const hops = opts.hops ?? 2
  const maxBytes = opts.maxBytes ?? FETCH_MAX_BYTES
  const maxText = opts.maxText ?? FETCH_MAX_TEXT
  let url = rawUrl
  for (let i = 0; i <= hops; i++) {
    try { new URL(url) } catch { return { ok: false, error: 'invalid URL' } }
    const safe = await assertUrlSafe(url, 'strict')
    if (!safe.ok) return { ok: false, error: safe.reason || 'blocked' }
    let res: Response
    try {
      res = await fetch(url, {
        headers: { Accept: 'text/plain, text/markdown, application/json, text/yaml, text/html;q=0.8, */*;q=0.5' },
        signal: AbortSignal.timeout(10000),
        redirect: 'manual',
      })
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'fetch failed' } }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc || i === hops) return { ok: false, error: 'too many redirects' }
      url = new URL(loc, url).toString()
      continue
    }
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    const reader = res.body?.getReader()
    if (!reader) return { ok: false, error: 'empty response' }
    const chunks: Uint8Array[] = []; let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) { chunks.push(value); total += value.length; if (total > maxBytes) break }
    }
    const contentType = res.headers.get('content-type') || ''
    let text = Buffer.concat(chunks).toString('utf8')
    if (/html/i.test(contentType) || /^\s*<!doctype html|^\s*<html/i.test(text)) text = htmlToText(text)
    return { ok: true, text: text.slice(0, maxText) }
  }
  return { ok: false, error: 'too many redirects' }
}

export interface FetchedDoc { url: string; ok: boolean; bytes?: number; note?: string }

/**
 * Fetch each URL and concatenate the text as model material. If a fetched page
 * is an llms.txt index, expand it once to a few of its listed same-host pages
 * so the model gets the actual endpoint reference, not just the index. Bounded
 * by count and a total character budget.
 */
export async function gatherMaterials(urls: string[]): Promise<{ text: string; fetched: FetchedDoc[] }> {
  const fetched: FetchedDoc[] = []
  const blocks: string[] = []
  const queue = [...urls]
  const done = new Set<string>()
  let budget = MATERIALS_BUDGET
  let expanded = false
  while (queue.length && budget > 0) {
    const u = queue.shift() as string
    if (done.has(u)) continue
    done.add(u)
    const r = await fetchUrlText(u)
    if (!r.ok) { fetched.push({ url: u, ok: false, note: (r as { ok: false; error: string }).error }); continue }
    const slice = r.text.slice(0, budget)
    blocks.push(`===== ${u} =====\n${slice}`)
    budget -= slice.length
    fetched.push({ url: u, ok: true, bytes: slice.length })
    if (!expanded && /llms\.txt$/i.test(u)) {
      let host = ''
      try { host = new URL(u).host } catch {}
      const links = extractUrls(r.text, 20).filter(l => {
        try { return new URL(l).host === host && !done.has(l) } catch { return false }
      })
      for (const l of links.slice(0, 6)) queue.push(l)
      if (links.length) expanded = true
    }
  }
  return { text: blocks.join('\n\n'), fetched }
}
