import { APP_VERSION } from '@/lib/version'
import { log, newRequestId } from '@/lib/logger'
import { getDb } from '@/lib/db'
import { getKey } from '@/lib/keys'
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

      // Superset — getKey() honours the kv_settings override (set in the UI),
      // so a "bring your own" Superset is health-checked too. Previously this
      // read process.env only and ignored the configured value.
      (async (): Promise<ServiceStatus> => {
        const url = (await getKey('SUPERSET_URL').catch(() => null)) || process.env.SUPERSET_URL
        if (!url) return { status: 'unconfigured', detail: 'Set Superset URL in Settings → Keys' }
        return probe(url, '/health')
      })(),

      // Airbyte — registered instance (Settings → Data sources)
      (async (): Promise<ServiceStatus> => {
        try {
          const sql = getDb()
          const rows = await sql`SELECT url FROM airbyte_instances WHERE active = true LIMIT 1`.catch(() => [])
          const url = (rows[0] as { url?: string })?.url
          if (!url) return { status: 'unconfigured', detail: 'Add an Airbyte instance in Settings → Data sources' }
          return probe(url, '/api/v1/health')
        } catch (err) {
          return { status: 'error', error: (err as Error).message }
        }
      })(),

      // n8n — resolve settings-first (a saved BYO N8N_URL must win over the
      // compose scaffolding default N8N_URL=http://n8n:5678, which is always set in
      // the container env). getKey() is env-FIRST, so it would return the bundled
      // default and probe the wrong host; resolveN8nUrl() is settings-first.
      (async (): Promise<ServiceStatus> => {
        const { resolveN8nUrl } = await import('@/lib/n8n')
        const url = await resolveN8nUrl().catch(() => null)
        // Treat the bundled default as "configured" only when a bundled n8n is
        // actually expected; if it's unreachable we still report its real status.
        if (!url) return { status: 'unconfigured', detail: 'Set n8n URL in Settings → Keys' }
        return probe(url, '/healthz')
      })(),

      // CISO Assistant — was not health-checked at all before.
      (async (): Promise<ServiceStatus> => {
        const url = (await getKey('CISO_API_URL').catch(() => null)) || process.env.CISO_API_URL
        if (!url) return { status: 'unconfigured', detail: 'Set CISO URL in Settings → Keys' }
        return probe(url, '/api/build')
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
