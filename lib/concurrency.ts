// lib/concurrency.ts
// Bounded-concurrency primitives for the tool runtime. The chat loop can emit
// many tool calls in a single turn ("list all data sources and check them"),
// and running them all through an unbounded Promise.all stampedes shared
// resources — connection pools, per-host rate limits, and above all the auth
// login endpoints (many connections sharing one service all logging in at
// once). Running the fan-out through mapLimit caps how many execute at a time,
// so a wide turn degrades to "slower" instead of "mass timeouts".

/**
 * Run `fn` over `items` with at most `limit` in flight at once. Results are
 * returned in input order (out[i] matches items[i]). `fn` must not throw —
 * callers that can fail should resolve to an error result instead, so one bad
 * item never rejects the whole batch.
 */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  const n = Math.max(1, Math.min(limit, items.length || 1))
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker))
  return out
}

/**
 * Max tool calls executed concurrently from a single assistant turn. The model
 * can still batch many tool calls (parallel data fetches are encouraged); this
 * only bounds how many actually run at once. Tuned low enough to avoid auth /
 * connection-pool stampedes, high enough to keep genuinely parallel work fast.
 * Overridable via env for a deployment with unusually fast or slow sources.
 */
export const TOOL_FANOUT_CONCURRENCY: number = (() => {
  const v = parseInt(process.env.TOOL_FANOUT_CONCURRENCY || '', 10)
  return Number.isInteger(v) && v >= 1 && v <= 64 ? v : 6
})()
