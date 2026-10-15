// lib/chat-budget.ts
// Pure helpers for the chat agent loop's tool-call budget. Extracted so the
// phase logic is unit-testable away from the streaming loop.
//
// The loop gathers data via tools, then must produce a deliverable (prose, and
// often a built artifact like a PDF or chart). A single hard cap that flips the
// turn to "no tools" could cut a data-heavy report off AFTER gathering but
// BEFORE building — yielding an empty turn. So the budget has phases:
//   normal       — full tools, gather freely
//   approaching  — within 4 calls of the budget: nudge to wrap up, still full tools
//   build        — budget reached: allow ONLY deliverable tools (run_code /
//                  render_chart / render_map) so the report can still be built
//                  from data already gathered, within a small grace
//   synthesis    — past budget + grace: no tools, finish in prose (best effort)

export type TurnMode = 'normal' | 'approaching' | 'build' | 'synthesis'

/** Tools allowed to run during the 'build' phase — they produce deliverables,
 *  they don't gather new source data. */
export const BUILD_TOOL_NAMES: ReadonlySet<string> = new Set(['run_code', 'render_chart', 'render_map'])

/** Parse CHAT_TOOL_CALL_BUDGET from env, clamped to [4, 200], default 40. */
export function parseToolBudget(env: string | undefined, def = 40): number {
  const v = parseInt(env || '', 10)
  return Number.isInteger(v) && v >= 4 && v <= 200 ? v : def
}

/** Decide the next turn's mode from how many tool calls have run so far. */
export function chatTurnMode(used: number, budget: number, grace: number): TurnMode {
  if (used >= budget + grace) return 'synthesis'
  if (used >= budget) return 'build'
  if (used >= budget - 4) return 'approaching'
  return 'normal'
}
