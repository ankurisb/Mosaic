import { APP_VERSION } from '@/lib/version'
import { log, newRequestId } from '@/lib/logger'
import { getDb } from '@/lib/db'
import { getKey, getKeySettingsFirstStrict } from '@/lib/keys'
import { getSecret } from '@/lib/secret'
export const runtime = 'nodejs'

interface ServiceStatus {
  status: 'ok' | 'degraded' | 'error' | 'unconfigured'
  latency_ms?: number
  error?: string
  detail?: string
}

async function checkWithTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs = 3000
): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), timeoutMs)
    ),
  ])
}

/** Probe an HTTP endpoint. Never throws — returns a ServiceStatus. */
async function probe(url: string, path: string, timeoutMs = 8000): Promise<ServiceStatus> {
  const t = Date.now()
  try {
    const res = await checkWithTimeout(
      () => fetch(`${url.replace(/\/$/, '')}${path}`, { signal: AbortSignal.timeout(timeoutMs) }),
      timeoutMs,
    )
    return res.ok
      ? { status: 'ok', latency_ms: Date.now() - t }
      : { status: 'degraded', error: `HTTP ${res.status}`, latency_ms: Date.now() - t }
  } catch (err) {
    return { status: 'error', error: (err as Error).message, latency_ms: Date.now() - t }
  }
}

export async function GET() {
  const start = Date.now()

  // All checks run in PARALLEL. Previously they were awaited one after another,
  // so the response took the SUM of every check — and each unreachable service
  // burned its full 3s timeout before the next one even started. Now the total
  // is the slowest single check, not the sum.
  const [database, encryption, anthropic, superset, airbyte, n8n, ciso, migrations] =
    await Promise.all([
      // Database
      (async (): Promise<ServiceStatus> => {
        const t = Date.now()
        try {
          const sql = getDb()
          await checkWithTimeout(() => sql`SELECT 1 as ok`)
          return { status: 'ok', latency_ms: Date.now() - t }
        } catch (err) {
          return { status: 'error', error: (err as Error).message }
        }
      })(),

      // Encryption key
      (async (): Promise<ServiceStatus> => {
        try {
          const secret = getSecret()
          return secret && secret.length >= 32
            ? { status: 'ok', detail: '~/.mosaic/secret.key or AUTH_SECRET' }
            : { status: 'error', error: 'Secret key too short or missing' }
        } catch (err) {
          return { status: 'error', error: (err as Error).message }
        }
      })(),

      // Anthropic API key
      (async (): Promise<ServiceStatus> => {
        try {
          const key = await getKey('ANTHROPIC_API_KEY')
          return key
            ? { status: 'ok', detail: 'API key configured' }
            : { status: 'unconfigured', detail: 'Add key in Settings → API Keys' }
        } catch (err) {
          return { status: 'error', error: (err as Error).message }
        }
      })(),

      // Superset — settings-first. A saved BYO SUPERSET_URL is probed and its true
      // status reported. If only the compose scaffolding default (superset:8088)
      // exists and it isn't reachable, that means Superset simply isn't part of
      // this deployment (e.g. Personal edition) — report 'unconfigured', not a
      // scary 'error', since the user never set it up.
      (async (): Promise<ServiceStatus> => {
        const byo = await getKeySettingsFirstStrict('SUPERSET_URL')
        const url = byo || process.env.SUPERSET_URL
        if (!url) return { status: 'unconfigured', detail: 'Set Superset URL in Settings → Keys' }
        const st = await probe(url, '/health')
        if (st.status !== 'ok' && !byo) {
          return { status: 'unconfigured', detail: 'Superset is not configured for this deployment' }
        }
        return st
      })(),

      // Airbyte — registered instance (Settings → Data sources). The public API
      // path differs by flavour (Cloud: /v1, abctl: /api/public/v1, older:
      // /api/v1), so a single hardcoded path gives a false red for the others.
      // Try the health endpoint across flavours and treat a 401 as "up" — the
      // service answered, it just wants auth (a full authenticated ping lives in
      // /api/airbyte?action=ping).
      (async (): Promise<ServiceStatus> => {
        try {
          const sql = getDb()
          const rows = await sql`SELECT url FROM airbyte_instances WHERE active = true`.catch(() => [])
          const urls = (rows as { url?: string }[]).map(r => r.url).filter(Boolean) as string[]
          if (urls.length === 0) return { status: 'unconfigured', detail: 'Add an Airbyte instance in Settings → Data sources' }
          // There may be several active instances (e.g. a bundled one that isn't
          // running plus a reachable Cloud one). Report healthy if ANY reachable;
          // only error if none respond.
          const paths = ['/v1/health', '/api/public/v1/health', '/api/v1/health', '/health']
          const t = Date.now()
          let anyDegraded = false
          for (const url of urls) {
            const base = url.replace(/\/$/, '')
            for (const p of paths) {
              try {
                const res = await fetch(`${base}${p}`, { signal: AbortSignal.timeout(8000) })
                if (res.ok || res.status === 401 || res.status === 403) {
                  return { status: 'ok', latency_ms: Date.now() - t }
                }
                anyDegraded = true
              } catch { /* try next */ }
            }
          }
          return anyDegraded
            ? { status: 'degraded', error: 'configured instance(s) returned errors', latency_ms: Date.now() - t }
            : { status: 'error', error: 'no configured Airbyte instance is reachable', latency_ms: Date.now() - t }
        } catch (err) {
          return { status: 'error', error: (err as Error).message }
        }
      })(),

      // n8n — resolve settings-first (a saved BYO N8N_URL must win over the
      // compose scaffolding default N8N_URL=http://n8n:5678, which is always set in
      // the container env). getKey() is env-FIRST, so it would return the bundled
      // default and probe the wrong host; resolveN8nUrl() is settings-first.
      (async (): Promise<ServiceStatus> => {
        // A saved BYO N8N_URL is probed and its true status reported. If only the
        // compose scaffolding default (http://n8n:5678) exists and it isn't
        // reachable, n8n simply isn't part of this deployment (Personal, no bundled
        // n8n) — report 'unconfigured', not a scary 'error', same as Superset/CISO.
        const byo = await getKeySettingsFirstStrict('N8N_URL')
        const url = byo || process.env.N8N_URL
        if (!url) return { status: 'unconfigured', detail: 'Set n8n URL in Settings → Keys' }
        const st = await probe(url, '/healthz')
        if (st.status !== 'ok' && !byo) {
          return { status: 'unconfigured', detail: 'n8n is not configured for this deployment' }
        }
        return st
      })(),

      // CISO Assistant — settings-first, same treatment as Superset: a BYO
      // CISO_API_URL reports its true status; a scaffolding-only default that's
      // unreachable means CISO isn't part of this deployment -> 'unconfigured'.
      (async (): Promise<ServiceStatus> => {
        const byo = await getKeySettingsFirstStrict('CISO_API_URL')
        const url = byo || process.env.CISO_API_URL
        if (!url) return { status: 'unconfigured', detail: 'Set CISO URL in Settings → Keys' }
        const st = await probe(url, '/api/build')
        if (st.status !== 'ok' && !byo) {
          return { status: 'unconfigured', detail: 'CISO is not configured for this deployment' }
        }
        return st
      })(),

      // Schema migrations
      (async (): Promise<ServiceStatus> => {
        try {
          const sql = getDb()
          const rows = await sql`SELECT version, applied_at FROM schema_migrations ORDER BY version DESC LIMIT 1`.catch(() => [])
          const latest = rows[0] as { version?: string; applied_at?: string } | undefined
          return latest
            ? { status: 'ok', detail: `Latest: ${latest.version} at ${latest.applied_at}` }
            : { status: 'ok', detail: 'No migrations table yet — pre-migration install' }
        } catch {
          return { status: 'ok', detail: 'No migrations table' }
        }
      })(),
    ])

  const services: Record<string, ServiceStatus> = {
    database, encryption, anthropic, superset, airbyte, n8n, ciso, migrations,
  }

  // 'unconfigured' is NOT a failure — a bring-your-own deployment legitimately
  // has tools it does not use. Only real errors degrade overall status.
  const statuses = Object.values(services).map(s => s.status)
  const overall = statuses.includes('error') || statuses.includes('degraded') ? 'degraded' : 'ok'

  return Response.json({
    status: overall,
    version: APP_VERSION,
    ts: new Date().toISOString(),
    latency_ms: Date.now() - start,
    services,
  })
}
