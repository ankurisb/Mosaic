// lib/agent-events.ts
// Event-trigger evaluation for agents (trigger_type='event'). Pulls the decision logic
// OUT of the scheduler route so it is unit-testable in isolation.
//
// Semantics — EDGE-TRIGGERED with cooldown:
//   * The agent fires once on a false → true transition of its condition (a rising edge),
//     NOT every minute the condition stays true (that would be a notification storm).
//   * While the condition stays true, it does not re-fire.
//   * When the condition goes false again, the edge is re-armed.
//   * cooldown_sec suppresses a rising edge that lands within cooldown of the last fire
//     (anti-flap); the edge is still consumed so it won't fire until the next true→false→true.
import { extractRows, evaluateCondition, type CompareOp } from './condition-eval'

export interface EventCondition {
  source_type?: string        // 'database' | 'api'
  source_id?: string
  query?: string
  saved_query_id?: string
  field?: string
  op?: CompareOp
  value?: number
  match_mode?: 'any' | 'first'
  cooldown_sec?: number
}

export interface EventState { lastState: number; lastAt: string | null }
export interface EventDecision { fire: boolean; nextState: number; reason: string }

/** Decide whether a freshly-evaluated condition should fire, given prior state. Pure. */
export function decideEventFire(met: boolean, state: EventState, nowMs: number, cooldownSec: number): EventDecision {
  if (!met) return { fire: false, nextState: 0, reason: 'condition_false' }
  if (state.lastState === 1) return { fire: false, nextState: 1, reason: 'still_true' }
  // Rising edge (0 → 1).
  if (cooldownSec > 0 && state.lastAt) {
    const elapsed = (nowMs - new Date(state.lastAt).getTime()) / 1000
    if (elapsed < cooldownSec) return { fire: false, nextState: 1, reason: 'cooldown' }
  }
  return { fire: true, nextState: 1, reason: 'transition' }
}

/** Evaluate an event condition's data against its threshold. Returns whether it is currently
 *  met plus a small snapshot. `exec` is the tool runner (injected for tests). */
export async function evaluateEventCondition(
  cond: EventCondition,
  exec: (name: string, input: Record<string, unknown>) => Promise<unknown>,
  resolveQuery?: (c: EventCondition) => Promise<string | undefined>,
): Promise<{ met: boolean; value: unknown; rows: number; error?: string }> {
  try {
    const srcType = cond.source_type || 'database'
    const srcId = cond.source_id
    const field = cond.field
    if (!srcId || !field) return { met: false, value: null, rows: 0, error: 'missing source_id or field' }
    const query = (resolveQuery ? await resolveQuery(cond) : cond.query) || cond.query
    let data: unknown
    if (srcType === 'database') data = await exec('query_database', { connection_id: srcId, sql: query || `SELECT avg(${field}) AS ${field} FROM ${field}` })
    else if (srcType === 'api') data = await exec('call_api', { connection_id: srcId, method: 'GET', path: query || '' })
    else return { met: false, value: null, rows: 0, error: 'unsupported source_type: ' + srcType }
    const rows = extractRows(data)
    const mode = cond.match_mode === 'any' ? 'any' : 'first'
    const res = evaluateCondition(rows, field, (cond.op || '<') as CompareOp, Number(cond.value), mode)
    return { met: res.met, value: res.matchedValue, rows: rows.length }
  } catch (e) {
    return { met: false, value: null, rows: 0, error: e instanceof Error ? e.message : String(e) }
  }
}
