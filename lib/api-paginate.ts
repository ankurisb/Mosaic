// Follow an API's pagination so a dashboard panel sees more than the first page.
//
// RESPONSE-DRIVEN first: most well-behaved APIs describe their own paging in the
// response — OData `@odata.nextLink`, a cursor/next token, or a page/offset envelope
// ({pagination:{page,total_pages}}, {meta:{total,page_size}}, …). We detect that from
// the body and follow it, so NO per-connection config is needed and it works for any
// such API, not just one vendor. For "dumb" APIs that return bare arrays with no
// metadata, we fall back to the connection's stored pagination_style.
//
// The page-fetcher is injected, so this module is pure and unit-testable.

import { extractRows as extractByPath } from './condition-eval'
import { extractApiRecords } from './api-dictionary'

export interface PageConfig {
  style?: string | null          // fallback only: none|odata|offset|page|cursor
  limitParam?: string | null
  cursorParam?: string | null
  dataPath?: string | null
}

const PAGE_SIZE = 500
const MAX_PAGES = 50

// Extract one page's records: the configured data path if set (exact), else the
// richer envelope auto-detect used elsewhere for dashboards.
export function extractPage(data: unknown, dataPath?: string | null): Record<string, unknown>[] {
  if (dataPath) return extractByPath(data, dataPath)
  return extractApiRecords(data)
}

// Set/replace query params on a path string, preserving the rest of the query.
export function withParams(path: string, params: Record<string, string>): string {
  const qi = path.indexOf('?')
  const head = qi === -1 ? path : path.slice(0, qi)
  const sp = new URLSearchParams(qi === -1 ? '' : path.slice(qi + 1))
  for (const [k, v] of Object.entries(params)) sp.set(k, v)
  const qs = sp.toString()
  return qs ? `${head}?${qs}` : head
}

// Strip scheme+host from an absolute URL so it can be re-fetched through the same
// authenticated connection (call_api prepends the base). Relative URLs pass through.
function relativize(u: string): string {
  const m = u.match(/^https?:\/\/[^/]+(\/.*)$/i)
  return m ? m[1] : (u.startsWith('/') || u.startsWith('?') ? u : '/' + u)
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && isFinite(Number(v))) return Number(v)
  return null
}

const NEXT_URL_KEYS = ['next', 'nextLink', 'next_url', 'nextPage', 'next_page']
const NEXT_TOKEN_KEYS = ['next_cursor', 'nextCursor', 'nextPageToken', 'continuationToken', 'cursor']
const PAGE_KEYS = ['page', 'current_page', 'currentPage', 'pageNumber', 'page_number']
const TOTAL_PAGE_KEYS = ['total_pages', 'totalPages', 'pages', 'page_count', 'pageCount', 'last_page']
const TOTAL_KEYS = ['total', 'total_records', 'totalRecords', 'total_count', 'totalCount', 'count']
const SIZE_KEYS = ['page_size', 'pageSize', 'per_page', 'perPage', 'limit', 'size']

function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) if (k in obj && obj[k] != null) return obj[k]
  return undefined
}

export type NextStep =
  | { kind: 'next'; path: string }  // follow this path
  | { kind: 'stop' }                // pagination understood, no more pages
  | { kind: 'unknown' }             // no pagination metadata found

// Decide the next request from a response body. rowsSoFar is the count accumulated
// before this page is counted toward offset maths.
export function detectNext(data: unknown, basePath: string, cfg: PageConfig, rowsSoFar: number): NextStep {
  if (!data || typeof data !== 'object') return { kind: 'unknown' }
  const top = data as Record<string, unknown>
  const limitParam = cfg.limitParam || 'limit'
  const cursorParam = cfg.cursorParam || 'cursor'

  // 1. OData.
  const odata = top['@odata.nextLink']
  if (typeof odata === 'string' && odata) return { kind: 'next', path: relativize(odata) }

  // 2. Look in the body and its common paging containers.
  const containers: Record<string, unknown>[] = [top]
  for (const w of ['pagination', 'meta', 'paging', 'page_info', 'pageInfo', '_meta']) {
    if (top[w] && typeof top[w] === 'object') containers.push(top[w] as Record<string, unknown>)
  }
  for (const c of containers) {
    // 2a. Explicit next URL (absolute or relative).
    const nextUrl = pick(c, NEXT_URL_KEYS)
    if (typeof nextUrl === 'string' && nextUrl) {
      return { kind: 'next', path: relativize(nextUrl) }
    }
    // 2b. Cursor token (not a URL).
    const token = pick(c, NEXT_TOKEN_KEYS)
    if (typeof token === 'string' && token) {
      return { kind: 'next', path: withParams(basePath, { [cursorParam]: token }) }
    }
    // 2c. page / total_pages.
    const page = num(pick(c, PAGE_KEYS))
    const totalPages = num(pick(c, TOTAL_PAGE_KEYS))
    if (page != null && totalPages != null) {
      return page < totalPages
        ? { kind: 'next', path: withParams(basePath, { page: String(page + 1) }) }
        : { kind: 'stop' }
    }
    // 2d. total (records) + offset maths.
    const total = num(pick(c, TOTAL_KEYS))
    if (total != null) {
      if (rowsSoFar < total) {
        const size = num(pick(c, SIZE_KEYS)) || PAGE_SIZE
        return { kind: 'next', path: withParams(basePath, { [limitParam]: String(size), offset: String(rowsSoFar) }) }
      }
      return { kind: 'stop' }
    }
    // 2e. has_more / hasMore boolean.
    const more = c['has_more'] ?? c['hasMore'] ?? c['more']
    if (typeof more === 'boolean') {
      if (!more) return { kind: 'stop' }
      // more:true but no token/page — best we can do is offset.
      return { kind: 'next', path: withParams(basePath, { [limitParam]: String(PAGE_SIZE), offset: String(rowsSoFar) }) }
    }
  }
  return { kind: 'unknown' }
}

// Config-based stepping for APIs that return NO paging metadata (fallback only).
function configNext(style: string, basePath: string, cfg: PageConfig, pageIndex: number, lastCount: number): NextStep {
  const limitParam = cfg.limitParam || 'limit'
  if (lastCount < PAGE_SIZE) return { kind: 'stop' }  // short page = end
  if (style === 'odata') return { kind: 'next', path: withParams(basePath, { $top: String(PAGE_SIZE), $skip: String((pageIndex + 1) * PAGE_SIZE) }) }
  if (style === 'offset') return { kind: 'next', path: withParams(basePath, { [limitParam]: String(PAGE_SIZE), offset: String((pageIndex + 1) * PAGE_SIZE) }) }
  if (style === 'page') return { kind: 'next', path: withParams(basePath, { [limitParam]: String(PAGE_SIZE), page: String(pageIndex + 2) }) }
  return { kind: 'stop' }
}

export interface PageResult { rows: Record<string, unknown>[]; source_capped: boolean; pages: number }

export async function fetchApiRows(
  callOnePage: (path: string) => Promise<unknown>,
  basePath: string,
  cfg: PageConfig,
  maxRows: number,
): Promise<PageResult> {
  const style = (cfg.style || 'none').toLowerCase()
  const checkErr = (d: unknown) => {
    if (d && typeof d === 'object' && 'error' in (d as Record<string, unknown>)) {
      throw new Error(String((d as Record<string, unknown>).error))
    }
  }

  const rows: Record<string, unknown>[] = []
  let path = basePath
  let usedResponseDriven = false
  for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex++) {
    const data = await callOnePage(path)
    checkErr(data)
    const pageRows = extractPage(data, cfg.dataPath)
    rows.push(...pageRows)
    if (rows.length >= maxRows) return { rows: rows.slice(0, maxRows), source_capped: true, pages: pageIndex + 1 }

    // Response-driven first.
    const step = detectNext(data, basePath, cfg, rows.length)
    if (step.kind === 'next') { usedResponseDriven = true; path = step.path; continue }
    if (step.kind === 'stop') return { rows, source_capped: false, pages: pageIndex + 1 }

    // Unknown: on the first page, fall back to the stored style (if any). Once we've
    // been following response-driven links, an unknown just means we're done.
    if (usedResponseDriven || style === 'none') return { rows, source_capped: false, pages: pageIndex + 1 }
    const cstep = configNext(style, basePath, cfg, pageIndex, pageRows.length)
    if (cstep.kind === 'next') { path = cstep.path; continue }
    return { rows, source_capped: false, pages: pageIndex + 1 }
  }
  return { rows, source_capped: true, pages: MAX_PAGES }
}
