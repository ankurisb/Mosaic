import { describe, it, expect } from 'vitest'
import { scoreCase, suiteScore } from './agent-eval'

describe('agent eval — case scoring', () => {
  it('passes when all expected substrings are present and the run succeeded', () => {
    const s = scoreCase('LATHE-01 had the lowest OEE at 72.1%.', 'succeeded', { expected_contains: ['LATHE-01', 'OEE'] })
    expect(s.passed).toBe(true)
    expect(s.missing).toEqual([])
    expect(s.matched.length).toBe(2)
  })

  it('is case-insensitive', () => {
    const s = scoreCase('the worst machine was lathe-01', 'succeeded', { expected_contains: ['LATHE-01'] })
    expect(s.passed).toBe(true)
  })

  it('fails when an expected substring is missing', () => {
    const s = scoreCase('All machines nominal.', 'succeeded', { expected_contains: ['LATHE-01'] })
    expect(s.passed).toBe(false)
    expect(s.missing).toEqual(['LATHE-01'])
  })

  it('fails when the run did not succeed (default expect_status=succeeded)', () => {
    const s = scoreCase('LATHE-01 lowest', 'stopped', { expected_contains: ['LATHE-01'] })
    expect(s.passed).toBe(false)
    expect(s.status_ok).toBe(false)
  })

  it('expect_status:any ignores run status', () => {
    const s = scoreCase('LATHE-01 lowest', 'stopped', { expected_contains: ['LATHE-01'], expect_status: 'any' })
    expect(s.passed).toBe(true)
    expect(s.status_ok).toBe(true)
  })

  it('empty expectations pass on a successful run (status-only check)', () => {
    const s = scoreCase('anything', 'succeeded', { expected_contains: [] })
    expect(s.passed).toBe(true)
  })

  it('ignores blank expectation entries', () => {
    const s = scoreCase('hello world', 'succeeded', { expected_contains: ['  ', 'world'] })
    expect(s.passed).toBe(true)
    expect(s.matched).toEqual(['world'])
  })
})

describe('agent eval — suite scoring', () => {
  it('computes the fraction passed', () => {
    const scores = [
      scoreCase('LATHE-01', 'succeeded', { expected_contains: ['LATHE-01'] }), // pass
      scoreCase('nope', 'succeeded', { expected_contains: ['LATHE-01'] }),      // fail
      scoreCase('OEE 72', 'succeeded', { expected_contains: ['OEE'] }),          // pass
    ]
    const s = suiteScore(scores)
    expect(s.total).toBe(3)
    expect(s.passed).toBe(2)
    expect(s.score).toBeCloseTo(2 / 3, 5)
  })

  it('an empty suite scores 0 with no division error', () => {
    expect(suiteScore([])).toEqual({ passed: 0, total: 0, score: 0 })
  })
})
