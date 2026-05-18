import { getSession } from '@/lib/auth'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
export const runtime = 'nodejs'

const LOG_FILE = join(process.cwd(), 'logs', 'server.log')
const LEVEL_MAP: Record<number, string> = { 10: 'trace', 20: 'debug', 30: 'info', 40: 'warn', 50: 'error', 60: 'fatal' }

export interface LogEntry {
  time: string
  level: string
  service: string
  msg: string
  err?: string
  [key: string]: unknown
}

// since values → milliseconds (0 = all time)
const SINCE_MS: Record<string, number> = {
  '15m':  15 * 60 * 1000,
  '1h':   60 * 60 * 1000,
  '6h':   6  * 60 * 60 * 1000,
  '24h':  24 * 60 * 60 * 1000,
  'all':  0,
}

export async function GET(req: Request) {
  const session = await getSession()
  if (!session || session.role !== 'admin')
    return Response.json({ error: 'Admin only' }, { status: 403 })

  const url     = new URL(req.url)
  const lines   = Math.min(parseInt(url.searchParams.get('lines') || '200'), 500)
  const level   = url.searchParams.get('level')   || 'all'
  const service = url.searchParams.get('service') || 'all'
  const since   = url.searchParams.get('since')   || 'all'

  if (!existsSync(LOG_FILE)) {
    return Response.json({ entries: [], total: 0, note: 'Log file not yet created — restart the server to begin logging' })
  }

  let raw: string
  try {
    const content = readFileSync(LOG_FILE, 'utf8')
    const allLines = content.split('\n').filter(Boolean)
    // Read enough lines to satisfy the request after filtering
    raw = allLines.slice(-lines * 5).join('\n')
  } catch {
    return Response.json({ error: 'Could not read log file' }, { status: 500 })
  }

  const sinceMs = SINCE_MS[since] ?? 0
  const cutoff  = sinceMs > 0 ? Date.now() - sinceMs : 0

  const entries: LogEntry[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line)
      const entryTime = parsed.time ?? 0

      // Time filter
      if (cutoff > 0 && entryTime < cutoff) continue

      const entry: LogEntry = {
        time:    new Date(entryTime).toISOString(),
        level:   LEVEL_MAP[parsed.level] || 'info',
        service: parsed.service || 'app',
        msg:     parsed.msg || '',
        ...(parsed.err  ? { err: String(parsed.err) } : {}),
        ...(parsed.data ? { data: parsed.data }        : {}),
      }

      // Level filter
      if (level === 'warn'  && !['warn','error','fatal'].includes(entry.level)) continue
      if (level === 'error' && !['error','fatal'].includes(entry.level)) continue

      // Service filter
      if (service !== 'all' && entry.service !== service) continue

      entries.push(entry)
    } catch { /* skip non-JSON lines */ }
  }

  // Cap at requested line count (newest entries)
  const trimmed = entries.slice(-lines)

  // Collect unique services across all matching entries for the dropdown
  const services = [...new Set(entries.map(e => e.service))].sort()

  return Response.json({ entries: trimmed, total: trimmed.length, services })
}
