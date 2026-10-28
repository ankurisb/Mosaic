// app/api/agents/runs — centralised fleet run log + headline stats.
import { getSession } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { setupDatabase } from '@/lib/setup'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  await setupDatabase().catch(() => {})
  const sql = getDb()
  const url = new URL(req.url)
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50))
  const runs = await sql`SELECT r.id, r.agent_id, a.name AS agent_name, r.status, r.trigger_source, r.cost_usd, r.stop_reason, r.result, r.started_at, r.ended_at
    FROM agent_runs r LEFT JOIN agents a ON a.id = r.agent_id
    ORDER BY r.started_at DESC LIMIT ${limit}`.catch(() => [])
  const agg = await sql`SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status='succeeded' THEN 1 ELSE 0 END) AS succeeded,
      SUM(CASE WHEN status='paused_for_approval' THEN 1 ELSE 0 END) AS pending,
      COALESCE(SUM(cost_usd),0) AS spend
    FROM agent_runs`.catch(() => [{ total: 0, succeeded: 0, pending: 0, spend: 0 }])
  const a = (agg as Record<string, unknown>[])[0] || {}
  const total = Number(a.total || 0), succeeded = Number(a.succeeded || 0)
  return Response.json({
    runs,
    stats: {
      total,
      success_rate: total ? Math.round((succeeded / total) * 100) : null,
      pending_approval: Number(a.pending || 0),
      spend_usd: Number(a.spend || 0),
    },
  })
}
