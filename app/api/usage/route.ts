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
  const isAdmin = session.role === 'admin'

  // ── Totals ────────────────────────────────────────────────────
  const totalsRows = isAdmin
    ? await sql`
        SELECT
          COALESCE(SUM(input_tokens),0)  AS input_tokens,
          COALESCE(SUM(output_tokens),0) AS output_tokens,
          COALESCE(SUM(cache_read_tokens),0)  AS cache_read_tokens,
          COALESCE(SUM(cache_write_tokens),0) AS cache_write_tokens,
          COALESCE(SUM(cost_usd),0)      AS cost_usd,
          COUNT(*)                        AS calls,
          COALESCE(AVG(NULLIF(latency_ms,0)),0)  AS avg_latency_ms,
          COALESCE(SUM(tool_calls_count),0)       AS tool_calls_total
        FROM usage_events WHERE created_at > ${since}`
    : await sql`
        SELECT
          COALESCE(SUM(input_tokens),0)  AS input_tokens,
          COALESCE(SUM(output_tokens),0) AS output_tokens,
          COALESCE(SUM(cache_read_tokens),0)  AS cache_read_tokens,
          COALESCE(SUM(cache_write_tokens),0) AS cache_write_tokens,
          COALESCE(SUM(cost_usd),0)      AS cost_usd,
          COUNT(*)                        AS calls,
          COALESCE(AVG(NULLIF(latency_ms,0)),0)  AS avg_latency_ms,
          COALESCE(SUM(tool_calls_count),0)       AS tool_calls_total
        FROM usage_events WHERE created_at > ${since} AND user_id=${session.id}`

  // ── Per-user breakdown (admin only) ──────────────────────────
  // No LIMIT: a billing view must show every user, not just the top 10 by cost.
  // Capped at 500 as a sanity bound; the UI paginates client-side.
  const byUser = isAdmin ? await sql`
    SELECT
      user_email,
      COALESCE(SUM(input_tokens),0)  AS input_tokens,
      COALESCE(SUM(output_tokens),0) AS output_tokens,
      COALESCE(SUM(cache_read_tokens),0)  AS cache_read_tokens,
      COALESCE(SUM(cache_write_tokens),0) AS cache_write_tokens,
      COALESCE(SUM(cost_usd),0)      AS cost_usd,
      COUNT(*)                        AS calls,
      COALESCE(AVG(NULLIF(latency_ms,0)),0) AS avg_latency_ms
    FROM usage_events WHERE created_at > ${since}
    GROUP BY user_email ORDER BY cost_usd DESC LIMIT 500` : []

  // ── CSV export (admin only) ───────────────────────────────────
  // Finance/billing needs the numbers out of the UI. Returns the full per-user
  // breakdown for the selected period as a downloadable CSV.
  if (searchParams.get('format') === 'csv') {
    if (!isAdmin) return Response.json({ error: 'Admin only' }, { status: 403 })
    const esc = (v: unknown) => {
      const s = String(v ?? '')
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const header = ['user_email', 'calls', 'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens', 'avg_latency_ms', 'cost_usd']
    const lines = [header.join(',')]
    for (const u of byUser as Record<string, unknown>[]) {
      lines.push([
        esc(u.user_email), esc(u.calls), esc(u.input_tokens), esc(u.output_tokens),
        esc(u.cache_read_tokens), esc(u.cache_write_tokens),
        esc(Math.round(Number(u.avg_latency_ms))), esc(Number(u.cost_usd).toFixed(6)),
      ].join(','))
    }
    const csv = lines.join('\n')
    const fname = `mosaic-usage-${period}-${new Date().toISOString().slice(0, 10)}.csv`
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fname}"`,
      },
    })
  }

  // ── Daily breakdown ───────────────────────────────────────────
  const daily = isAdmin
    ? await sql`
        SELECT
          DATE(created_at) AS date,
          COALESCE(SUM(input_tokens),0)  AS input_tokens,
          COALESCE(SUM(output_tokens),0) AS output_tokens,
          COALESCE(SUM(cost_usd),0)      AS cost_usd,
          COALESCE(AVG(NULLIF(latency_ms,0)),0) AS avg_latency_ms
        FROM usage_events WHERE created_at > ${since}
        GROUP BY DATE(created_at) ORDER BY date ASC`
    : await sql`
        SELECT
          DATE(created_at) AS date,
          COALESCE(SUM(input_tokens),0)  AS input_tokens,
          COALESCE(SUM(output_tokens),0) AS output_tokens,
          COALESCE(SUM(cost_usd),0)      AS cost_usd,
          COALESCE(AVG(NULLIF(latency_ms,0)),0) AS avg_latency_ms
        FROM usage_events WHERE created_at > ${since} AND user_id=${session.id}
        GROUP BY DATE(created_at) ORDER BY date ASC`

  // ── Tool type breakdown (JS aggregation — SQLite has no JSON_EACH) ──
  const toolRows = isAdmin
    ? await sql`SELECT tool_types, tool_calls_count FROM usage_events WHERE created_at > ${since} AND tool_types IS NOT NULL`
    : await sql`SELECT tool_types, tool_calls_count FROM usage_events WHERE created_at > ${since} AND tool_types IS NOT NULL AND user_id=${session.id}`

  const toolCounts: Record<string, number> = {}
  for (const row of toolRows) {
    try {
      // db.ts auto-parses JSON columns — handle both array and string forms
      const types: string[] = Array.isArray(row.tool_types)
        ? row.tool_types as string[]
        : JSON.parse(row.tool_types as string)
      for (const t of types) toolCounts[t] = (toolCounts[t] || 0) + 1
    } catch {}
  }
  const toolBreakdown = Object.entries(toolCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([tool, count]) => ({ tool, count }))

  // ── Source type breakdown ─────────────────────────────────────
  const sourceRows = isAdmin
    ? await sql`SELECT source_types FROM usage_events WHERE created_at > ${since} AND source_types IS NOT NULL`
    : await sql`SELECT source_types FROM usage_events WHERE created_at > ${since} AND source_types IS NOT NULL AND user_id=${session.id}`

  const sourceCounts: Record<string, number> = {}
  for (const row of sourceRows) {
    try {
      const types: string[] = Array.isArray(row.source_types)
        ? row.source_types as string[]
        : JSON.parse(row.source_types as string)
      for (const t of types) sourceCounts[t] = (sourceCounts[t] || 0) + 1
    } catch {}
  }
  const sourceBreakdown = Object.entries(sourceCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([source, count]) => ({ source, count }))

  return Response.json({ totals: totalsRows[0], byUser, daily, toolBreakdown, sourceBreakdown })
}
