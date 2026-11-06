import { describe, it, expect } from 'vitest'
import { buildBigQueryConfig } from './bigquery'

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
