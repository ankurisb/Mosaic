import { describe, it, expect } from 'vitest'
import { buildMssqlConfig } from './mssql-config'

// password_enc without an enc2:/enc: prefix is returned verbatim by decrypt(),
// so plaintext here stands in for a decrypted secret.

describe('buildMssqlConfig: SQL login (default)', () => {
  it('builds a user/password config and no Entra auth block', () => {
    const c = buildMssqlConfig({ host: 'db.local', port: 1433, database_name: 'cmms', username: 'sa', password_enc: 'pw', ssl_mode: 'disable' })
    expect(c.server).toBe('db.local')
    expect(c.user).toBe('sa')
    expect(c.password).toBe('pw')
    expect(c.authentication).toBeUndefined()
    expect(c.options.encrypt).toBe(false)          // ssl_mode disable
  })
  it('encrypts when ssl_mode is not disable, and verify-full tightens the cert check', () => {
    expect(buildMssqlConfig({ host: 'h', ssl_mode: 'require', username: 'u', password_enc: 'p' }).options.encrypt).toBe(true)
    expect(buildMssqlConfig({ host: 'h', ssl_mode: 'verify-full', username: 'u', password_enc: 'p' }).options.trustServerCertificate).toBe(false)
  })
})

describe('buildMssqlConfig: Entra service principal (Azure SQL / Synapse / Fabric)', () => {
  const c = buildMssqlConfig({ host: 'ws.datawarehouse.fabric.microsoft.com', database_name: 'WH', auth_mode: 'entra_sp', username: 'client-id-guid', password_enc: 'client-secret', tenant_id: 'tenant-guid', ssl_mode: 'disable' })
  it('emits the tedious service-principal authentication block', () => {
    expect(c.authentication).toEqual({
      type: 'azure-active-directory-service-principal-secret',
      options: { clientId: 'client-id-guid', clientSecret: 'client-secret', tenantId: 'tenant-guid' },
    })
  })
  it('does not set user/password in Entra mode', () => {
    expect(c.user).toBeUndefined()
    expect(c.password).toBeUndefined()
  })
  it('forces an encrypted channel and validates the server cert even if ssl_mode=disable', () => {
    expect(c.options.encrypt).toBe(true)
    expect(c.options.trustServerCertificate).toBe(false)
  })
  it('defaults the port to 1433 and carries the database', () => {
    expect(c.port).toBe(1433)
    expect(c.database).toBe('WH')
  })
})
