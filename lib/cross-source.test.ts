import { describe, it, expect } from 'vitest'
import { evalFormula, federate, validateCrossMeasure, formulaVars, parseLevels, drillTo, type CrossMeasureDef } from './cross-source'

describe('evalFormula (safe, no eval)', () => {
  it('evaluates arithmetic with precedence and parentheses', () => {
    expect(evalFormula('a + b * c', { a: 1, b: 2, c: 3 })).toBe(7)
    expect(evalFormula('(a + b) * c', { a: 1, b: 2, c: 3 })).toBe(9)
    expect(evalFormula('energy / units', { energy: 100, units: 4 })).toBe(25)
    expect(evalFormula('-a + 10', { a: 3 })).toBe(7)
  })
  it('returns null on divide-by-zero or an undefined variable', () => {
    expect(evalFormula('a / b', { a: 1, b: 0 })).toBeNull()
    expect(evalFormula('a / b', { a: 1 })).toBeNull()        // b undefined
    expect(evalFormula('a + ', { a: 1 })).toBeNull()          // malformed
  })
  it('does not execute arbitrary code (identifiers are variable lookups only)', () => {
    // 'constructor' is just an unknown variable -> null, never a function call.
    expect(evalFormula('constructor', {})).toBeNull()
  })
})

describe('federate', () => {
  it('joins two sources on a conformed entity and computes a ratio', () => {
    // energy (PRISM, device_id) and units (MES, machine_id) → energy per unit by asset.
    const bases = {
      energy: { rows: [{ device_id: 'A', kwh: 200 }, { device_id: 'B', kwh: 90 }], keyCol: 'device_id', valueCol: 'kwh' },
      units: { rows: [{ machine_id: 'A', u: 40 }, { machine_id: 'B', u: 30 }], keyCol: 'machine_id', valueCol: 'u' },
    }
    const out = federate(bases, { formula: 'energy / units', entityName: 'asset' })
    expect(out).toEqual([
      { asset: 'A', energy: 200, units: 40, value: 5 },
      { asset: 'B', energy: 90, units: 30, value: 3 },
    ])
  })

  it('aligns on entity + time bucket when a time column is present', () => {
    const bases = {
      energy: { rows: [
        { dev: 'A', ts: '2026-04-12T01:00:00Z', kwh: 100 },
        { dev: 'A', ts: '2026-04-13T01:00:00Z', kwh: 120 },
      ], keyCol: 'dev', valueCol: 'kwh', timeCol: 'ts' },
      units: { rows: [
        { m: 'A', ts: '2026-04-12T05:00:00Z', u: 50 },
        { m: 'A', ts: '2026-04-13T05:00:00Z', u: 40 },
      ], keyCol: 'm', valueCol: 'u', timeCol: 'ts' },
    }
    const out = federate(bases, { grain: '1d', formula: 'energy / units', entityName: 'asset', timeName: 'day' })
    expect(out).toEqual([
      { asset: 'A', day: '2026-04-12', energy: 100, units: 50, value: 2 },
      { asset: 'A', day: '2026-04-13', energy: 120, units: 40, value: 3 },
    ])
  })

  it('emits null for a bucket missing one base (no silent wrong join)', () => {
    const bases = {
      energy: { rows: [{ dev: 'A', kwh: 100 }], keyCol: 'dev', valueCol: 'kwh' },
      units: { rows: [{ m: 'B', u: 10 }], keyCol: 'm', valueCol: 'u' },
    }
    const out = federate(bases, { formula: 'energy / units', entityName: 'asset' })
    // A has energy but no units; B has units but no energy → both value null.
    expect(out.find(r => r.asset === 'A')?.value).toBeNull()
    expect(out.find(r => r.asset === 'B')?.value).toBeNull()
  })
})

describe('validateCrossMeasure (verification gate)', () => {
  const def: CrossMeasureDef = {
    name: 'energy per unit', entity: 'Asset', grain: '1d', formula: 'energy / units',
    bases: {
      energy: { source_type: 'prism', source_id: 'p1', column: 'kwh' },
      units: { source_type: 'database', source_id: 'd1', column: 'units' },
    },
  }
  it('passes only when every base field is verified and the formula is valid', () => {
    const allVerified = () => 'verified'
    expect(validateCrossMeasure(def, allVerified).ok).toBe(true)
  })
  it('blocks when a base is unverified or missing a semantic record', () => {
    const lookup = (st: string) => (st === 'prism' ? 'proposed' : 'verified')
    const v = validateCrossMeasure(def, lookup)
    expect(v.ok).toBe(false); expect(v.unverified).toEqual(['energy'])
    const missing = validateCrossMeasure(def, () => null)
    expect(missing.missing.sort()).toEqual(['energy', 'units'])
  })
  it('rejects a formula that references an undeclared alias or does not parse', () => {
    const bad = { ...def, formula: 'energy / cost' }   // cost not a base
    const v = validateCrossMeasure(bad, () => 'verified')
    expect(v.badFormula).toBe(true); expect(v.unknownVars).toEqual(['cost'])
  })
})

describe('hierarchy helpers', () => {
  it('parses levels and drills up/down', () => {
    const levels = parseLevels('["Plant","Line","Asset"]')
    expect(levels).toEqual(['Plant', 'Line', 'Asset'])
    expect(drillTo(levels, 'Line', 'down')).toBe('Asset')
    expect(drillTo(levels, 'Line', 'up')).toBe('Plant')
    expect(drillTo(levels, 'Asset', 'down')).toBeNull()
  })
  it('formulaVars extracts referenced aliases', () => {
    expect(formulaVars('(a + b) / c').sort()).toEqual(['a', 'b', 'c'])
  })
})
