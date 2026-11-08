import { describe, it, expect, vi } from 'vitest'
import { generateKeyPairSync } from 'crypto'
import { buildSnowflakeConfig, processSnowflakeRows, snowflakeQuery, toUnencryptedPkcs8, parseSnowflakeSchemas } from './snowflake'

// A real RSA key, exported once as an unencrypted PKCS8 PEM and once encrypted with a passphrase.
// decrypt() returns password_enc verbatim when it has no enc2:/enc: prefix, so we can feed these
// PEMs straight into buildSnowflakeConfig as password_enc / key_passphrase_enc.
const PASS = 'unit-test-pass-4417'
const { privateKey: KEY } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const PLAIN_PEM = KEY.export({ type: 'pkcs8', format: 'pem' }).toString()
const ENC_PEM = KEY.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: PASS }).toString()

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
  it('passes an unencrypted key through unchanged when no passphrase is stored', () => {
    const u = buildSnowflakeConfig({ host: 'acct', username: 'svc', auth_mode: 'keypair', password_enc: PLAIN_PEM })
    expect(u.privateKey).toBe(PLAIN_PEM)
  })
  it('decrypts an encrypted PEM in-process to an unencrypted PKCS8 key (snowflake-sdk takes no encrypted inline key)', () => {
    const e = buildSnowflakeConfig({ host: 'acct', username: 'svc', auth_mode: 'keypair', password_enc: ENC_PEM, key_passphrase_enc: PASS })
    expect(e.authenticator).toBe('SNOWFLAKE_JWT')
    expect(e.privateKey).toContain('BEGIN PRIVATE KEY')          // unencrypted
    expect(e.privateKey).not.toContain('ENCRYPTED')
  })
  it('throws a clear error when the passphrase is wrong', () => {
    expect(() => buildSnowflakeConfig({ host: 'acct', username: 'svc', auth_mode: 'keypair', password_enc: ENC_PEM, key_passphrase_enc: 'wrong-pass' }))
      .toThrow(/check the key passphrase/)
  })
  it('does not touch the key on password auth even if a passphrase leaked into the row', () => {
    const p = buildSnowflakeConfig({ host: 'acct', username: 'svc', auth_mode: 'password', password_enc: 'pw', key_passphrase_enc: 'ignored' })
    expect(p.privateKey).toBeUndefined()
    expect(p.password).toBe('pw')
  })
})

describe('buildSnowflakeConfig: OAuth token auth', () => {
  const c = buildSnowflakeConfig({ host: 'acct', username: 'svc', auth_mode: 'oauth', password_enc: 'oauth-access-token' })
  it('uses authenticator OAUTH with the token and no password/key', () => {
    expect(c.authenticator).toBe('OAUTH')
    expect(c.token).toBe('oauth-access-token')
    expect(c.password).toBeUndefined()
    expect(c.privateKey).toBeUndefined()
  })
})

describe('parseSnowflakeSchemas', () => {
  it('defaults to PUBLIC when empty', () => {
    expect(parseSnowflakeSchemas('', 'DB')).toEqual([{ db: 'DB', schema: 'PUBLIC', label: 'PUBLIC' }])
    expect(parseSnowflakeSchemas(undefined, 'DB')).toEqual([{ db: 'DB', schema: 'PUBLIC', label: 'PUBLIC' }])
  })
  it('a bare schema in the default DB keeps a 2-part label', () => {
    expect(parseSnowflakeSchemas('TPCH_SF1', 'SNOWFLAKE_SAMPLE_DATA'))
      .toEqual([{ db: 'SNOWFLAKE_SAMPLE_DATA', schema: 'TPCH_SF1', label: 'TPCH_SF1' }])
  })
  it('a cross-database schema gets a 3-part label', () => {
    expect(parseSnowflakeSchemas('OTHER_DB.PUBLIC', 'SNOWFLAKE'))
      .toEqual([{ db: 'OTHER_DB', schema: 'PUBLIC', label: 'OTHER_DB.PUBLIC' }])
  })
  it('splits a comma/semicolon/newline list and de-duplicates', () => {
    const r = parseSnowflakeSchemas('TPCH_SF1, TPCH_SF10 ; SNOWFLAKE_SAMPLE_DATA.TPCH_SF1\nTPCH_SF1', 'SNOWFLAKE_SAMPLE_DATA')
    expect(r).toEqual([
      { db: 'SNOWFLAKE_SAMPLE_DATA', schema: 'TPCH_SF1', label: 'TPCH_SF1' },
      { db: 'SNOWFLAKE_SAMPLE_DATA', schema: 'TPCH_SF10', label: 'TPCH_SF10' },
    ])   // the explicit SNOWFLAKE_SAMPLE_DATA.TPCH_SF1 dups the first (same db+schema) and is dropped
  })
  it('strips quotes/backticks that could break out of the SQL literal', () => {
    expect(parseSnowflakeSchemas("X'Y", 'DB')).toEqual([{ db: 'DB', schema: 'XY', label: 'XY' }])
    expect(parseSnowflakeSchemas('A"B`C', 'DB')).toEqual([{ db: 'DB', schema: 'ABC', label: 'ABC' }])
  })
})

describe('toUnencryptedPkcs8', () => {
  it('is a no-op without a passphrase', () => { expect(toUnencryptedPkcs8(PLAIN_PEM, '')).toBe(PLAIN_PEM) })
  it('decrypts an encrypted PEM with the right passphrase', () => {
    const out = toUnencryptedPkcs8(ENC_PEM, PASS)
    expect(out).toContain('BEGIN PRIVATE KEY'); expect(out).not.toContain('ENCRYPTED')
  })
  it('throws a friendly error on a wrong passphrase', () => {
    expect(() => toUnencryptedPkcs8(ENC_PEM, 'nope')).toThrow(/check the key passphrase/)
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
