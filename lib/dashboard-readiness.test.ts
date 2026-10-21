import { describe, it, expect } from 'vitest'
import { assessPanelReadiness, assessPlanReadiness, prismUsedRefs, apiUsedRefs } from './dashboard-readiness'

describe('assessPanelReadiness', () => {
  it('ready when data + grounded + scoped', () => {
    expect(assessPanelReadiness({ sourceType: 'database', cls: 'data' })).toEqual({ ready: true, gaps: [] })
  })
  it('blocks empty (strict)', () => {
    const r = assessPanelReadiness({ sourceType: 'database', cls: 'empty' })
    expect(r.ready).toBe(false); expect(r.gaps[0]).toMatch(/no data/)
  })
  it('blocks query error with detail', () => {
    const r = assessPanelReadiness({ sourceType: 'database', cls: 'error', detail: 'column powr does not exist' })
    expect(r.ready).toBe(false); expect(r.gaps[0]).toMatch(/powr/)
  })
  it('blocks invalid shape', () => {
    expect(assessPanelReadiness({ sourceType: 'database', cls: 'invalid', detail: 'y not numeric' }).ready).toBe(false)
  })
  it('grounds used refs against known (flags unknown keys)', () => {
    const r = assessPanelReadiness({ sourceType: 'prism', cls: 'data', knownRefs: ['kwh', 'kw'], usedRefs: ['kwh', 'powr'] })
    expect(r.ready).toBe(false); expect(r.gaps[0]).toMatch(/powr/)
  })
  it('passes grounding when all used refs are known', () => {
    expect(assessPanelReadiness({ sourceType: 'prism', cls: 'data', knownRefs: ['kwh', 'kw'], usedRefs: ['kwh'] }).ready).toBe(true)
  })
  it('skips grounding when known set is unavailable', () => {
    expect(assessPanelReadiness({ sourceType: 'prism', cls: 'data', usedRefs: ['anything'] }).ready).toBe(true)
  })
  it('blocks an unscoped multi-entity panel', () => {
    const r = assessPanelReadiness({ sourceType: 'prism', cls: 'data', multiEntity: true, hasEntityScope: false })
    expect(r.ready).toBe(false); expect(r.gaps[0]).toMatch(/device/i)
  })
  it('passes a scoped multi-entity panel', () => {
    expect(assessPanelReadiness({ sourceType: 'prism', cls: 'data', multiEntity: true, hasEntityScope: true }).ready).toBe(true)
  })
  it('entity-templated with no default device → one "pick a device" gap, not a query error', () => {
    const r = assessPanelReadiness({ sourceType: 'prism', cls: 'empty', detail: 'awaiting default device', needsSampleEntity: true, multiEntity: true, hasEntityScope: true })
    expect(r.ready).toBe(false)
    expect(r.gaps).toHaveLength(1)
    expect(r.gaps[0]).toMatch(/default device/i)
    expect(r.gaps[0]).not.toMatch(/no data|failed/i)   // not reported as an executability failure
  })
})

describe('assessPlanReadiness', () => {
  it('allReady only when every panel is ready', () => {
    const r = assessPlanReadiness([
      { title: 'a', readiness: { ready: true, gaps: [] } },
      { title: 'b', readiness: { ready: false, gaps: ['no data'] } },
    ])
    expect(r.allReady).toBe(false); expect(r.readyCount).toBe(1); expect(r.total).toBe(2)
    expect(r.gaps).toEqual([{ panel: 'b', gaps: ['no data'] }])
  })
})

describe('ref extraction', () => {
  it('prismUsedRefs reads keys[]', () => {
    expect(prismUsedRefs({ keys: ['kWh', 'kW'] })).toEqual(['kwh', 'kw'])
    expect(prismUsedRefs({})).toEqual([])
  })
  it('apiUsedRefs reads $select + $filter identifiers', () => {
    const refs = apiUsedRefs('/X?$select=OEE,Shift&$filter=Line eq 3 and ts ge 2026')
    expect(refs).toContain('oee'); expect(refs).toContain('shift'); expect(refs).toContain('line')
  })
})
