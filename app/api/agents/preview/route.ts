// app/api/agents/preview — "Test run" before publishing.
//
// Runs a DRAFT agent config ({goal, tools, guardrails}) with persist:false, so no
// agent row and no agent_runs row are written — nothing is saved. It is the gate the
// builder uses before Publish.
//
// SAFETY (a test must never mutate anything, even if the draft enables writes):
//   - read_only is FORCED on  -> the runner strips every WRITE_TOOL.
//   - approve_writes FORCED on -> belt-and-braces; a write would pause, never execute.
//   - the side-effect tools that are NOT in WRITE_TOOLS (call_api can POST, run_code
//     executes arbitrary code, fetch_url hits the network) are EXCLUDED unless the
//     caller explicitly opts in; the response says so.
//   - guardrails are clamped DOWN to a tight preview ceiling (a test is real spend).
//   - admin-gated, with a short per-user cooldown so previews can't be spammed.
//   - runs as the CALLER (session identity), not a blanket admin.
//
// The response surfaces the evidence a human needs to trust it before publishing:
// which data sources were consulted and the actual queries issued — not just the prose.
import { getSession } from '@/lib/auth'
import { setupDatabase } from '@/lib/setup'
import { runAgent, DEFAULT_GUARDRAILS, DEFAULT_AGENT_TOOLS, type AgentDef } from '@/lib/agent-runner'

export const runtime = 'nodejs'
export const maxDuration = 300

// Goal-only default: a tight, read-only data toolset so a plain-English goal just works.
const SAFE_DEFAULT_TOOLS = DEFAULT_AGENT_TOOLS
// External / irreversible side effects beyond the WRITE_TOOLS set — off by default in a test.
const SIDE_EFFECT_TOOLS = new Set(['call_api', 'run_code', 'fetch_url'])
// A test run is real LLM + tool spend: keep it tight regardless of the draft's own caps.
const PREVIEW_CEILING = { max_steps: 8, max_tool_calls: 10, max_minutes: 3, max_cost_usd: 0.25 }
const COOLDOWN_MS = 5000

const lastPreview = new Map<string, number>()

export async function POST(req: Request) {
  const session = await getSession()
  if (!session || session.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 })
  await setupDatabase().catch(() => {})

  const now = Date.now()
  const prev = lastPreview.get(session.id) || 0
  if (now - prev < COOLDOWN_MS) return Response.json({ error: 'Please wait a few seconds between test runs.' }, { status: 429 })
  lastPreview.set(session.id, now)

  const b = await req.json().catch(() => ({})) as Record<string, unknown>
  const goal = typeof b.goal === 'string' ? b.goal.trim() : ''
  if (!goal) return Response.json({ error: 'goal is required' }, { status: 400 })

  const includeSideEffect = b.include_side_effect_tools === true
  const requested = Array.isArray(b.tools) && b.tools.length ? (b.tools as unknown[]).map(String) : [...SAFE_DEFAULT_TOOLS]
  const effectiveTools = requested.filter(t => includeSideEffect || !SIDE_EFFECT_TOOLS.has(t))
  const excluded = includeSideEffect ? [] : requested.filter(t => SIDE_EFFECT_TOOLS.has(t))

  // Merge the draft's guardrails, then force safety and clamp every cap DOWN to the ceiling.
  const draft = (b.guardrails && typeof b.guardrails === 'object') ? b.guardrails as Record<string, unknown> : {}
  const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d)
  const guardrails = {
    ...DEFAULT_GUARDRAILS,
    ...draft,
    read_only: true,
    approve_writes: true,
    max_steps: Math.min(num(draft.max_steps, DEFAULT_GUARDRAILS.max_steps), PREVIEW_CEILING.max_steps),
    max_tool_calls: Math.min(num(draft.max_tool_calls, DEFAULT_GUARDRAILS.max_tool_calls), PREVIEW_CEILING.max_tool_calls),
    max_minutes: Math.min(num(draft.max_minutes, DEFAULT_GUARDRAILS.max_minutes), PREVIEW_CEILING.max_minutes),
    max_cost_usd: Math.min(num(draft.max_cost_usd, DEFAULT_GUARDRAILS.max_cost_usd), PREVIEW_CEILING.max_cost_usd),
  }

  const agent: AgentDef = {
    id: 'preview',
    name: (typeof b.name === 'string' && b.name.trim()) ? b.name.trim() : 'Test run',
    goal,
    tools: effectiveTools,
    trigger_type: 'manual',
    guardrails,
    sources: Array.isArray(b.sources) ? (b.sources as unknown[]).map(String) : undefined,
  }

  const run = await runAgent(agent, {
    triggerSource: 'preview',
    persist: false,
    userId: session.id,
    userEmail: session.email,
    userRole: session.role,
  })

  // Evidence for the human to verify source choice + query logic before publishing.
  const steps = run.steps || []
  const sourcesChecked = steps.find(s => s.type === 'result' && s.tool === 'check_data_sources')?.result ?? null
  const queries = steps.filter(s => s.type === 'tool' && s.tool === 'query_database').map(s => s.input)
  const evidence = {
    data_sources_checked: sourcesChecked,
    queries,
    effective_tools: effectiveTools,
    excluded_side_effect_tools: excluded,
    note: 'Test run — read-only forced; write actions are never executed. '
      + (includeSideEffect
          ? 'Side-effect tools (call_api/run_code/fetch_url) were INCLUDED for this test and DID execute.'
          : 'Side-effect tools (call_api/run_code/fetch_url) were excluded; on publish they would run.'),
  }

  return Response.json({ run, evidence })
}
