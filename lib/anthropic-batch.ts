// lib/anthropic-batch.ts
// Phase 8 — Message Batches helper (SDK 0.133).
//
// The Batches API runs many Messages requests asynchronously at ~50% of the
// per-token price. It's a poor fit for anything a user is waiting on (a batch can
// take minutes to 24h), so this helper is only used for offline/scheduled work
// (see report-runner) and is gated behind a flag. It degrades gracefully: the
// caller falls back to normal per-request calls if batching fails or times out.
//
// The helper is deliberately transport-thin and fully unit-testable: it takes any
// object exposing the `messages.batches` surface, so tests pass a mock.

export interface BatchRequestItem {
  custom_id: string
  // Non-streaming Messages params (model, max_tokens, messages, system, ...).
  params: Record<string, unknown>
}

export interface BatchResultItem {
  text?: string
  error?: string
}

// Minimal structural type of the Anthropic client surface we touch — keeps this
// file decoupled from the SDK's exact types and trivially mockable in tests.
export interface BatchCapableClient {
  messages: {
    batches: {
      create(args: { requests: BatchRequestItem[] }): Promise<{ id: string; processing_status: string }>
      retrieve(id: string): Promise<{ id: string; processing_status: string }>
      results(id: string): Promise<AsyncIterable<{
        custom_id: string
        result: { type: string; message?: { content?: Array<{ type: string; text?: string }> }; error?: unknown }
      }>>
    }
  }
}

export interface RunBatchOptions {
  pollMs?: number       // gap between status polls (default 3s)
  timeoutMs?: number    // give up (caller falls back) after this (default 5min)
  sleep?: (ms: number) => Promise<void>  // injectable for tests
}

// Extract the assistant text from a succeeded batch result's message content.
function textFromMessage(message?: { content?: Array<{ type: string; text?: string }> }): string {
  if (!message?.content) return ''
  return message.content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('')
    .trim()
}

/**
 * Submit `requests` as one Message Batch, poll until it ends (or the timeout),
 * and return a map of custom_id -> { text } | { error }. Rejects only on a hard
 * submit/transport failure or timeout, so callers can try/catch and fall back to
 * per-request calls. A request that errored inside the batch comes back as
 * { error } for that custom_id rather than throwing the whole batch.
 */
export async function runMessageBatch(
  client: BatchCapableClient,
  requests: BatchRequestItem[],
  opts: RunBatchOptions = {},
): Promise<Map<string, BatchResultItem>> {
  const pollMs = opts.pollMs ?? 3000
  const timeoutMs = opts.timeoutMs ?? 5 * 60_000
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const out = new Map<string, BatchResultItem>()
  if (!requests.length) return out

  const batch = await client.messages.batches.create({ requests })
  const started = Date.now()
  let status = batch.processing_status
  while (status !== 'ended') {
    if (Date.now() - started >= timeoutMs) {
      throw new Error(`Message batch ${batch.id} did not finish within ${Math.round(timeoutMs / 1000)}s`)
    }
    await sleep(pollMs)
    const cur = await client.messages.batches.retrieve(batch.id)
    status = cur.processing_status
  }

  const results = await client.messages.batches.results(batch.id)
  for await (const r of results) {
    if (r.result?.type === 'succeeded') {
      out.set(r.custom_id, { text: textFromMessage(r.result.message) })
    } else {
      out.set(r.custom_id, { error: `batch request ${r.custom_id} ${r.result?.type ?? 'failed'}` })
    }
  }
  return out
}
