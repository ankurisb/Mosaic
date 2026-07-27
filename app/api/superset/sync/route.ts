// app/api/superset/sync/route.ts
// Backfill + status for Superset database registration.
//
// The auto-sync in lib/superset-sync.ts only fires when a NEW connection is
// created. Connections created before Superset was configured (or that failed
// to sync silently) never got registered, and there was no way to see or fix
// that. This endpoint closes both gaps:
//   GET  -> which SQL connections are synced to Superset, which aren't
//   POST -> (re)sync all eligible connections, or one by id, using decrypted
//           credentials. Idempotent — already-registered ones report "updated".
import { getSession } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { decrypt } from '@/lib/encrypt'
import { syncToSuperset, type SyncResult } from '@/lib/superset-sync'

export const runtime = 'nodejs'

const SQL_DIALECTS = new Set(['postgres', 'mysql', 'mssql', 'clickhouse'])

interface ConnRow {
  id: string; label: string; dialect: string
  host: string | null; port: number | null; database_name: string | null
  username: string | null; password_enc: string | null; connection_string: string | null
  ssl_mode: string | null; schema_name: string | null
}

function safeDecrypt(v: string): string | undefined {
  try { return decrypt(v) } catch { return undefined }
}

function toParams(c: ConnRow) {
  return {
    id: c.id,
    label: c.label,
    dialect: c.dialect,
    host: c.host ?? undefined,
    port: c.port ?? undefined,
    database_name: c.database_name ?? undefined,
    username: c.username ?? undefined,
    // Decrypt only here, at sync time — never store or return plaintext.
    password: c.password_enc ? safeDecrypt(c.password_enc) : undefined,
    connection_string: c.connection_string ? safeDecrypt(c.connection_string) : undefined,
    ssl_mode: c.ssl_mode ?? undefined,
    schema_name: c.schema_name ?? undefined,
  }
}

export async function GET() {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  if (session.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 })

  const sql = getDb()
  const rows = await sql`SELECT id, label, dialect FROM db_connections` as unknown as { id: string; label: string; dialect: string }[]
  const eligible = rows.filter(r => SQL_DIALECTS.has(r.dialect))
  const ineligible = rows.filter(r => !SQL_DIALECTS.has(r.dialect))
    .map(r => ({ label: r.label, dialect: r.dialect }))

  return Response.json({
    eligible: eligible.map(r => ({ id: r.id, label: r.label, dialect: r.dialect })),
    ineligible, // API/file/NoSQL — can't be dashboarded in Superset
    note: 'POST here to (re)register eligible SQL connections in Superset.',
  })
}

export async function POST(req: Request) {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  if (session.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const onlyId: string | undefined = body?.id

  const sql = getDb()
  const rows = (onlyId
    ? await sql`SELECT * FROM db_connections WHERE id = ${onlyId}`
    : await sql`SELECT * FROM db_connections`) as unknown as ConnRow[]

  const results: { label: string; dialect: string; result: SyncResult }[] = []
  for (const c of rows) {
    if (!SQL_DIALECTS.has(c.dialect)) continue // skip non-SQL silently
    const result = await syncToSuperset(toParams(c))
    results.push({ label: c.label, dialect: c.dialect, result })
  }

  const registered = results.filter(r => r.result.status === 'registered' || r.result.status === 'updated').length
  const failed = results.filter(r => r.result.status === 'failed')

  return Response.json({
    ok: failed.length === 0,
    summary: { total: results.length, registered, failed: failed.length },
    results,
  })
}
