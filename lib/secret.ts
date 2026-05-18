// lib/secret.ts
// Manages the Mosaic secret key stored at ~/.mosaic/secret.key
// Auto-generates on first run. Used for JWT signing and credential encryption.
// Separate from .env.local so it survives env file changes.

import { randomBytes } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const MOSAIC_DIR  = join(homedir(), '.mosaic')
const SECRET_FILE = join(MOSAIC_DIR, 'secret.key')

let _cached: string | null = null

export function getSecret(): string {
  if (_cached) return _cached

  // 1. Env var still takes precedence (Docker / CI / explicit override)
  if (process.env.AUTH_SECRET) {
    _cached = process.env.AUTH_SECRET
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
    console.log('[mosaic] Generated secret key at', SECRET_FILE)
  } catch (err) {
    console.warn('[mosaic] Could not write secret key file:', err)
    // Fall back to in-memory (lost on restart, but won't crash)
  }
  _cached = key
  return _cached
}
