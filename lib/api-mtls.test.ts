import { describe, it, expect } from 'vitest'
import { buildMtlsDispatcher, hasMtlsMaterial, fetchWithDispatcher, MTLS_AUTH_TYPE } from './api-mtls'
import { applyAuth } from './api-auth'

const CERT = '-----BEGIN CERTIFICATE-----\nMIIBdummycert\n-----END CERTIFICATE-----'
const KEY = '-----BEGIN PRIVATE KEY-----\nMIIBdummykey\n-----END PRIVATE KEY-----'

describe('hasMtlsMaterial', () => {
  it('false when undefined / empty / only one half', () => {
    expect(hasMtlsMaterial(undefined)).toBe(false)
    expect(hasMtlsMaterial({})).toBe(false)
    expect(hasMtlsMaterial({ client_cert: CERT })).toBe(false)
    expect(hasMtlsMaterial({ client_key: KEY })).toBe(false)
    expect(hasMtlsMaterial({ client_cert: '  ', client_key: '  ' })).toBe(false)
  })
  it('true when both cert and key present', () => {
    expect(hasMtlsMaterial({ client_cert: CERT, client_key: KEY })).toBe(true)
  })
})

describe('buildMtlsDispatcher', () => {
  it('undefined for non-mtls auth types', () => {
    expect(buildMtlsDispatcher('bearer', { client_cert: CERT, client_key: KEY })).toBeUndefined()
    expect(buildMtlsDispatcher('basic', undefined)).toBeUndefined()
  })
  it('undefined for mtls without cert/key', () => {
    expect(buildMtlsDispatcher(MTLS_AUTH_TYPE, {})).toBeUndefined()
    expect(buildMtlsDispatcher(MTLS_AUTH_TYPE, { client_cert: CERT })).toBeUndefined()
  })
  it('returns an Agent when cert+key present', () => {
    const d = buildMtlsDispatcher(MTLS_AUTH_TYPE, { client_cert: CERT, client_key: KEY })
    expect(d).toBeDefined()
    expect(d?.constructor.name).toBe('Agent')
  })
  it('caches by fingerprint — identical config returns the same instance', () => {
    const cfg = { client_cert: CERT, client_key: KEY, ca_cert: 'CA' }
    const a = buildMtlsDispatcher(MTLS_AUTH_TYPE, cfg)
    const b = buildMtlsDispatcher(MTLS_AUTH_TYPE, { ...cfg })
    expect(a).toBe(b)
  })
  it('different material → different instance', () => {
    const a = buildMtlsDispatcher(MTLS_AUTH_TYPE, { client_cert: CERT, client_key: KEY })
    const b = buildMtlsDispatcher(MTLS_AUTH_TYPE, { client_cert: CERT, client_key: KEY + 'x' })
    expect(a).not.toBe(b)
  })
  it('normalises CRLF so the same PEM pasted differently shares one agent', () => {
    const a = buildMtlsDispatcher(MTLS_AUTH_TYPE, { client_cert: CERT, client_key: KEY })
    const b = buildMtlsDispatcher(MTLS_AUTH_TYPE, { client_cert: CERT.replace(/\n/g, '\r\n'), client_key: KEY })
    expect(a).toBe(b)
  })
})

describe('applyAuth with mtls', () => {
  it('sets no headers and returns ok — auth is at the TLS layer', async () => {
    const headers: Record<string, string> = {}
    const r = await applyAuth('svc1', 'mtls', { client_cert: CERT, client_key: KEY }, headers)
    expect(r.ok).toBe(true)
    expect(Object.keys(headers)).toHaveLength(0)
  })
})

describe('fetchWithDispatcher', () => {
  it('is a function that returns a promise (global-fetch path, no network)', () => {
    // No dispatcher → uses global fetch; we don't hit the network, just assert shape.
    const p = fetchWithDispatcher('http://127.0.0.1:0/none', { method: 'GET', signal: AbortSignal.timeout(1) }, undefined)
    expect(typeof p.then).toBe('function')
    p.catch(() => { /* expected: connection refused / abort */ })
  })
})
