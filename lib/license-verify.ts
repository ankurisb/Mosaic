// lib/license-verify.ts
// Offline Ed25519 verification of a Mosaic license key against the BAKED-IN public
// key. Lets the client reject forged/tampered keys without reaching the server, and
// (for air-gapped installs) verify a key's authenticity + read its embedded
// seat/expiry as a fallback. The public key is a build-time constant — set
// MOSAIC_LICENSE_PUBLIC_KEY at build/deploy to the PEM issued by your licensing
// service. If unset, verification returns false (fail-closed for signature checks,
// but the gate stays 'unconfigured' and OPEN until a LICENSE_KEY is also present —
// see lib/license.ts).
import crypto from 'crypto'

const PUBLIC_KEY_PEM = (process.env.MOSAIC_LICENSE_PUBLIC_KEY || '').replace(/\\n/g, '\n')

function b64urlDecode(str: string): Buffer {
  str = str.replace(/-/g, '+').replace(/_/g, '/')
  while (str.length % 4) str += '='
  return Buffer.from(str, 'base64')
}

export interface LicensePayload {
  cid: string; edition: string; seats: number; exp: number; iat: number; v: number
}

// Verify signature only. Returns the decoded payload if authentic, else null.
export function decodeVerifiedLicense(key: string): LicensePayload | null {
  try {
    if (!PUBLIC_KEY_PEM || typeof key !== 'string') return null
    const parts = key.split('.')
    if (parts.length !== 3 || parts[0] !== 'MSC') return null
    const [, body, sigB64] = parts
    const ok = crypto.verify(null, Buffer.from(body), PUBLIC_KEY_PEM, b64urlDecode(sigB64))
    if (!ok) return null
    const payload = JSON.parse(b64urlDecode(body).toString('utf8'))
    if (!payload || typeof payload !== 'object') return null
    return payload as LicensePayload
  } catch {
    return null
  }
}

// Convenience boolean used by the gate's fast pre-check.
export function verifyLicenseKey(key: string): boolean {
  // If no public key is baked in, we can't verify offline — return true so the gate
  // doesn't hard-fail on signature alone; the ONLINE check is then authoritative.
  // (When you bake in the key, forged keys are rejected here immediately.)
  if (!PUBLIC_KEY_PEM) return true
  return decodeVerifiedLicense(key) !== null
}
