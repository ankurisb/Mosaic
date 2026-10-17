// lib/sso-role.test.ts
import { describe, it, expect } from 'vitest'
import { deriveSsoRole } from './sso-role'

describe('deriveSsoRole', () => {
  it('Google (no roles asserted) preserves an existing admin — the regression that demoted ankur@ugx.ai', () => {
    expect(deriveSsoRole('admin', [])).toEqual({ role: 'admin', federated: false })
  })
  it('Google (no roles asserted) preserves an existing user', () => {
    expect(deriveSsoRole('user', [])).toEqual({ role: 'user', federated: false })
  })
  it('Keycloak asserting an admin role → admin', () => {
    expect(deriveSsoRole('user', ['default-roles', 'mosaic-admin'])).toEqual({ role: 'admin', federated: true })
    expect(deriveSsoRole('user', ['ADMIN'])).toEqual({ role: 'admin', federated: true })
    expect(deriveSsoRole('user', ['administrator'])).toEqual({ role: 'admin', federated: true })
  })
  it('Keycloak asserting only non-admin roles → user (real demotion still works)', () => {
    expect(deriveSsoRole('admin', ['viewer', 'analyst'])).toEqual({ role: 'user', federated: true })
  })
  it('is case-insensitive and ignores unrelated roles', () => {
    expect(deriveSsoRole('user', ['Mosaic_Admin'])).toEqual({ role: 'admin', federated: true })
    expect(deriveSsoRole('user', ['offline_access', 'uma_authorization'])).toEqual({ role: 'user', federated: true })
  })
})
