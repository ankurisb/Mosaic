// lib/secret.ts
// Manages the Mosaic secret key stored at ~/.mosaic/secret.key
// Auto-generates on first run. Used for JWT signing and credential encryption.
// Separate from .env.local so it survives env file changes.

import { randomBytes } from 'crypto'
import { log } from './logger'
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const MOSAIC_DIR  = join(homedir(), '.mosaic')
const SECRET_FILE = join(MOSAIC_DIR, 'secret.key')

let _cached: string | null = null

// Known weak/placeholder values that must never be used as the production secret
// (forgeable JWTs + weak derived encryption key). Checked at boot.
const WEAK_SECRETS = new Set(['changeme', 'secret', 'password', 'ci-test-secret-key-32-chars-padding', 'test', 'mosaic', 'admin'])

/** Warn loudly when an explicitly-set AUTH_SECRET is weak in production. We WARN
 *  rather than crash so a config typo never bricks a customer box, but the signal
 *  is unmistakable in the logs. */
function validateStrength(secret: string): void {
  if (process.env.NODE_ENV !== 'production') return
  const weak = secret.trim().length < 32 || WEAK_SECRETS.has(secret.trim().toLowerCase())
  if (weak) {
    log.error({ service: 'secret' }, '[mosaic] SECURITY: AUTH_SECRET is weak (short or a known placeholder). JWTs are forgeable and encryption is weakened. Set AUTH_SECRET to a high-entropy value of at least 32 characters (e.g. `openssl rand -hex 32`).')
  }
}

export function getSecret(): string {
  if (_cached) return _cached

  // 1. Env var still takes precedence (Docker / CI / explicit override)
  if (process.env.AUTH_SECRET) {
    _cached = process.env.AUTH_SECRET
    validateStrength(_cached)
    return _cached
  }

  // 2. Read from ~/.mosaic/secret.key
  if (existsSync(SECRET_FILE)) {
    const key = readFileSync(SECRET_FILE, 'utf8').trim()
    if (key.length >= 32) {
      _cached = key
      return _cached
    }
  }

  // 3. First run — generate and persist
  const key = randomBytes(32).toString('hex')
  try {
    if (!existsSync(MOSAIC_DIR)) mkdirSync(MOSAIC_DIR, { recursive: true })
    writeFileSync(SECRET_FILE, key, { encoding: 'utf8' })
    chmodSync(SECRET_FILE, 0o600)   // owner read/write only
    log.info({ service: 'secret', data: SECRET_FILE }, '[mosaic] Generated secret key at')
  } catch (err) {
    log.warn({ service: 'secret', data: err }, '[mosaic] Could not write secret key file:')
    // Fall back to in-memory (lost on restart, but won't crash)
  }
  _cached = key
  return _cached
}
