// Follow an API connection's pagination so a dashboard API panel sees more than the
// first page. Styles come from the connection config (api_connections.pagination_*).
// The page-fetcher is injected, so this is pure and unit-testable (no DB/network).
//
// Supported styles: 'none' (one call), 'odata' ($top/$skip), 'offset' (<limit>/offset),
// 'page' (<limit>/page, 1-based). 'cursor' is best-effort (follows a common next-cursor
// key) since the cursor location isn't configured. Stops at maxRows, at a short page,
// or at a hard page cap — and reports source_capped when it stopped with more to fetch.

import { extractRows as extractByPath } from './condition-eval'
import { extractApiRecords } from './api-dictionary'

export interface PageConfig {
  style?: string | null
  limitParam?: string | null
  cursorParam?: string | null
  dataPath?: string | null
}

const PAGE_SIZE = 500
const MAX_PAGES = 40
const COMMON_NEXT_KEYS = ['next_cursor', 'nextCursor', 'next', 'nextPageToken', 'continuationToken']

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

// Dig a likely next-cursor value out of a response for best-effort cursor paging.
function findNextCursor(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const obj = data as Record<string, unknown>
  for (const k of COMMON_NEXT_KEYS) {
    const v = obj[k]
    if (typeof v === 'string' && v) return v
    if (v && typeof v === 'object') { const inner = findNextCursor(v); if (inner) return inner }
  }
  // Common nested spot: { paging: { next: "..." } } / { meta: { next_cursor } }
  for (const wrap of ['paging', 'meta', 'pagination', 'page_info']) {
    if (obj[wrap] && typeof obj[wrap] === 'object') { const inner = findNextCursor(obj[wrap]); if (inner) return inner }
  }
  return null
}

export interface PageResult { rows: Record<string, unknown>[]; source_capped: boolean; pages: number }

export async function fetchApiRows(
  callOnePage: (path: string) => Promise<unknown>,
  basePath: string,
  cfg: PageConfig,
  maxRows: number,
): Promise<PageResult> {
  const style = (cfg.style || 'none').toLowerCase()
  const limitParam = cfg.limitParam || 'limit'
  const cursorParam = cfg.cursorParam || 'cursor'
  const checkErr = (d: unknown) => {
    if (d && typeof d === 'object' && 'error' in (d as Record<string, unknown>)) {
      throw new Error(String((d as Record<string, unknown>).error))
    }
  }

  // Single page (default): no pagination configured.
  if (style === 'none') {
    const data = await callOnePage(basePath)
    checkErr(data)
    const rows = extractPage(data, cfg.dataPath)
    const capped = rows.length > maxRows
    return { rows: capped ? rows.slice(0, maxRows) : rows, source_capped: capped, pages: 1 }
  }

  const rows: Record<string, unknown>[] = []
  let page = 0
  let cursor: string | null = null
  for (; page < MAX_PAGES; page++) {
    let pagePath = basePath
    if (style === 'odata') {
      pagePath = withParams(basePath, { $top: String(PAGE_SIZE), $skip: String(page * PAGE_SIZE) })
    } else if (style === 'offset') {
      pagePath = withParams(basePath, { [limitParam]: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) })
    } else if (style === 'page') {
      pagePath = withParams(basePath, { [limitParam]: String(PAGE_SIZE), page: String(page + 1) })
    } else if (style === 'cursor') {
      pagePath = cursor
        ? withParams(basePath, { [limitParam]: String(PAGE_SIZE), [cursorParam]: cursor })
        : withParams(basePath, { [limitParam]: String(PAGE_SIZE) })
    }
    const data = await callOnePage(pagePath)
    checkErr(data)
    const pageRows = extractPage(data, cfg.dataPath)
    rows.push(...pageRows)

    if (rows.length >= maxRows) return { rows: rows.slice(0, maxRows), source_capped: true, pages: page + 1 }
    if (style === 'cursor') {
      cursor = findNextCursor(data)
      if (!cursor) return { rows, source_capped: false, pages: page + 1 }
    } else {
      // Offset/page/odata: a short page means we've reached the end.
      if (pageRows.length < PAGE_SIZE) return { rows, source_capped: false, pages: page + 1 }
    }
  }
  // Hit the hard page cap with pages still coming.
  return { rows, source_capped: true, pages: MAX_PAGES }
}
