import { describe, it, expect, vi } from 'vitest'
import { decideEventFire, evaluateEventCondition } from './agent-events'

describe('agent events — edge-trigger + cooldown decision', () => {
  const T0 = Date.parse('2026-10-29T00:00:00Z')

  it('fires on a false → true rising edge', () => {
    const d = decideEventFire(true, { lastState: 0, lastAt: null }, T0, 0)
    expect(d).toEqual({ fire: true, nextState: 1, reason: 'transition' })
  })

  it('does NOT re-fire while the condition stays true', () => {
    const d = decideEventFire(true, { lastState: 1, lastAt: new Date(T0).toISOString() }, T0 + 60_000, 0)
    expect(d.fire).toBe(false)
    expect(d.reason).toBe('still_true')
    expect(d.nextState).toBe(1)
  })

  it('re-arms when the condition goes false', () => {
    const d = decideEventFire(false, { lastState: 1, lastAt: new Date(T0).toISOString() }, T0 + 120_000, 0)
    expect(d.fire).toBe(false)
    expect(d.nextState).toBe(0)
    expect(d.reason).toBe('condition_false')
  })

  it('fires again on the NEXT rising edge after re-arming', () => {
    // false → true again, lastState back to 0
    const d = decideEventFire(true, { lastState: 0, lastAt: new Date(T0).toISOString() }, T0 + 10 * 60_000, 300)
    expect(d.fire).toBe(true) // 10 min > 5 min cooldown
  })

  it('suppresses a rising edge within the cooldown window (anti-flap), consuming the edge', () => {
    const d = decideEventFire(true, { lastState: 0, lastAt: new Date(T0).toISOString() }, T0 + 60_000, 300)
    expect(d.fire).toBe(false)
    expect(d.reason).toBe('cooldown')
    expect(d.nextState).toBe(1) // edge consumed — won't fire until it goes false then true again
  })
})

describe('agent events — condition evaluation', () => {
  it('evaluates a DB threshold as met when a row breaches it', async () => {
    const exec = vi.fn().mockResolvedValue({ rows: [{ oee_pct: 68 }] })
    const r = await evaluateEventCondition({ source_type: 'database', source_id: 's1', query: 'SELECT oee_pct FROM x', field: 'oee_pct', op: '<', value: 75 }, exec)
    expect(r.met).toBe(true)
    expect(r.value).toBe(68)
    expect(exec).toHaveBeenCalledWith('query_database', { connection_id: 's1', sql: 'SELECT oee_pct FROM x' })
  })

  it('evaluates not-met when the value is within bounds', async () => {
    const exec = vi.fn().mockResolvedValue({ rows: [{ oee_pct: 82 }] })
    const r = await evaluateEventCondition({ source_type: 'database', source_id: 's1', query: 'q', field: 'oee_pct', op: '<', value: 75 }, exec)
    expect(r.met).toBe(false)
  })

  it('returns an error (not a throw) when source_id/field are missing', async () => {
    const exec = vi.fn()
    const r = await evaluateEventCondition({ source_type: 'database' }, exec)
    expect(r.met).toBe(false)
    expect(r.error).toMatch(/missing/)
    expect(exec).not.toHaveBeenCalled()
  })

  it('tolerates a tool error without throwing', async () => {
    const exec = vi.fn().mockRejectedValue(new Error('connection refused'))
    const r = await evaluateEventCondition({ source_type: 'database', source_id: 's1', field: 'f', op: '>', value: 1 }, exec)
    expect(r.met).toBe(false)
    expect(r.error).toMatch(/connection refused/)
  })
})
