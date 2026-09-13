// lib/ssrf-guard.ts
// SSRF protection for admin-supplied outbound URLs (currently: MCP endpoints).
// An MCP endpoint_url is fetched by the Mosaic SERVER, so without validation a
// malicious/compromised admin could point it at internal services — Mosaic's own
// APIs (localhost:3001), other Docker services, or cloud metadata
// (169.254.169.254 → credential theft on AWS/GCP/Azure). We block private,
// loopback, link-local, and metadata targets, and resolve the hostname to catch
// DNS names that point at internal IPs.
import { lookup } from 'dns/promises'
import net from 'net'

function ipIsBlocked(ip: string): boolean {
  // IPv4
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    if (a === 127) return true                         // loopback 127.0.0.0/8
    if (a === 10) return true                          // private 10/8
    if (a === 172 && b >= 16 && b <= 31) return true   // private 172.16/12
    if (a === 192 && b === 168) return true            // private 192.168/16
    if (a === 169 && b === 254) return true            // link-local / cloud metadata 169.254/16
    if (a === 0) return true                           // 0.0.0.0/8
    if (a === 100 && b >= 64 && b <= 127) return true  // CGNAT 100.64/10
    return false
  }
  // IPv6
  if (net.isIPv6(ip)) {
    const low = ip.toLowerCase()
    if (low === '::1') return true                      // loopback
    if (low.startsWith('fe80')) return true             // link-local
    if (low.startsWith('fc') || low.startsWith('fd')) return true // unique-local fc00::/7
    if (low === '::' ) return true
    // IPv4-mapped (::ffff:a.b.c.d) — extract and re-check
    const m = low.match(/::ffff:(\d+\.\d+\.\d+\.\d+)/)
    if (m) return ipIsBlocked(m[1])
    return false
  }
  return false
}

export interface SsrfCheck { ok: boolean; reason?: string }

// Validate an outbound URL before the server fetches it. Rejects non-http(s)
// schemes, obviously-internal hostnames, and hostnames that RESOLVE to a
// private/metadata IP. Returns { ok } or { ok:false, reason }.
//
// mode:
//  'strict' (default) — block ALL private/loopback/link-local/metadata. Use for URLs
//     that should only ever point at public services (MCP servers, webhooks, spec URLs).
//  'lan' — allow private LAN ranges (10/8, 172.16/12, 192.168/16) because the target is
//     legitimately on the plant network (Prism/IIoT devices), but STILL block loopback
//     (Mosaic's own APIs) and cloud metadata (169.254.169.254) — the dangerous targets.
export async function assertUrlSafe(rawUrl: string, mode: 'strict' | 'lan' = 'strict'): Promise<SsrfCheck> {
  let u: URL
  try { u = new URL(rawUrl) } catch { return { ok: false, reason: 'Invalid URL.' } }

  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    return { ok: false, reason: `Only http(s) endpoints are allowed (got "${u.protocol}").` }
  }

  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '') // strip IPv6 brackets

  // Loopback + metadata are ALWAYS blocked, even in 'lan' mode (Mosaic's own APIs and
  // cloud metadata are the actual attack targets).
  const alwaysBlockedNames = new Set(['localhost', 'localhost.localdomain', 'metadata.google.internal', 'metadata'])
  if (alwaysBlockedNames.has(host) || host.endsWith('.localhost')) {
    return { ok: false, reason: 'Endpoint points to a loopback host, which is not allowed.' }
  }

  const checkIp = (ip: string): SsrfCheck => {
    // loopback + metadata: blocked in both modes
    if (net.isIPv4(ip)) {
      const [a, b] = ip.split('.').map(Number)
      if (a === 127) return { ok: false, reason: 'loopback IP not allowed.' }
      if (a === 169 && b === 254) return { ok: false, reason: 'link-local / cloud-metadata IP not allowed.' }
      if (a === 0) return { ok: false, reason: 'invalid IP.' }
      if (mode === 'lan') return { ok: true } // private LAN allowed for on-prem devices
    }
    if (net.isIPv6(ip)) {
      const low = ip.toLowerCase()
      if (low === '::1') return { ok: false, reason: 'loopback IP not allowed.' }
      if (low.startsWith('fe80')) return { ok: false, reason: 'link-local IP not allowed.' }
      if (mode === 'lan') return { ok: true }
    }
    // strict mode (or public-only): fall through to the full private-range check
    return ipIsBlocked(ip) ? { ok: false, reason: 'private, loopback, or metadata IP not allowed.' } : { ok: true }
  }

  // Non-loopback internal name suffixes: block in strict, allow in lan (plant hostnames).
  if (mode === 'strict' && (alwaysBlockedNames.has(host) || host.endsWith('.internal') || host.endsWith('.local'))) {
    return { ok: false, reason: 'Endpoint points to an internal host, which is not allowed.' }
  }

  // If host is already a literal IP, check it directly.
  if (net.isIP(host)) return checkIp(host)

  // Otherwise resolve the DNS name and block if ANY resolved address is disallowed
  // (defeats DNS names that deliberately point at internal/metadata IPs).
  try {
    const addrs = await lookup(host, { all: true })
    if (!addrs.length) return { ok: false, reason: 'Endpoint hostname did not resolve.' }
    for (const a of addrs) {
      const r = checkIp(a.address)
      if (!r.ok) return { ok: false, reason: `Endpoint hostname resolves to a ${r.reason}` }
    }
    return { ok: true }
  } catch {
    return { ok: false, reason: 'Could not resolve the endpoint hostname.' }
  }
}
