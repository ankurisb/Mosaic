// app/api/agents/[id]/evolve — human-approved continuous evolution.
//
// Reads an agent's recent runs + user feedback + current config, and asks the model to
// PROPOSE an improved version (goal wording, tool set, guardrail caps, and distilled
// learnings to carry forward). It NEVER applies the change — it returns {current, proposed,
// rationale, changes} for the builder to review, Test-run (via /api/agents/preview), and
// then accept with PATCH {..., evolution_source:'ai-proposed-accepted'}. Same constraints
// as suggest-from-goal: tools limited to the safe catalog, guardrails clamped to a ceiling.
import { getSession } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { setupDatabase } from '@/lib/setup'
import { getAiClient, getDefaultModelId } from '@/lib/models'
import { DEFAULT_GUARDRAILS } from '@/lib/agent-runner'
import { TOOLS as ALL_TOOLS } from '@/lib/tools'
import { rowToAgent } from '../route'

export const runtime = 'nodejs'
export const maxDuration = 60

type Row = Record<string, unknown>
const SUGGESTABLE = new Set(['check_data_sources', 'query_database', 'run_statistical_analysis', 'render_chart', 'combine_sources', 'deep_diagnose', 'web_search'])
const CEILING = { max_steps: 40, max_tool_calls: 60, max_minutes: 15, max_cost_usd: 2.0 }
const FLOOR = { max_steps: 3, max_tool_calls: 3, max_minutes: 1, max_cost_usd: 0.1 }

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session || session.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 })
  await setupDatabase().catch(() => {})
  const { id } = await params
  const sql = getDb()

  const arows = await sql`SELECT * FROM agents WHERE id=${id}`.catch(() => [])
  const agentRow = (arows as Row[])[0]
  if (!agentRow) return Response.json({ error: 'Not found' }, { status: 404 })
  const cur = rowToAgent(agentRow)
  const curLearnings = String(agentRow.learnings || '')

  const runs = await sql`SELECT status, stop_reason, rating, feedback, cost_usd, result, started_at
    FROM agent_runs WHERE agent_id=${id} ORDER BY started_at DESC LIMIT 10`.catch(() => []) as Row[]
  if (runs.length === 0) return Response.json({ error: 'No run history yet — run the agent a few times (and rate some runs) before evolving.' }, { status: 409 })

  const history = runs.map((r, i) => {
    const rt = Number(r.rating) > 0 ? '👍' : Number(r.rating) < 0 ? '👎' : '—'
    const fb = typeof r.feedback === 'string' && r.feedback ? ` note:"${r.feedback.slice(0, 160)}"` : ''
    return `#${i + 1} ${r.status}/${r.stop_reason} rating:${rt}${fb} cost:$${Number(r.cost_usd || 0).toFixed(3)} result:"${String(r.result || '').slice(0, 220)}"`
  }).join('\n')

  const catalog = (ALL_TOOLS as { name: string; description?: string }[])
    .filter(t => SUGGESTABLE.has(t.name))
    .map(t => `- ${t.name}: ${(t.description || '').split('\n')[0].slice(0, 140)}`).join('\n')

  const system = `You improve an existing autonomous Mosaic data agent using its recent run history and user feedback. ` +
    `Propose a MINIMAL, safe improvement. You may: refine the goal wording for clarity; adjust the tool set (from the catalog ONLY); ` +
    `tune guardrail caps (e.g. raise max_steps if runs hit the step limit, lower if wasteful); and distil durable LEARNINGS to carry forward ` +
    `(known-good queries, resolved source names, recurring findings) — concise bullet lines, re-verifiable, no invented facts. ` +
    `Change only what the evidence supports; if the agent is working well, say so and keep it close to current. ` +
    `Reply with ONLY JSON, no prose/fences: ` +
    `{"goal":"...","tools":["..."],"guardrails":{"max_steps":N,"max_tool_calls":N,"max_minutes":N,"max_cost_usd":N},"learnings":"...","rationale":"one sentence","changes":["short bullet",...]}`

  const prompt = `CURRENT CONFIG:\ngoal: ${cur.goal}\ntools: ${JSON.stringify(cur.tools)}\nguardrails: ${JSON.stringify(cur.guardrails)}\nlearnings: ${curLearnings || '(none)'}\n\n` +
    `RECENT RUNS (newest first):\n${history}\n\nTOOL CATALOG:\n${catalog}`

  let raw = ''
  try {
    const client = await getAiClient()
    const model = await getDefaultModelId()
    const resp = await client.messages.create({ model, max_tokens: 900, system, messages: [{ role: 'user', content: prompt }] })
    raw = (resp.content || []).filter(c => c.type === 'text').map(c => (c as { text: string }).text).join('').trim()
  } catch (e) {
    return Response.json({ error: 'Model unavailable: ' + (e instanceof Error ? e.message : String(e)) }, { status: 502 })
  }

  let parsed: Record<string, unknown> = {}
  try { const m = raw.match(/\{[\s\S]*\}/); parsed = m ? JSON.parse(m[0]) : {} } catch { parsed = {} }

  const proposedTools = Array.isArray(parsed.tools) ? (parsed.tools as unknown[]).map(String) : cur.tools
  const dropped = proposedTools.filter(t => !SUGGESTABLE.has(t))
  let tools = [...new Set(proposedTools.filter(t => SUGGESTABLE.has(t)))]
  if (tools.length === 0) tools = cur.tools.length ? cur.tools : ['check_data_sources', 'query_database']
  if (tools.includes('query_database') && !tools.includes('check_data_sources')) tools = ['check_data_sources', ...tools]

  const g = (parsed.guardrails && typeof parsed.guardrails === 'object') ? parsed.guardrails as Record<string, unknown> : {}
  const clamp = (v: unknown, lo: number, hi: number, d: number) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d }
  const guardrails = {
    ...DEFAULT_GUARDRAILS,
    max_steps: clamp(g.max_steps, FLOOR.max_steps, CEILING.max_steps, cur.guardrails?.max_steps ?? DEFAULT_GUARDRAILS.max_steps),
    max_tool_calls: clamp(g.max_tool_calls, FLOOR.max_tool_calls, CEILING.max_tool_calls, cur.guardrails?.max_tool_calls ?? DEFAULT_GUARDRAILS.max_tool_calls),
    max_minutes: clamp(g.max_minutes, FLOOR.max_minutes, CEILING.max_minutes, cur.guardrails?.max_minutes ?? DEFAULT_GUARDRAILS.max_minutes),
    max_cost_usd: clamp(g.max_cost_usd, FLOOR.max_cost_usd, CEILING.max_cost_usd, cur.guardrails?.max_cost_usd ?? DEFAULT_GUARDRAILS.max_cost_usd),
    read_only: true, approve_writes: true, no_progress: true,
  }

  const proposed = {
    goal: typeof parsed.goal === 'string' && parsed.goal.trim() ? parsed.goal.trim() : cur.goal,
    tools,
    guardrails,
    learnings: typeof parsed.learnings === 'string' ? parsed.learnings.slice(0, 4000) : curLearnings,
    sources: cur.sources ?? [],
  }

  return Response.json({
    current: { goal: cur.goal, tools: cur.tools, guardrails: cur.guardrails, learnings: curLearnings, sources: cur.sources ?? [] },
    proposed,
    rationale: typeof parsed.rationale === 'string' ? parsed.rationale.slice(0, 400) : '',
    changes: Array.isArray(parsed.changes) ? (parsed.changes as unknown[]).map(String).slice(0, 12) : [],
    dropped_suggestions: dropped,
    runs_considered: runs.length,
    note: 'Proposed only — not applied. Test-run it via /api/agents/preview, then accept by PATCHing the agent with evolution_source:"ai-proposed-accepted".',
  })
}
