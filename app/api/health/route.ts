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

export async function GET() {
  const start = Date.now()
  const services: Record<string, ServiceStatus> = {}

  // --- Database -------------------------------------------------------
  try {
    const t = Date.now()
    const sql = getDb()
    await checkWithTimeout(() => sql`SELECT 1 as ok`)
    services.database = { status: 'ok', latency_ms: Date.now() - t }
  } catch (err) {
    services.database = { status: 'error', error: (err as Error).message }
  }

  // --- Encryption key -------------------------------------------------
  try {
    const secret = getSecret()
    services.encryption = secret && secret.length >= 32
      ? { status: 'ok', detail: '~/.mosaic/secret.key or AUTH_SECRET' }
      : { status: 'error', error: 'Secret key too short or missing' }
  } catch (err) {
    services.encryption = { status: 'error', error: (err as Error).message }
  }

  // --- Anthropic API key ----------------------------------------------
  try {
    const key = await getKey('ANTHROPIC_API_KEY')
    services.anthropic = key
      ? { status: 'ok', detail: 'API key configured' }
      : { status: 'unconfigured', detail: 'Add key in Settings → API Keys' }
  } catch (err) {
    services.anthropic = { status: 'error', error: (err as Error).message }
  }

  // --- Superset -------------------------------------------------------
  const supersetUrl = process.env.SUPERSET_URL
  if (supersetUrl) {
    try {
      const t = Date.now()
      const res = await checkWithTimeout(() =>
        fetch(`${supersetUrl}/health`, { signal: AbortSignal.timeout(3000) })
      )
      services.superset = res.ok
        ? { status: 'ok', latency_ms: Date.now() - t }
        : { status: 'degraded', error: `HTTP ${res.status}`, latency_ms: Date.now() - t }
    } catch (err) {
      services.superset = { status: 'error', error: (err as Error).message }
    }
  } else {
    services.superset = { status: 'unconfigured' }
  }

  // --- Airbyte --------------------------------------------------------
  try {
    const sql = getDb()
    const rows = await sql`SELECT url FROM airbyte_instances WHERE active = 1 LIMIT 1`.catch(() => [])
    const airbyteUrl = (rows[0] as { url?: string })?.url
    if (airbyteUrl) {
      const t = Date.now()
      const res = await checkWithTimeout(() =>
        fetch(`${airbyteUrl}/api/v1/health`, { signal: AbortSignal.timeout(3000) })
      )
      services.airbyte = res.ok
        ? { status: 'ok', latency_ms: Date.now() - t }
        : { status: 'degraded', error: `HTTP ${res.status}`, latency_ms: Date.now() - t }
    } else {
      services.airbyte = { status: 'unconfigured' }
    }
  } catch (err) {
    services.airbyte = { status: 'error', error: (err as Error).message }
  }

  // --- n8n ------------------------------------------------------------
  try {
    const n8nUrl = await getKey('N8N_URL')
    if (n8nUrl) {
      const t = Date.now()
      const res = await checkWithTimeout(() =>
        fetch(`${n8nUrl}/healthz`, { signal: AbortSignal.timeout(3000) })
      )
      services.n8n = res.ok
        ? { status: 'ok', latency_ms: Date.now() - t }
        : { status: 'degraded', error: `HTTP ${res.status}`, latency_ms: Date.now() - t }
    } else {
      services.n8n = { status: 'unconfigured' }
    }
  } catch (err) {
    services.n8n = { status: 'error', error: (err as Error).message }
  }

  // --- Schema migrations ----------------------------------------------
  try {
    const sql = getDb()
    const rows = await sql`SELECT version, applied_at FROM schema_migrations ORDER BY version DESC LIMIT 1`.catch(() => [])
    const latest = rows[0] as { version?: string; applied_at?: string } | undefined
    services.migrations = latest
      ? { status: 'ok', detail: `Latest: ${latest.version} at ${latest.applied_at}` }
      : { status: 'ok', detail: 'No migrations table yet — pre-migration install' }
  } catch {
    services.migrations = { status: 'ok', detail: 'No migrations table' }
  }

  // --- Overall status -------------------------------------------------
  const statuses = Object.values(services).map(s => s.status)
  const overall = statuses.includes('error')
    ? 'degraded'
    : statuses.includes('degraded')
      ? 'degraded'
      : 'ok'

  return Response.json({
    status: overall,
    version: APP_VERSION,
    ts: new Date().toISOString(),
    latency_ms: Date.now() - start,
    services,
  })
}
