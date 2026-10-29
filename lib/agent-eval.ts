// lib/agent-eval.ts
// Eval harness for agents. A saved eval CASE is a checkable expectation on a run: the result
// should contain certain substrings and (optionally) the run should have succeeded. Running
// the suite scores each case deterministically, so an agent change (or an AI-proposed
// evolution) is MEASURED against known-good expectations — not accepted on vibes.
//
// The scoring is pure and unit-testable; the actual runs are produced by the agent runner
// (which needs the model) and fed in here.

export interface EvalCaseSpec {
  expected_contains: string[]        // substrings the result should contain (case-insensitive)
  expect_status?: 'succeeded' | 'any' // whether the run must have succeeded (default 'succeeded')
}
export interface CaseScore {
  passed: boolean
  status_ok: boolean
  matched: string[]
  missing: string[]
}

/** Score one run against one case's expectations. Pure. */
export function scoreCase(result: string, status: string, spec: EvalCaseSpec): CaseScore {
  const text = (result || '').toLowerCase()
  const matched: string[] = []
  const missing: string[] = []
  for (const raw of spec.expected_contains || []) {
    const needle = String(raw).toLowerCase().trim()
    if (!needle) continue
    if (text.includes(needle)) matched.push(raw)
    else missing.push(raw)
  }
  const status_ok = (spec.expect_status || 'succeeded') === 'any' ? true : status === 'succeeded'
  const passed = status_ok && missing.length === 0
  return { passed, status_ok, matched, missing }
}

export interface SuiteScore { passed: number; total: number; score: number }
/** Aggregate case scores into a suite score (fraction passed, 0..1). Pure. */
export function suiteScore(scores: CaseScore[]): SuiteScore {
  const total = scores.length
  const passed = scores.filter(s => s.passed).length
  return { passed, total, score: total ? passed / total : 0 }
}
