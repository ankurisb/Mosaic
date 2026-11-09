// Client for the mcp-manager sidecar (see mcp-manager/server.mjs). The Mosaic web app is
// unprivileged — it never touches Docker — and instead asks the manager to provision / remove /
// inspect MCP sidecars over a narrow, token-authenticated API on the internal network.

const MANAGER_URL = process.env.MCP_MANAGER_URL || 'http://mcp-manager:9100'
const MANAGER_TOKEN = process.env.MCP_MANAGER_TOKEN || ''

export function managerConfigured(): boolean { return !!MANAGER_TOKEN }

async function call(method: string, path: string, body?: unknown, timeoutMs = 180000): Promise<Record<string, unknown>> {
  if (!MANAGER_TOKEN) throw new Error('MCP manager is not configured on this server (MCP_MANAGER_TOKEN unset)')
  const res = await fetch(`${MANAGER_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MANAGER_TOKEN}` },
    body: body != null ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await res.text()
  let data: Record<string, unknown> = {}
  try { data = text ? JSON.parse(text) : {} } catch { /* non-JSON */ }
  if (!res.ok) throw new Error(String(data.error || `manager HTTP ${res.status}`))
  return data
}

export async function provisionSidecar(args: { name: string; image: string; env: Record<string, string>; port: number }): Promise<{ ok: boolean; id?: string }> {
  return call('POST', '/provision', args) as Promise<{ ok: boolean; id?: string }>
}
export async function removeSidecar(name: string): Promise<void> { await call('POST', '/remove', { name }, 30000) }
export async function sidecarStatus(name: string): Promise<Record<string, unknown>> { return call('GET', `/status?name=${encodeURIComponent(name)}`, undefined, 15000) }
export async function managerHealth(): Promise<Record<string, unknown>> { return call('GET', '/health', undefined, 8000) }
