/**
 * Mosaic usage metering — OpenMeter integration.
 *
 * Emits structured CloudEvents to OpenMeter for every billable action:
 *   - chat_completion  AI completion (tokens consumed, model, cost)
 *   - tool_call        Individual tool invocation (tool name, source type)
 *   - rca_run          Root cause analysis workflow execution
 *   - prism_query      Prism IoT platform query
 *   - db_query         Database query via query_database tool
 *   - file_read        File server read via read_file_server tool
 *   - api_call         REST API call via call_api tool
 *
 * Event shape follows CloudEvents 1.0 spec which OpenMeter expects:
 *   {
 *     specversion: "1.0",
 *     id:          uuid,
 *     source:      "mosaic",
 *     type:        "chat_completion" | "tool_call" | ...,
 *     subject:     user_id  (the billable entity — becomes tenant_id later),
 *     time:        ISO timestamp,
 *     data: {
 *       model, input_tokens, output_tokens, cost_usd,  // AI events
 *       tool_name, source_type,                         // tool events
 *       conversation_id, latency_ms,                    // all events
 *     }
 *   }
 *
 * All calls are fire-and-forget. If OpenMeter is down:
 *   - The error is logged but never thrown
 *   - The chat request succeeds normally
 *   - usage_events in SQLite still captures everything as fallback
 *
 * When you're ready to add Lago for invoicing, point Lago at OpenMeter's
 * query API — no changes needed here.
 */

import { randomUUID } from 'crypto'

// OpenMeter CloudEvent types — each maps to a meter in OpenMeter config
export type MeterEventType =
  | 'chat_completion'
  | 'tool_call'
  | 'rca_run'
  | 'prism_query'
  | 'db_query'
  | 'file_read'
  | 'api_call'

export interface MeteringEventData {
  // Present on all events
  conversation_id?: string
  latency_ms?: number
  // AI completion events
  model?: string
  input_tokens?: number
  output_tokens?: number
  cache_read_tokens?: number
  cache_write_tokens?: number
  cost_usd?: number
  // Tool call events
  tool_name?: string
  source_type?: 'database' | 'api' | 'file_server' | 'prism' | 'web_search' | 'stats'
  source_id?: string
  // Aggregates (on chat_completion: how many tools fired this turn)
  tool_calls_count?: number
  tool_types?: string[]   // e.g. ["query_database","query_prism"]
}

/**
 * Emit a metering event to OpenMeter. Fire-and-forget — never blocks.
 * subject is the user_id today; becomes tenant_id when multi-tenant billing lands.
 */
export async function emitEvent(
  subject: string,
  type: MeterEventType,
  data: MeteringEventData
): Promise<void> {
  const url = process.env.OPENMETER_URL
  if (!url) return  // OpenMeter not configured — silently skip

  const event = {
    specversion: '1.0',
    id: randomUUID(),
    source: 'mosaic',
    type: `mosaic.${type}`,
    subject,
    time: new Date().toISOString(),
    datacontenttype: 'application/json',
    data,
  }

  // Uses console not Pino — Pino's worker thread is torn down by Next.js before
  // this runs in streaming routes, which causes crashes if log.* is called here.
  try {
    const res = await fetch(`${url}/api/v1/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/cloudevents+json' },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(3000),
    })
    console.log('[metering] OpenMeter response:', res.status, res.statusText)
  } catch (err: unknown) {
    console.warn('[metering] OpenMeter emit failed:', err instanceof Error ? err.message : String(err))
  }
}

/**
 * Convenience: emit one tool_call event per tool invocation.
 * Called from runTool() in lib/tools.ts for per-call granularity.
 */
export function emitToolCall(
  subject: string,
  toolName: string,
  sourceType: MeteringEventData['source_type'],
  extras: { conversation_id?: string; source_id?: string; latency_ms?: number } = {}
): void {
  emitEvent(subject, 'tool_call', {
    tool_name: toolName,
    source_type: sourceType,
    ...extras,
  })
}
