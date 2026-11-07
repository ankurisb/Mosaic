import { describe, it, expect, vi } from 'vitest'
import { buildSnowflakeConfig, processSnowflakeRows, snowflakeQuery } from './snowflake'

// Fake snowflake-sdk column objects (name + type), as stmt.getColumns() returns.
const col = (name: string, type: string) => ({ getName: () => name, getType: () => type })

describe('processSnowflakeRows: type normalisation', () => {
  it('keeps high-precision NUMBER exact (string) but converts safe numbers to JS numbers', () => {
    const cols = [col('BIGNUM', 'fixed'), col('PRICE', 'fixed'), col('RATIO', 'real')]
    const rows = [{ BIGNUM: '12345678901234567890123456789012345678', PRICE: '173665.47', RATIO: '3.14' }]
    expect(processSnowflakeRows(rows, cols)).toEqual([{ BIGNUM: '12345678901234567890123456789012345678', PRICE: 173665.47, RATIO: 3.14 }])
  })
  it('serialises VARIANT/OBJECT/ARRAY to a JSON string cell', () => {
    const cols = [col('V', 'variant'), col('O', 'object'), col('A', 'array')]
    const rows = [{ V: { a: 1, b: [2, 3] }, O: { name: 'A' }, A: [{ id: 1 }, { id: 2 }] }]
    expect(processSnowflakeRows(rows, cols)).toEqual([{ V: '{"a":1,"b":[2,3]}', O: '{"name":"A"}', A: '[{"id":1},{"id":2}]' }])
  })
  it('renders BINARY as a hex string', () => {
    const cols = [col('B', 'binary')]
    const rows = [{ B: Buffer.from([0xde, 0xad, 0xbe, 0xef]) }]
    expect(processSnowflakeRows(rows, cols)).toEqual([{ B: 'deadbeef' }])
  })
  it('leaves text/boolean/null/timestamps untouched and never numberifies a VARCHAR', () => {
    const cols = [col('NAME', 'text'), col('FLAG', 'boolean'), col('NOTHING', 'text'), col('CODE', 'text')]
    const rows = [{ NAME: 'hello', FLAG: true, NOTHING: null, CODE: '00123' }]
    expect(processSnowflakeRows(rows, cols)).toEqual([{ NAME: 'hello', FLAG: true, NOTHING: null, CODE: '00123' }])
  })
})

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

describe('snowflakeQuery: query execution timeout', () => {
  it('cancels the statement and rejects with a bounded error when a query overruns query_timeout_ms', async () => {
    const cancel = vi.fn((cb: (e?: Error) => void) => cb())
    const destroy = vi.fn((cb: () => void) => cb())
    const createConnection = () => ({
      connect: (cb: (err?: Error) => void) => cb(undefined),
      // Never invoke complete() → simulate a runaway/heavy query that hangs.
      execute: () => ({ cancel }),
      destroy,
    })
    vi.doMock('snowflake-sdk', () => ({ default: { createConnection }, createConnection }))
    const { snowflakeQuery: freshQuery } = await import('./snowflake')
    await expect(
      freshQuery(
        { host: 'acct', username: 'svc', password_enc: 'pw', query_timeout_ms: 40 } as never,
        'SELECT * FROM huge_cross_join',
        100,
      ),
    ).rejects.toThrow(/timed out after 40ms/)
    expect(cancel).toHaveBeenCalled()   // server-side cancel was issued
    expect(destroy).toHaveBeenCalled()  // connection torn down in finally
    vi.doUnmock('snowflake-sdk')
  })
  it('exports snowflakeQuery', () => { expect(typeof snowflakeQuery).toBe('function') })
})
