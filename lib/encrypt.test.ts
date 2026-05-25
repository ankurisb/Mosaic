import { describe, test, expect, beforeAll } from 'vitest'
import { encrypt, decrypt } from './encrypt'

// getSecret() reads process.env.AUTH_SECRET first — set it here so
// no filesystem access is needed during tests.
beforeAll(() => {
  process.env.AUTH_SECRET = 'test-secret-key-for-vitest-32chars!!'
})

describe('encrypt / decrypt', () => {
  test('roundtrip: decrypt(encrypt(x)) === x', () => {
    const original = 'sk-ant-api03-test-key-value'
    expect(decrypt(encrypt(original))).toBe(original)
  })

  test('roundtrip works for empty string', () => {
    expect(decrypt(encrypt(''))).toBe('')
  })

  test('roundtrip works for long strings', () => {
    const long = 'a'.repeat(500)
    expect(decrypt(encrypt(long))).toBe(long)
  })

  test('roundtrip works for strings with special characters', () => {
    const special = 'password!@#$%^&*()_+{}|:"<>?`~'
    expect(decrypt(encrypt(special))).toBe(special)
  })

  test('roundtrip works for unicode', () => {
    const unicode = 'test-密码-パスワード-🔑'
    expect(decrypt(encrypt(unicode))).toBe(unicode)
  })

  test('encrypt produces enc2: prefix format', () => {
    const result = encrypt('any-value')
    expect(result).toMatch(/^enc2:/)
  })

  test('encrypt produces different ciphertext each call (random IV)', () => {
    const a = encrypt('same-input')
    const b = encrypt('same-input')
    expect(a).not.toBe(b)  // IVs differ → ciphertext differs
  })

  test('encrypted value has 4 colon-separated parts', () => {
    const result = encrypt('test')
    const parts = result.split(':')
    expect(parts).toHaveLength(4)  // enc2 : iv : tag : data
    expect(parts[0]).toBe('enc2')
  })

  test('decrypt handles legacy enc: base64 format', () => {
    // Old format: enc:<base64>
    const legacy = 'enc:' + Buffer.from('legacy-plaintext').toString('base64')
    expect(decrypt(legacy)).toBe('legacy-plaintext')
  })

  test('decrypt returns plain text unchanged if not encrypted', () => {
    expect(decrypt('plaintext-not-encrypted')).toBe('plaintext-not-encrypted')
  })

  test('decrypt empty string returns empty string', () => {
    expect(decrypt('')).toBe('')
  })

  test('decrypt malformed enc2 value returns empty string', () => {
    expect(decrypt('enc2:badhex:badhex:badhex')).toBe('')
  })
})
