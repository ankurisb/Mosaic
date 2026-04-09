import { getSession } from '@/lib/auth'
import { getDb } from '@/lib/db'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  const { searchParams } = new URL(req.url)
  const period = searchParams.get('period') || '7d'
  const sql = getDb()

  const days = period === '24h' ? 1 : period === '30d' ? 30 : 7
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

  // Totals
  const totals = await sql`
    SELECT COALESCE(SUM(input_tokens),0) as input_tokens,
           COALESCE(SUM(output_tokens),0) as output_tokens,
           COALESCE(SUM(cost_usd),0) as cost_usd,
           COUNT(*) as calls
    FROM usage_events WHERE created_at > ${since}
    ${session.role !== 'admin' ? sql`AND user_id=${session.id}` : sql``}`

  // Per-user breakdown (admin only)
  const byUser = session.role === 'admin' ? await sql`
    SELECT user_email, COALESCE(SUM(input_tokens),0) as input_tokens,
           COALESCE(SUM(output_tokens),0) as output_tokens,
           COALESCE(SUM(cost_usd),0) as cost_usd, COUNT(*) as calls
    FROM usage_events WHERE created_at > ${since}
    GROUP BY user_email ORDER BY cost_usd DESC LIMIT 10` : []

  // Daily breakdown for chart
  const daily = await sql`
    SELECT DATE(created_at) as date,
           COALESCE(SUM(input_tokens),0) as input_tokens,
           COALESCE(SUM(output_tokens),0) as output_tokens,
           COALESCE(SUM(cost_usd),0) as cost_usd
    FROM usage_events WHERE created_at > ${since}
    ${session.role !== 'admin' ? sql`AND user_id=${session.id}` : sql``}
    GROUP BY DATE(created_at) ORDER BY date ASC`

  return Response.json({ totals: totals[0], byUser, daily })
}
