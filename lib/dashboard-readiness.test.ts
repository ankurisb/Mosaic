import { describe, it, expect } from 'vitest'
import { assessPanelReadiness, assessPlanReadiness, prismUsedRefs, apiUsedRefs, sqlScopesEntity, sqlHasAggregate, apiScopesEntity, isIdentifierName } from './dashboard-readiness'

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

describe('multi-entity scoping (SQL/API, dictionary-driven)', () => {
  const ecols = ['machine_id']
  it('raw unscoped multi-entity SQL is NOT scoped (the ambiguous-mix case)', () => {
    expect(sqlScopesEntity('SELECT shift_date, cycle_time_s FROM production_logs', ecols)).toBe(false)
  })
  it('WHERE on the identifier scopes it', () => {
    expect(sqlScopesEntity("SELECT shift_date, cycle_time_s FROM production_logs WHERE machine_id = 'M1'", ecols)).toBe(true)
    expect(sqlScopesEntity('SELECT * FROM production_logs WHERE machine_id IN (1,2)', ecols)).toBe(true)
  })
  it('GROUP BY the identifier scopes it (per-entity series)', () => {
    expect(sqlScopesEntity('SELECT shift_date, machine_id, AVG(cycle_time_s) FROM production_logs GROUP BY shift_date, machine_id', ecols)).toBe(true)
  })
  it('a GROUP BY that does NOT include the identifier is still unscoped', () => {
    expect(sqlScopesEntity('SELECT shift_date, AVG(cycle_time_s) FROM production_logs GROUP BY shift_date', ecols)).toBe(false)
  })
  it('{{entity_id}} placeholder scopes it', () => {
    expect(sqlScopesEntity("SELECT * FROM production_logs WHERE machine_id = {{entity_id}}", ecols)).toBe(true)
  })
  it('sqlHasAggregate distinguishes a deliberate rollup from a raw series', () => {
    expect(sqlHasAggregate('SELECT shift_date, AVG(cycle_time_s) FROM production_logs GROUP BY shift_date')).toBe(true)
    expect(sqlHasAggregate('SELECT shift_date, cycle_time_s FROM production_logs')).toBe(false)
  })
  it('apiScopesEntity: identifier in $filter scopes it; collection without it does not', () => {
    expect(apiScopesEntity('/telemetry?$filter=device_id eq 7', ['device_id'])).toBe(true)
    expect(apiScopesEntity('/telemetry?$select=ts,kw', ['device_id'])).toBe(false)
    expect(apiScopesEntity('/telemetry/{{entity_id}}/metrics', ['device_id'])).toBe(true)
  })
})

describe('isIdentifierName (fallback when dictionary role is null)', () => {
  it('matches id / *_id / *_uuid', () => {
    for (const n of ['id', 'machine_id', 'device_id', 'asset_id', 'equipment_uuid', 'node_guid'])
      expect(isIdentifierName(n), n).toBe(true)
  })
  it('matches bare device/asset tokens (optionally suffixed)', () => {
    for (const n of ['device', 'machine', 'asset', 'serial', 'gateway', 'meter', 'deviceId', 'serial_no'])
      expect(isIdentifierName(n), n).toBe(true)
  })
  it('does NOT match measures/dimensions/time', () => {
    for (const n of ['shift', 'shift_date', 'oee_pct', 'units_produced', 'cycle_time_s', 'inspector', 'reason', 'grid', 'paid'])
      expect(isIdentifierName(n), n).toBe(false)
  })
})
