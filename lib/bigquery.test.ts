import { describe, it, expect } from 'vitest'
import { buildBigQueryConfig, flattenRow } from './bigquery'

// password_enc without an enc2:/enc: prefix is returned verbatim by decrypt().

describe('buildBigQueryConfig: service account', () => {
  const sa = JSON.stringify({ type: 'service_account', project_id: 'sa-proj', client_email: 'svc@sa-proj.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\\nX\\n-----END PRIVATE KEY-----' })
  it('parses the SA JSON into credentials', () => {
    const c = buildBigQueryConfig({ database_name: 'my-proj', password_enc: sa, auth_mode: 'service_account' })
    expect(c.projectId).toBe('my-proj')
    expect(c.credentials.client_email).toBe('svc@sa-proj.iam.gserviceaccount.com')
    expect(c.credentials.private_key).toContain('BEGIN PRIVATE KEY')
    expect(c.apiEndpoint).toBeUndefined()
  })
  it('falls back to the SA project_id when no project is set on the connection', () => {
    const c = buildBigQueryConfig({ password_enc: sa, auth_mode: 'service_account' })
    expect(c.projectId).toBe('sa-proj')
  })
})

describe('buildBigQueryConfig: emulator (no auth)', () => {
  const c = buildBigQueryConfig({ database_name: 'test-proj', host: 'http://bq-emulator:9050', auth_mode: 'none' })
  it('sets the apiEndpoint, marks emulator, and carries no real credentials', () => {
    expect(c.apiEndpoint).toBe('http://bq-emulator:9050')
    expect(c.projectId).toBe('test-proj')
    expect(c.emulator).toBe(true)
    expect(c.credentials).toBeUndefined()   // stub auth client is attached at query time
  })
})

describe('flattenRow: scalars + nested/repeated types', () => {
  it('unwraps single-key typed-scalar wrappers and leaves primitives alone', () => {
    const r = flattenRow({
      ts: { value: '2020-01-01T00:00:00.000Z' },   // TIMESTAMP wrapper
      d: { value: '2020-01-01' },                  // DATE wrapper
      num: '1.5',                                   // NUMERIC → already a string
      n: 42,
      s: 'hello',
      nil: null,
    })
    expect(r).toEqual({ ts: '2020-01-01T00:00:00.000Z', d: '2020-01-01', num: '1.5', n: 42, s: 'hello', nil: null })
  })
  it('serialises a STRUCT/RECORD to readable JSON, unwrapping its leaves', () => {
    const r = flattenRow({ driver: { name: 'A', hired: { value: '2021-05-01' }, rating: 4 } })
    expect(r.driver).toBe('{"name":"A","hired":"2021-05-01","rating":4}')
  })
  it('serialises a repeated ARRAY, unwrapping each element', () => {
    expect(flattenRow({ tags: ['x', 'y'] }).tags).toBe('["x","y"]')
    expect(flattenRow({ events: [{ at: { value: '2021-01-01' } }, { at: { value: '2021-01-02' } }] }).events)
      .toBe('[{"at":"2021-01-01"},{"at":"2021-01-02"}]')
  })
  it('leaves GEOGRAPHY/JSON (already strings) untouched', () => {
    const r = flattenRow({ geo: 'POINT(-97 30)', j: '{"k":1}' })
    expect(r).toEqual({ geo: 'POINT(-97 30)', j: '{"k":1}' })
  })
})
