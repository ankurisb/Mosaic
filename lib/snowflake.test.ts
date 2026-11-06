import { describe, it, expect } from 'vitest'
import { buildSnowflakeConfig } from './snowflake'

// password_enc without an enc2:/enc: prefix is returned verbatim by decrypt().

describe('buildSnowflakeConfig: password auth (default)', () => {
  const c = buildSnowflakeConfig({ host: 'xy12345.eu-west-1', username: 'svc', password_enc: 'pw', database_name: 'ANALYTICS', schema_name: 'PUBLIC', warehouse: 'COMPUTE_WH', role: 'ANALYST' })
  it('maps the shared fields to Snowflake config', () => {
    expect(c.account).toBe('xy12345.eu-west-1')
    expect(c.username).toBe('svc')
    expect(c.password).toBe('pw')
    expect(c.database).toBe('ANALYTICS')
    expect(c.schema).toBe('PUBLIC')
    expect(c.warehouse).toBe('COMPUTE_WH')
    expect(c.role).toBe('ANALYST')
    expect(c.authenticator).toBeUndefined()
  })
})

describe('buildSnowflakeConfig: key-pair (JWT) auth', () => {
  const c = buildSnowflakeConfig({ host: 'acct', username: 'svc', auth_mode: 'keypair', password_enc: '-----BEGIN PRIVATE KEY-----\\nX\\n-----END PRIVATE KEY-----' })
  it('uses SNOWFLAKE_JWT with a private key and no password', () => {
    expect(c.authenticator).toBe('SNOWFLAKE_JWT')
    expect(c.privateKey).toContain('BEGIN PRIVATE KEY')
    expect(c.password).toBeUndefined()
  })
})
