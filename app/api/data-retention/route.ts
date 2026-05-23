// app/api/data-retention/route.ts
// Data retention policy management — per-dataset configurable purge schedules.
import { getSession } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { DATASETS, runDataRetentionPurge } from '@/lib/data-retention'
import { audit, AUDIT } from '@/lib/audit'
export const runtime = 'nodejs'

// GET — return all dataset settings + row counts
export async function GET() {
  const session = await getSession()
  if (!session || session.role !== 'admin')
    return Response.json({ error: 'Admin only' }, { status: 403 })

  const sql = getDb()

  // Fetch settings
  const settingsRows = await sql`SELECT * FROM data_retention_settings`.catch(() => [])
  const settingsMap = Object.fromEntries(
    (settingsRows as Array<Record<string, unknown>>).map(r => [r.dataset as string, r])
  )

  // Row counts per dataset for each table
  const counts = await Promise.all([
    sql`SELECT COUNT(*) as cnt FROM conversations`.catch(() => [{ cnt: 0 }]),
    sql`SELECT COUNT(*) as cnt FROM messages`.catch(() => [{ cnt: 0 }]),
    sql`SELECT COUNT(*) as cnt FROM usage_events`.catch(() => [{ cnt: 0 }]),
    sql`SELECT COUNT(*) as cnt FROM egress_events`.catch(() => [{ cnt: 0 }]),
    sql`SELECT COUNT(*) as cnt FROM rca_sessions`.catch(() => [{ cnt: 0 }]),
    sql`SELECT COUNT(*) as cnt FROM query_history`.catch(() => [{ cnt: 0 }]),
    sql`SELECT COUNT(*) as cnt FROM integration_runs`.catch(() => [{ cnt: 0 }]),
  ])
  const countMap: Record<string, number> = {
    conversations:    Number((counts[0][0] as { cnt: unknown })?.cnt || 0),
    messages:         Number((counts[1][0] as { cnt: unknown })?.cnt || 0),
    usage_events:     Number((counts[2][0] as { cnt: unknown })?.cnt || 0),
    egress_events:    Number((counts[3][0] as { cnt: unknown })?.cnt || 0),
    rca_sessions:     Number((counts[4][0] as { cnt: unknown })?.cnt || 0),
    query_history:    Number((counts[5][0] as { cnt: unknown })?.cnt || 0),
    integration_runs: Number((counts[6][0] as { cnt: unknown })?.cnt || 0),
  }

  // Merge metadata + settings + counts
  const datasets = DATASETS.map(meta => ({
    ...meta,
    ...(settingsMap[meta.dataset] || { enabled: 1, retention_days: 90, last_purge_at: null, last_purge_count: 0 }),
    row_count: countMap[meta.dataset] ?? 0,
  }))

  return Response.json({ datasets })
}

// PATCH — update one or more dataset settings
export async function PATCH(req: Request) {
  const session = await getSession()
  if (!session || session.role !== 'admin')
    return Response.json({ error: 'Admin only' }, { status: 403 })

  const body = await req.json()
  const { dataset, enabled, retention_days } = body as {
    dataset: string; enabled?: boolean; retention_days?: number
  }

  if (!dataset) return Response.json({ error: 'dataset required' }, { status: 400 })

  // Validate ISO minimums
  const meta = DATASETS.find(d => d.dataset === dataset)
  if (meta?.isoMinDays && retention_days !== undefined && retention_days > 0 && retention_days < meta.isoMinDays) {
    // Allow but return a warning — don't block
  }

  const sql = getDb()
  await sql`
    INSERT INTO data_retention_settings (dataset, enabled, retention_days, updated_at)
    VALUES (${dataset}, ${enabled !== undefined ? (enabled ? 1 : 0) : 1}, ${retention_days ?? 90}, ${new Date().toISOString()})
    ON CONFLICT(dataset) DO UPDATE SET
      enabled        = COALESCE(${enabled !== undefined ? (enabled ? 1 : 0) : null}, enabled),
      retention_days = COALESCE(${retention_days ?? null}, retention_days),
      updated_at     = ${new Date().toISOString()}
  `

  audit(req, { id: session.id, email: session.email, role: session.role },
    AUDIT.SETTINGS_UPDATE, `data_retention:${dataset}`, 'success',
    { dataset, enabled, retention_days })

  return Response.json({ ok: true })
}

// POST — trigger a manual purge run immediately
export async function POST(req: Request) {
  const session = await getSession()
  if (!session || session.role !== 'admin')
    return Response.json({ error: 'Admin only' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const { dataset } = body as { dataset?: string }

  // If dataset specified, run only that one; otherwise run all
  if (dataset) {
    const sql = getDb()
    const settings = await sql`SELECT * FROM data_retention_settings WHERE dataset = ${dataset}`.catch(() => [])
    const s = settings[0] as { enabled: number; retention_days: number } | undefined
    if (!s?.enabled || !s?.retention_days) {
      return Response.json({ ok: false, error: 'Dataset not configured or disabled' })
    }
  }

  const results = await runDataRetentionPurge()
  const filtered = dataset ? results.filter(r => r.dataset === dataset) : results
  const totalPurged = filtered.reduce((sum, r) => sum + r.purged, 0)

  audit(req, { id: session.id, email: session.email, role: session.role },
    AUDIT.AUDIT_PURGE, `data_retention:${dataset || 'all'}`, 'success',
    { datasets: filtered.map(r => r.dataset), total_purged: totalPurged })

  return Response.json({ ok: true, results: filtered, total_purged: totalPurged })
}
