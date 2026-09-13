// services/licensing/src/license-crypto.js
// License key = a compact, Ed25519-SIGNED token. The signature lets the Mosaic
// client verify authenticity OFFLINE (air-gapped fallback), while the licensing
// service remains the AUTHORITATIVE source for live state (seats, revocation) via
// the online check. Format:  MSC.<base64url(payload)>.<base64url(signature)>
const crypto = require('crypto')

// payload is a small JSON object: { cid, edition, seats, exp, iat, v }
//   cid     customer/license id
//   edition 'personal' | 'enterprise'
//   seats   seat_limit baked in (used only for OFFLINE verification fallback;
//           the online check uses the DB value, which can change without reissue)
//   exp     expiry (unix seconds)
//   iat     issued-at (unix seconds)
//   v       key format version

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/')
  while (str.length % 4) str += '='
  return Buffer.from(str, 'base64')
}

// Sign a payload with the Ed25519 private key (PEM). Returns the license key string.
function signLicense(payload, privateKeyPem) {
  const body = b64url(JSON.stringify(payload))
  const sig = crypto.sign(null, Buffer.from(body), privateKeyPem)
  return `MSC.${body}.${b64url(sig)}`
}

// Verify a license key against the Ed25519 public key (PEM). Returns the decoded
// payload if the signature is valid, else null. Does NOT check expiry/revocation —
// that's the caller's job (this only proves the key is authentic + untampered).
function verifyLicense(key, publicKeyPem) {
  try {
    if (typeof key !== 'string') return null
    const parts = key.split('.')
    if (parts.length !== 3 || parts[0] !== 'MSC') return null
    const [, body, sigB64] = parts
    const ok = crypto.verify(null, Buffer.from(body), publicKeyPem, b64urlDecode(sigB64))
    if (!ok) return null
    const payload = JSON.parse(b64urlDecode(body).toString('utf8'))
    if (!payload || typeof payload !== 'object') return null
    return payload
  } catch {
    return null
  }
}

// Deterministic, non-reversible fingerprint of a key for DB lookup/storage — we
// store the hash, never the raw key, so a DB leak doesn't leak working keys.
function keyHash(key) {
  return crypto.createHash('sha256').update(key).digest('hex')
}

module.exports = { signLicense, verifyLicense, keyHash, b64url, b64urlDecode }
