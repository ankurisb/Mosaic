// lib/api-mtls.ts
// x509 / mutual-TLS transport for outbound API calls. Many on-prem systems —
// SAP gateways above all — authenticate the *client* with a certificate at the
// TLS layer instead of (or alongside) a header credential. There is no header
// to set for this: the client cert + private key are presented during the TLS
// handshake. We do that by building an undici Agent whose `connect` options
// carry the PEM material, and handing it to undici's fetch as the `dispatcher`.
//
// We use undici's OWN fetch (not the global one) on the mTLS path so the Agent
// and the fetch come from the same package — this avoids the bundled-vs-
// installed dispatcher symbol mismatch that can silently drop a dispatcher
// passed to Node's global fetch. The undici Response is API-compatible with the
// global Response for everything the probe reads (headers.get/forEach, text,
// json), so callers don't change.
//
// Agents are cached by a fingerprint of their TLS material so repeated probes
// against the same service reuse one connection pool instead of leaking sockets.

import { Agent, fetch as undiciFetch, type Dispatcher } from 'undici'
import { createHash } from 'crypto'

export const MTLS_AUTH_TYPE = 'mtls'

/** TLS client-auth material. All PEM strings; `ca` and `passphrase` optional. */
export interface MtlsConfig {
  client_cert?: string          // client certificate chain, PEM
  client_key?: string           // client private key, PEM
  client_key_passphrase?: string
  ca_cert?: string              // extra CA(s) to trust (private/self-signed), PEM
  reject_unauthorized?: string  // 'false' to skip server-cert verification (lab only)
}

function trimPem(s: string | undefined): string {
  return (s || '').replace(/\r\n/g, '\n').trim()
}

/** True when the config carries a usable client cert + key pair. */
export function hasMtlsMaterial(cfg: MtlsConfig | undefined): boolean {
  if (!cfg) return false
  const cert = trimPem(cfg.client_cert)
  const key = trimPem(cfg.client_key)
  return cert.length > 0 && key.length > 0
}

const agentCache = new Map<string, Agent>()

function fingerprint(cfg: MtlsConfig): string {
  const h = createHash('sha256')
  h.update(trimPem(cfg.client_cert))
  h.update('\u0000')
  h.update(trimPem(cfg.client_key))
  h.update('\u0000')
  h.update(trimPem(cfg.ca_cert))
  h.update('\u0000')
  h.update(cfg.client_key_passphrase || '')
  h.update('\u0000')
  h.update(String(cfg.reject_unauthorized || ''))
  return h.digest('hex')
}

/**
 * Build (or reuse) an undici Agent that presents the client certificate during
 * the TLS handshake. Returns undefined when there is no cert/key to present, so
 * callers can treat "no mTLS" as simply "no dispatcher".
 */
export function buildMtlsDispatcher(authType: string, authConfig: MtlsConfig | undefined): Dispatcher | undefined {
  if (authType !== MTLS_AUTH_TYPE) return undefined
  if (!hasMtlsMaterial(authConfig)) return undefined
  const cfg = authConfig as MtlsConfig
  const fp = fingerprint(cfg)
  const cached = agentCache.get(fp)
  if (cached) return cached

  const connect: Record<string, unknown> = {
    cert: trimPem(cfg.client_cert),
    key: trimPem(cfg.client_key),
  }
  if (cfg.client_key_passphrase) connect.passphrase = cfg.client_key_passphrase
  const ca = trimPem(cfg.ca_cert)
  if (ca) connect.ca = ca
  // Default to verifying the server cert; only skip when explicitly asked.
  connect.rejectUnauthorized = String(cfg.reject_unauthorized).toLowerCase() !== 'false'

  const agent = new Agent({ connect })
  // Bound the cache so a parade of distinct certs can't grow it without limit.
  if (agentCache.size >= 32) {
    const first = agentCache.keys().next().value
    if (first) { try { void agentCache.get(first)?.close() } catch { /* */ } agentCache.delete(first) }
  }
  agentCache.set(fp, agent)
  return agent
}

/**
 * fetch wrapper that routes through undici's fetch with the given dispatcher
 * when one is present, and through the global fetch otherwise. The two Response
 * shapes are interchangeable for the fields the probe reads.
 */
export function fetchWithDispatcher(
  url: string,
  opts: Record<string, unknown>,
  dispatcher: Dispatcher | undefined,
): Promise<Response> {
  if (dispatcher) {
    return undiciFetch(url, { ...opts, dispatcher } as Parameters<typeof undiciFetch>[1]) as unknown as Promise<Response>
  }
  return fetch(url, opts as RequestInit)
}
