import { getSession } from '@/lib/auth'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
export const runtime = 'nodejs'

const LOG_FILE = join(process.cwd(), 'logs', 'server.log')
const LEVEL_MAP: Record<number, string> = { 10: 'trace', 20: 'debug', 30: 'info', 40: 'warn', 50: 'error', 60: 'fatal' }

export interface LogEntry {
  time: string       // ISO timestamp
  level: string      // info | warn | error | fatal
  service: string
  msg: string
  err?: string
  [key: string]: unknown
}

export async function GET(req: Request) {
  const session = await getSession()
  if (!session || session.role !== 'admin')
    return Response.json({ error: 'Admin only' }, { status: 403 })

  const url = new URL(req.url)
  const lines  = Math.min(parseInt(url.searchParams.get('lines') || '200'), 500)
  const level  = url.searchParams.get('level') || 'all'   // all | info | warn | error
  const service = url.searchParams.get('service') || 'all'

  if (!existsSync(LOG_FILE)) {
    return Response.json({ entries: [], total: 0, note: 'Log file not yet created — restart the server to begin logging' })
  }

  // Read last N*3 bytes to get approximately `lines` entries without loading the whole file
  const BYTES_PER_LINE = 300
  let raw: string
  try {
    const content = readFileSync(LOG_FILE, 'utf8')
    const allLines = content.split('\n').filter(Boolean)
    // Take last `lines * 3` lines then filter, so we end up with at least `lines` after filter
    raw = allLines.slice(-lines * 3).join('\n')
  } catch (err) {
    return Response.json({ error: 'Could not read log file' }, { status: 500 })
  }

  const entries: LogEntry[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line)
      const entry: LogEntry = {
        time:    new Date(parsed.time).toISOString(),
        level:   LEVEL_MAP[parsed.level] || 'info',
        service: parsed.service || 'app',
        msg:     parsed.msg || '',
        ...(parsed.err  ? { err: String(parsed.err) }   : {}),
        ...(parsed.data ? { data: parsed.data }          : {}),
      }
      // Filter by level
      if (level === 'warn'  && !['warn','error','fatal'].includes(entry.level)) continue
      if (level === 'error' && !['error','fatal'].includes(entry.level)) continue
      // Filter by service
      if (service !== 'all' && entry.service !== service) continue

      entries.push(entry)
    } catch { /* skip non-JSON lines */ }
  }

  // Return most recent `lines` entries, newest last
  const trimmed = entries.slice(-lines)

  // Collect unique services for the filter dropdown
  const services = [...new Set(entries.map(e => e.service))].sort()

  return Response.json({ entries: trimmed, total: trimmed.length, services })
}
