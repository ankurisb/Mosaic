import { describe, test, expect } from 'vitest'
import { runMessageBatch, type BatchCapableClient, type BatchRequestItem } from './anthropic-batch'

const noSleep = () => Promise.resolve()

// Build a mock client that ends after `pollsUntilEnd` retrieve() calls and then
// yields the given results from results().
function mockClient(opts: {
  pollsUntilEnd: number
  results: Array<{ custom_id: string; result: { type: string; message?: { content?: Array<{ type: string; text?: string }> } } }>
  onCreate?: () => void
}): BatchCapableClient {
  let retrieves = 0
  return {
    messages: {
      batches: {
        async create() { opts.onCreate?.(); return { id: 'batch_1', processing_status: opts.pollsUntilEnd === 0 ? 'ended' : 'in_progress' } },
        async retrieve() { retrieves++; return { id: 'batch_1', processing_status: retrieves >= opts.pollsUntilEnd ? 'ended' : 'in_progress' } },
        async results() { return (async function* () { for (const r of opts.results) yield r })() },
      },
    },
  }
}

const reqs: BatchRequestItem[] = [
  { custom_id: 's1', params: { model: 'claude-sonnet-5', max_tokens: 10, messages: [{ role: 'user', content: 'a' }] } },
  { custom_id: 's2', params: { model: 'claude-sonnet-5', max_tokens: 10, messages: [{ role: 'user', content: 'b' }] } },
]

describe('runMessageBatch', () => {
  test('returns empty map and never calls the API for no requests', async () => {
    let created = false
    const client = mockClient({ pollsUntilEnd: 0, results: [], onCreate: () => { created = true } })
    const out = await runMessageBatch(client, [], { sleep: noSleep })
    expect(out.size).toBe(0)
    expect(created).toBe(false)
  })

  test('maps succeeded results by custom_id, extracting text', async () => {
    const client = mockClient({
      pollsUntilEnd: 2,
      results: [
        { custom_id: 's1', result: { type: 'succeeded', message: { content: [{ type: 'text', text: 'hello ' }, { type: 'text', text: 'world' }] } } },
        { custom_id: 's2', result: { type: 'succeeded', message: { content: [{ type: 'text', text: 'second' }] } } },
      ],
    })
    const out = await runMessageBatch(client, reqs, { sleep: noSleep })
    expect(out.get('s1')?.text).toBe('hello world')
    expect(out.get('s2')?.text).toBe('second')
    expect(out.get('s1')?.error).toBeUndefined()
  })

  test('records errored requests without throwing the whole batch', async () => {
    const client = mockClient({
      pollsUntilEnd: 1,
      results: [
        { custom_id: 's1', result: { type: 'succeeded', message: { content: [{ type: 'text', text: 'ok' }] } } },
        { custom_id: 's2', result: { type: 'errored' } },
      ],
    })
    const out = await runMessageBatch(client, reqs, { sleep: noSleep })
    expect(out.get('s1')?.text).toBe('ok')
    expect(out.get('s2')?.error).toMatch(/errored/)
  })

  test('throws on timeout so the caller can fall back', async () => {
    // Never ends; timeout 0 forces the deadline to trip on the first loop.
    const client = mockClient({ pollsUntilEnd: 999, results: [] })
    await expect(runMessageBatch(client, reqs, { sleep: noSleep, timeoutMs: 0 })).rejects.toThrow(/did not finish/)
  })
})
