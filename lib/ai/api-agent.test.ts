import { describe, test, expect } from 'vitest'
import { mergeStoredSecrets } from './api-agent'

// The diagnoser never sees secrets: it proposes STRUCTURAL auth only. On apply,
// the stored secret values must be re-attached so a config fix can't silently
// wipe credentials — and a changed structural field (e.g. token_path) must win.
describe('mergeStoredSecrets', () => {
  test('re-attaches stored secrets onto a structural-only proposal', () => {
    const stored = { username: 'ugx_admin', password: 'p4ss', login_url: '/accounts/login', token_path: 'access_token' }
    const proposed = { login_url: '/accounts/login', token_path: 'tokens.access' } // model fixed token_path, no secrets
    const merged = mergeStoredSecrets(proposed, stored)
    expect(merged.username).toBe('ugx_admin')
    expect(merged.password).toBe('p4ss')
    expect(merged.token_path).toBe('tokens.access') // structural change from the proposal wins
  })

  test('does not treat structural token_* fields as secrets', () => {
    const stored = { token: 'SECRET', token_header: 'Authorization', token_prefix: 'Bearer', token_url: 'https://h/oauth' }
    // A proposal that changes the header/prefix but carries no secret.
    const proposed = { token_header: 'X-Auth', token_prefix: '' }
    const merged = mergeStoredSecrets(proposed, stored)
    expect(merged.token).toBe('SECRET')        // the actual secret is preserved
    expect(merged.token_header).toBe('X-Auth')  // structural override applied
    expect(merged.token_prefix).toBe('')        // empty prefix is a real structural choice
  })

  test('carries custom secret-shaped keys (x_api_key) but not plain structural keys', () => {
    const stored = { x_api_key: 'abc123', base_region: 'eu' }
    const merged = mergeStoredSecrets({ base_region: 'us' }, stored)
    expect(merged.x_api_key).toBe('abc123') // *_key is secret-shaped → preserved
    expect(merged.base_region).toBe('us')   // structural, taken from the proposal
  })
})
