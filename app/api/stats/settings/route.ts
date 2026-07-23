// app/api/stats/settings/route.ts
// Read/write which statistical analyses are disabled by the admin.
// The disabled list is stored PLAINTEXT (JSON array) in kv_settings under
// DISABLED_ANALYSES — matching how app/api/chat/route.ts reads it (JSON.parse of
// value_enc, no decrypt) and how SETUP_COMPLETE is stored. Enforced at execution
// in lib/tools.ts runStatisticalAnalysis, not just hidden from the prompt.
import { getSession } from '@/lib/auth'
import { getDb, nowExpr } from '@/lib/db'
import { log } from '@/lib/logger'
import { ANALYTICS_REGISTRY } from '@/lib/analytics/registry'
export const runtime = 'nodejs'

const VALID = new Set(ANALYTICS_REGISTRY.map(a => a.name))

export async function GET() {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const sql = getDb()
  let disabled: string[] = []
  try {
    const rows = await sql`SELECT value_enc FROM kv_settings WHERE key = 'DISABLED_ANALYSES'`
    if (rows.length) disabled = parseDisabled(rows[0].value_enc)
  } catch { /* absent or malformed -> empty */ }
  return Response.json({ disabled })
}

// The SQLite driver in lib/db.ts auto-parses JSON string columns (anything
// starting with [ or {) into real arrays/objects, to match Postgres. So
// value_enc may arrive already-parsed as an array OR as a raw string depending
// on driver/shape. Handle both.
function parseDisabled(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string')
  if (typeof v === 'string') {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p.filter((x: unknown): x is string => typeof x === 'string') : [] }
    catch { return [] }
  }
  return []
}

export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  if (session.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 })

  const { disabled } = await req.json()
  if (!Array.isArray(disabled)) return Response.json({ error: 'disabled must be an array' }, { status: 400 })

  // Keep only known analysis names, de-duplicated — never persist arbitrary input.
  const clean = [...new Set((disabled as unknown[]).filter(x => typeof x === 'string' && VALID.has(x as string)))]
  const value = JSON.stringify(clean)

  const sql = getDb()
  try {
    await sql`
      INSERT INTO kv_settings (key, value_enc, updated_by, updated_at)
      VALUES ('DISABLED_ANALYSES', ${value}, ${session.email}, ${nowExpr()})
      ON CONFLICT(key) DO UPDATE SET value_enc = ${value}, updated_by = ${session.email}, updated_at = ${nowExpr()}
    `
  } catch (err) {
    log.error({ service: 'stats-settings', err }, 'Failed to persist DISABLED_ANALYSES')
    return Response.json({ error: 'Failed to save' }, { status: 500 })
  }
  return Response.json({ ok: true, disabled: clean })
}
