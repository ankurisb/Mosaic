import { describe, it, expect } from 'vitest'
import {
  planPrismSample,
  assessPrismCoverage,
  summarizePrismDraft,
  PRISM_MAX_KEYS,
  type DeviceKeyResult,
  type PrismDiagnostics,
} from './prism-dictionary'

function dev(id: string, keys: string[] | undefined, error?: string): DeviceKeyResult {
  return { id, name: id, keys, error }
}

describe('planPrismSample — union & ranking', () => {
  it('unions keys across devices and ranks by device-frequency', () => {
    // The real Ornate NTPC shape: vocabulary spread across devices, no single
    // device holds it all.
    const results = [
      dev('d1', ['kWh', 'kW', 'mb_error']),
      dev('d2', ['kWh', 'mb_error', 'machine_status']),
      dev('d3', ['v1n', 'mb_error']),
      dev('d4', ['slr_rdtn']),
    ]
    const plan = planPrismSample(results)
    expect(plan.devicesAttempted).toBe(4)
    expect(plan.devicesWithKeys).toBe(4)
    expect(plan.devicesErrored).toBe(0)
    // mb_error (3) ranks first, then kWh (2), then the singletons alphabetically.
    expect(plan.keys[0]).toBe('mb_error')
    expect(plan.keys[1]).toBe('kWh')
    expect(plan.keyFreq['mb_error']).toBe(3)
    expect(new Set(plan.keys)).toEqual(new Set(['mb_error', 'kWh', 'kW', 'machine_status', 'slr_rdtn', 'v1n']))
  })

  it('does NOT collapse to a single device (the v1.3.82 bug)', () => {
    // 100 devices all "default"; one reports only v1n, the rest report the rich set.
    const results = [dev('sparse', ['v1n'])]
    for (let i = 0; i < 40; i++) results.push(dev('d' + i, ['kWh', 'kW', 'kWh_sf', 'total_energy']))
    const plan = planPrismSample(results)
    expect(plan.keys).toContain('kWh')
    expect(plan.keys).toContain('kWh_sf')
    expect(plan.keys.length).toBeGreaterThan(1)
  })

  it('dedupes repeated keys within one device (freq counts devices, not occurrences)', () => {
    const plan = planPrismSample([dev('d1', ['kWh', 'kWh', 'kWh'])])
    expect(plan.keyFreq['kWh']).toBe(1)
  })

  it('picks the richest devices for value sampling', () => {
    const results = [
      dev('rich', ['a', 'b', 'c', 'd']),
      dev('mid', ['a', 'b']),
      dev('thin', ['a']),
    ]
    const plan = planPrismSample(results, PRISM_MAX_KEYS, 2)
    expect(plan.valueDeviceIds).toEqual(['rich', 'mid'])
  })

  it('caps the key list at maxKeys, keeping the most common', () => {
    // 200 distinct keys; a core key reported by every device must survive the cap.
    const results: DeviceKeyResult[] = []
    for (let i = 0; i < 200; i++) results.push(dev('d' + i, ['core', 'k' + i]))
    const plan = planPrismSample(results, 50)
    expect(plan.keys.length).toBe(50)
    expect(plan.keys[0]).toBe('core')
  })

  it('tolerates structured/odd key payloads without throwing', () => {
    // A device whose keys array is missing or malformed shouldn't crash planning.
    const results = [
      dev('ok', ['kWh']),
      dev('nokeys', undefined),
      { id: 'weird', name: 'weird', keys: ['shared', '', 'kW'] as string[] },
    ]
    const plan = planPrismSample(results)
    expect(plan.keys).toContain('kWh')
    expect(plan.keys).toContain('shared')
    expect(plan.keys).not.toContain('')   // empty key names filtered out
  })
})

describe('assessPrismCoverage — graceful fallbacks with actionable messages', () => {
  const emptyPlan = planPrismSample([])

  it('empty fleet -> tells the user to add/activate devices', () => {
    const a = assessPrismCoverage(0, emptyPlan)
    expect(a.status).toBe('empty_fleet')
    expect(a.proceed).toBe(false)
    expect(a.message).toMatch(/Add or activate devices/i)
  })

  it('devices present but all error -> blames auth/connectivity, points to Test connection', () => {
    const results = [dev('d1', undefined, 'HTTP 401'), dev('d2', undefined, 'HTTP 401'), dev('d3', undefined, 'fetch failed')]
    const plan = planPrismSample(results)
    const a = assessPrismCoverage(3, plan, 'HTTP 401')
    expect(a.status).toBe('no_keys_errors')
    expect(a.proceed).toBe(false)
    expect(a.message).toMatch(/Test connection/i)
    expect(a.message).toContain('HTTP 401')
  })

  it('devices present, no errors, no keys -> blames telemetry-not-flowing, not auth', () => {
    const results = [dev('d1', []), dev('d2', []), dev('d3', [])]
    const plan = planPrismSample(results)
    const a = assessPrismCoverage(3, plan)
    expect(a.status).toBe('no_keys_empty')
    expect(a.proceed).toBe(false)
    expect(a.message).toMatch(/Latest telemetry/i)
    expect(a.message).not.toMatch(/auth/i)
  })

  it('many devices but <=2 keys -> proceeds with a sparse warning', () => {
    const results: DeviceKeyResult[] = []
    for (let i = 0; i < 15; i++) results.push(dev('d' + i, ['v1n']))
    const plan = planPrismSample(results)
    const a = assessPrismCoverage(15, plan)
    expect(a.status).toBe('sparse')
    expect(a.proceed).toBe(true)
    expect(a.message).toMatch(/warming up/i)
  })

  it('healthy vocabulary -> ok, no message, proceeds', () => {
    const results = [dev('d1', ['kWh', 'kW', 'mb_error', 'v1n', 'slr_rdtn'])]
    const plan = planPrismSample(results)
    const a = assessPrismCoverage(1, plan)
    expect(a.status).toBe('ok')
    expect(a.proceed).toBe(true)
    expect(a.message).toBeUndefined()
  })
})

describe('summarizePrismDraft', () => {
  it('reports described / total / devices and value coverage', () => {
    const d: PrismDiagnostics = {
      fleet_size: 101, devices_sampled: 50, devices_with_keys: 37, devices_errored: 0,
      distinct_keys: 17, keys_with_values: 15, keys_described: 17, coverage_status: 'ok',
    }
    const s = summarizePrismDraft(d)
    expect(s).toContain('17 of 17')
    expect(s).toContain('37 of 50')
    expect(s).toContain('101 in fleet')
    expect(s).toContain('15 had live sample values')
    expect(s).toContain('2 inferred')
  })
})
