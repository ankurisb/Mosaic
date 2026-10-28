// app/api/agents/suggest — AI suggest-from-goal for the frictionless builder.
//
// Takes a plain-English goal and proposes a config: a minimal tool set + guardrail caps.
// The proposal is CONSTRAINED — the model may only choose from a curated, safe, read-only
// catalog (validated against the real tool registry, hallucinated names dropped), and any
// guardrail it sets is clamped to a hard ceiling it cannot exceed. Write/side-effect tools
// are never suggested. The builder auto-fills this (editable); the Test run is the gate.
import { getSession } from '@/lib/auth'
import { setupDatabase } from '@/lib/setup'
import { getAiClient, getDefaultModelId } from '@/lib/models'
import { DEFAULT_GUARDRAILS } from '@/lib/agent-runner'
import { TOOLS as ALL_TOOLS } from '@/lib/tools'

export const runtime = 'nodejs'
export const maxDuration = 60

// Safe, read-only tools the AI may propose. Deliberately excludes writes and side-effect
// tools (call_api/run_code/fetch_url/create_alert/…) — those stay explicit opt-ins.
const SUGGESTABLE = new Set(['check_data_sources', 'query_database', 'run_statistical_analysis', 'render_chart', 'combine_sources', 'deep_diagnose', 'web_search'])
// Hard ceiling the AI's guardrails are clamped to.
const CEILING = { max_steps: 40, max_tool_calls: 60, max_minutes: 15, max_cost_usd: 2.0 }
const FLOOR = { max_steps: 3, max_tool_calls: 3, max_minutes: 1, max_cost_usd: 0.1 }

export async function POST(req: Request) {
  const session = await getSession()
  if (!session || session.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 })
  await setupDatabase().catch(() => {})
  const b = await req.json().catch(() => ({})) as Record<string, unknown>
  const goal = typeof b.goal === 'string' ? b.goal.trim() : ''
  if (!goal) return Response.json({ error: 'goal is required' }, { status: 400 })

  const catalog = (ALL_TOOLS as { name: string; description?: string }[])
    .filter(t => SUGGESTABLE.has(t.name))
    .map(t => `- ${t.name}: ${(t.description || '').split('\n')[0].slice(0, 160)}`).join('\n')

  const system = `You configure an autonomous Mosaic data agent from a plain-English goal. ` +
    `Choose the MINIMAL set of tools (from the catalog only) the goal needs, and sensible guardrail caps. ` +
    `Almost every data goal needs check_data_sources (to find the source) and query_database. ` +
    `Add render_chart only if a chart is asked for, run_statistical_analysis for trend/outlier/correlation work, ` +
    `combine_sources only to join across sources, deep_diagnose only for open-ended root-cause work, web_search only for external context. ` +
    `Keep caps tight: simple lookups need few steps. Reply with ONLY a JSON object, no prose, no code fences:\n` +
    `{"tools":["..."],"guardrails":{"max_steps":N,"max_tool_calls":N,"max_minutes":N,"max_cost_usd":N},"rationale":"one sentence"}`

  let raw = ''
  try {
    const client = await getAiClient()
    const model = await getDefaultModelId()
    const resp = await client.messages.create({
      model, max_tokens: 500,
      system: `${system}\n\nTOOL CATALOG:\n${catalog}`,
      messages: [{ role: 'user', content: `Agent goal:\n${goal}` }],
    })
    raw = (resp.content || []).filter(c => c.type === 'text').map(c => (c as { text: string }).text).join('').trim()
  } catch (e) {
    return Response.json({ error: 'Model unavailable: ' + (e instanceof Error ? e.message : String(e)) }, { status: 502 })
  }

  // Parse the model's JSON (tolerate stray code fences / surrounding text).
  let parsed: { tools?: unknown; guardrails?: Record<string, unknown>; rationale?: unknown } = {}
  try {
    const m = raw.match(/\{[\s\S]*\}/)
    parsed = m ? JSON.parse(m[0]) : {}
  } catch { parsed = {} }

  // Validate tools: keep only suggestable + real registry names; dedupe; ensure data basics.
  const proposed = Array.isArray(parsed.tools) ? (parsed.tools as unknown[]).map(String) : []
  const dropped = proposed.filter(t => !SUGGESTABLE.has(t))
  let tools = [...new Set(proposed.filter(t => SUGGESTABLE.has(t)))]
  if (tools.length === 0) tools = ['check_data_sources', 'query_database']
  // If it queries data, guarantee it can discover the source.
  if (tools.includes('query_database') && !tools.includes('check_data_sources')) tools = ['check_data_sources', ...tools]

  // Clamp guardrails to [FLOOR, CEILING]; keep the safety flags at their safe defaults.
  const g = (parsed.guardrails && typeof parsed.guardrails === 'object') ? parsed.guardrails : {}
  const clamp = (v: unknown, lo: number, hi: number, d: number) => {
    const n = Number(v); if (!Number.isFinite(n)) return d
    return Math.max(lo, Math.min(hi, n))
  }
  const guardrails = {
    ...DEFAULT_GUARDRAILS,
    max_steps: clamp(g.max_steps, FLOOR.max_steps, CEILING.max_steps, DEFAULT_GUARDRAILS.max_steps),
    max_tool_calls: clamp(g.max_tool_calls, FLOOR.max_tool_calls, CEILING.max_tool_calls, DEFAULT_GUARDRAILS.max_tool_calls),
    max_minutes: clamp(g.max_minutes, FLOOR.max_minutes, CEILING.max_minutes, DEFAULT_GUARDRAILS.max_minutes),
    max_cost_usd: clamp(g.max_cost_usd, FLOOR.max_cost_usd, CEILING.max_cost_usd, DEFAULT_GUARDRAILS.max_cost_usd),
    read_only: true, approve_writes: true, no_progress: true,
  }

  return Response.json({
    tools,
    guardrails,
    rationale: typeof parsed.rationale === 'string' ? parsed.rationale.slice(0, 300) : '',
    dropped_suggestions: dropped,
    note: 'Suggested config (editable). Tools limited to the safe read-only catalog; guardrails clamped to the deployment ceiling. Use Test run before publishing.',
  })
}
