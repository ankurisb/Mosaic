/**
 * lib/data-retention.ts
 * Purge engine for per-dataset data retention policies.
 *
 * Each dataset has an entry in data_retention_settings with:
 *   enabled        — whether purging is active
 *   retention_days — rows older than this are deleted (0 = keep forever)
 *
 * Purge runs nightly via the scheduler, and can be triggered manually from the UI.
 */
import { getDb } from './db'
import { log } from './logger'

export interface DatasetMeta {
  dataset: string
  label: string
  description: string
  connectorTierRelevant: boolean  // true = this data is generated even in connector-only tier
  isoMinDays?: number             // ISO 27001 minimum if applicable
  warning?: string                // shown when retention_days is set below isoMinDays
}

// Canonical list of datasets with retention policies
export const DATASETS: DatasetMeta[] = [
  {
    dataset: 'conversations',
    label: 'Chat conversations',
    description: 'Conversation threads and titles. Cascades to messages automatically.',
    connectorTierRelevant: false,
  },
  {
    dataset: 'messages',
    label: 'Chat messages',
    description: 'Individual chat messages, tool calls, and RCA blocks.',
    connectorTierRelevant: false,
  },
  {
    dataset: 'usage_events',
    label: 'Usage & billing events',
    description: 'Token consumption, cost, and latency per request. Used for billing and compliance.',
    connectorTierRelevant: true,
    isoMinDays: 365,
    warning: 'ISO 27001 A.8.15 recommends retaining metering records for at least 1 year.',
  },
  {
    dataset: 'egress_events',
    label: 'Data egress log',
    description: 'Every event where data was accessed — source, user, token count, model.',
    connectorTierRelevant: true,
    isoMinDays: 365,
    warning: 'ISO 27001 A.8.15 recommends retaining egress logs for at least 1 year.',
  },
  {
    dataset: 'rca_sessions',
    label: 'RCA sessions',
    description: 'Root cause analysis session records — inputs, findings, outputs.',
    connectorTierRelevant: false,
  },
  {
    dataset: 'query_history',
    label: 'Query builder history',
    description: 'SQL queries run via the Query Builder.',
    connectorTierRelevant: false,
  },
  {
    dataset: 'integration_runs',
    label: 'Rule & notification run log',
    description: 'Log of every rule execution — fired, skipped, errored — with payloads.',
    connectorTierRelevant: true,
  },
]

export interface PurgeResult {
  dataset: string
  purged: number
  skipped: boolean
  reason?: string
}

// Execute a purge for a single dataset using explicit SQL (avoids dynamic table names)
async function purgeDataset(
  sql: ReturnType<typeof getDb>,
  dataset: string,
  retentionDays: number,
): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 86400_000).toISOString()

  if (dataset === 'conversations') {
    const r = await sql`SELECT COUNT(*) as cnt FROM conversations WHERE created_at < ${cutoff}`
    const n = Number((r[0] as { cnt: unknown })?.cnt || 0)
    if (n > 0) await sql`DELETE FROM conversations WHERE created_at < ${cutoff}`
    return n
  }
  if (dataset === 'messages') {
    const r = await sql`SELECT COUNT(*) as cnt FROM messages WHERE created_at < ${cutoff}`
    const n = Number((r[0] as { cnt: unknown })?.cnt || 0)
    if (n > 0) await sql`DELETE FROM messages WHERE created_at < ${cutoff}`
    return n
  }
  if (dataset === 'usage_events') {
    const r = await sql`SELECT COUNT(*) as cnt FROM usage_events WHERE created_at < ${cutoff}`
    const n = Number((r[0] as { cnt: unknown })?.cnt || 0)
    if (n > 0) await sql`DELETE FROM usage_events WHERE created_at < ${cutoff}`
    return n
  }
  if (dataset === 'egress_events') {
    const r = await sql`SELECT COUNT(*) as cnt FROM egress_events WHERE timestamp < ${cutoff}`
    const n = Number((r[0] as { cnt: unknown })?.cnt || 0)
    if (n > 0) await sql`DELETE FROM egress_events WHERE timestamp < ${cutoff}`
    return n
  }
  if (dataset === 'rca_sessions') {
    const r = await sql`SELECT COUNT(*) as cnt FROM rca_sessions WHERE created_at < ${cutoff}`
    const n = Number((r[0] as { cnt: unknown })?.cnt || 0)
    if (n > 0) await sql`DELETE FROM rca_sessions WHERE created_at < ${cutoff}`
    return n
  }
  if (dataset === 'query_history') {
    const r = await sql`SELECT COUNT(*) as cnt FROM query_history WHERE executed_at < ${cutoff}`
    const n = Number((r[0] as { cnt: unknown })?.cnt || 0)
    if (n > 0) await sql`DELETE FROM query_history WHERE executed_at < ${cutoff}`
    return n
  }
  if (dataset === 'integration_runs') {
    const r = await sql`SELECT COUNT(*) as cnt FROM integration_runs WHERE triggered_at < ${cutoff}`
    const n = Number((r[0] as { cnt: unknown })?.cnt || 0)
    if (n > 0) await sql`DELETE FROM integration_runs WHERE triggered_at < ${cutoff}`
    return n
  }
  return 0
}

export async function runDataRetentionPurge(): Promise<PurgeResult[]> {
  const sql = getDb()
  const results: PurgeResult[] = []

  // Load all settings
  const settings = await sql`SELECT * FROM data_retention_settings`.catch(() => [])
  const settingsMap = Object.fromEntries(
    (settings as Array<{ dataset: string; enabled: number; retention_days: number }>)
      .map(s => [s.dataset, s])
  )

  for (const meta of DATASETS) {
    const setting = settingsMap[meta.dataset]
    if (!setting) {
      results.push({ dataset: meta.dataset, purged: 0, skipped: true, reason: 'No settings found' })
      continue
    }
    if (!setting.enabled) {
      results.push({ dataset: meta.dataset, purged: 0, skipped: true, reason: 'Disabled' })
      continue
    }
    if (setting.retention_days === 0) {
      results.push({ dataset: meta.dataset, purged: 0, skipped: true, reason: 'Keep forever (0 days)' })
      continue
    }

    try {
      const purged = await purgeDataset(sql, meta.dataset, setting.retention_days)

      if (purged > 0) {
        log.info({ service: 'data-retention', dataset: meta.dataset, purged }, 'Dataset purged')
      }

      // Update metadata
      await sql`
        UPDATE data_retention_settings
        SET last_purge_at    = ${new Date().toISOString()},
            last_purge_count = ${purged},
            updated_at       = ${new Date().toISOString()}
        WHERE dataset = ${meta.dataset}
      `.catch(() => {})

      results.push({ dataset: meta.dataset, purged, skipped: false })
    } catch (err) {
      log.error({ service: 'data-retention', dataset: meta.dataset, err }, 'Purge failed')
      results.push({ dataset: meta.dataset, purged: 0, skipped: true, reason: String(err) })
    }
  }

  return results
}
