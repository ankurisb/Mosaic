import { describe, test, expect } from 'vitest'
import { mapLimit, TOOL_FANOUT_CONCURRENCY } from './concurrency'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

describe('mapLimit', () => {
  test('preserves input order regardless of completion order', async () => {
    const out = await mapLimit([30, 5, 20, 1], 4, async (x) => { await sleep(x); return x * 10 })
    expect(out).toEqual([300, 50, 200, 10])
  })

  test('never exceeds the concurrency limit', async () => {
    let inFlight = 0, peak = 0
    await mapLimit(Array.from({ length: 25 }, (_, i) => i), 6, async () => {
      inFlight++; peak = Math.max(peak, inFlight)
      await sleep(10)
      inFlight--
      return 1
    })
    expect(peak).toBeLessThanOrEqual(6)
    expect(peak).toBeGreaterThan(1) // actually ran in parallel, not serialised
  })

  test('a limit larger than the item count is fine', async () => {
    const out = await mapLimit([1, 2, 3], 100, async (x) => x + 1)
    expect(out).toEqual([2, 3, 4])
  })

  test('empty input returns empty output', async () => {
    expect(await mapLimit([], 4, async (x) => x)).toEqual([])
  })

  test('items run concurrently (faster than serial)', async () => {
    const t0 = Date.now()
    await mapLimit(Array.from({ length: 12 }, () => 0), 6, async () => { await sleep(20) })
    // 12 items, 20ms each, concurrency 6 → ~2 waves ≈ 40ms, well under serial 240ms
    expect(Date.now() - t0).toBeLessThan(160)
  })

  test('TOOL_FANOUT_CONCURRENCY is a sane bounded default', () => {
    expect(TOOL_FANOUT_CONCURRENCY).toBeGreaterThanOrEqual(1)
    expect(TOOL_FANOUT_CONCURRENCY).toBeLessThanOrEqual(64)
  })
})
