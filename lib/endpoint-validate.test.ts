// lib/endpoint-validate.test.ts
// Unit tests for classifyProbe — the deterministic endpoint-validation classifier
// behind the builder's "Validate all". Covers the real FactoryOS cases that
// motivated it: a DRF collection that returns data, a module prefix that 404s or
// returns HTML, an envelope response, an empty list, auth gating, and errors.
import { describe, it, expect } from 'vitest'
import { classifyProbe } from './api-probe'
import type { ProbeOutcome } from './api-probe'

function out(p: Partial<ProbeOutcome>): ProbeOutcome {
  return { ok: (p.status ?? 0) >= 200 && (p.status ?? 0) < 300, status: p.status ?? 0, latencyMs: 1, url: 'https://h/api/x/', ...p }
}

describe('classifyProbe', () => {
  it('root array with rows → data', () => {
    const r = classifyProbe(out({ status: 200, body: [{ id: 1 }, { id: 2 }] }))
    expect(r.cls).toBe('data'); expect(r.rows).toBe(2); expect(r.dataKey).toBe('(root array)')
  })

  it('FactoryOS /assets envelope {assets:[…]} → data under the key', () => {
    const r = classifyProbe(out({ status: 200, body: { assets: [{ id: 'M6_CNC17' }, { id: 'M7' }, { id: 'M8' }] } }))
    expect(r.cls).toBe('data'); expect(r.rows).toBe(3); expect(r.dataKey).toBe('assets')
  })

  it('empty array → empty', () => {
    const r = classifyProbe(out({ status: 200, body: [] }))
    expect(r.cls).toBe('empty'); expect(r.rows).toBe(0)
  })

  it('empty list under a key → empty with key', () => {
    const r = classifyProbe(out({ status: 200, body: { results: [] } }))
    expect(r.cls).toBe('empty'); expect(r.rows).toBe(0); expect(r.dataKey).toBe('results')
  })

  it('object response with no list (e.g. {status,message,data}) → data (object)', () => {
    const r = classifyProbe(out({ status: 200, body: { status: 'ok', message: 'hi', data: { count: 0 } } }))
    expect(r.cls).toBe('data'); expect(r.dataKey).toBe('(object)')
  })

  it('module prefix that 404s → dead', () => {
    const r = classifyProbe(out({ status: 404, body: '<!DOCTYPE html><html><title>Page not found at /api/core</title>' }))
    expect(r.cls).toBe('dead')
  })

  it('2xx that returns an HTML page (not JSON) → dead', () => {
    const r = classifyProbe(out({ status: 200, body: '<!doctype html><html><body>Swagger UI</body></html>' }))
    expect(r.cls).toBe('dead')
  })

  it('401/403 → auth', () => {
    expect(classifyProbe(out({ status: 401 })).cls).toBe('auth')
    expect(classifyProbe(out({ status: 403, body: { detail: 'Superuser session required' } })).cls).toBe('auth')
  })

  it('5xx → error', () => {
    expect(classifyProbe(out({ status: 500 })).cls).toBe('error')
  })

  it('network failure (no status, error set) → error', () => {
    const r = classifyProbe(out({ status: 0, error: 'fetch failed: ECONNREFUSED' }))
    expect(r.cls).toBe('error'); expect(r.detail).toContain('ECONNREFUSED')
  })

  it('JSON delivered as a string is still parsed → data', () => {
    const r = classifyProbe(out({ status: 200, body: '[{"id":1}]' }))
    expect(r.cls).toBe('data'); expect(r.rows).toBe(1)
  })

  it('plain non-empty text 2xx → data (text)', () => {
    const r = classifyProbe(out({ status: 200, body: 'pong' }))
    expect(r.cls).toBe('data')
  })
})
