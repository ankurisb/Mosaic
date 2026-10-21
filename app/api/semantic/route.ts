// app/api/semantic/route.ts
// Semantic schema dictionary — CRUD + AI auto-describe (propose→confirm).
//   GET  ?source_type=&source_id=          -> list stored descriptions for a source
//   POST { action: 'generate', source_type, source_id }
//                                            -> DRAFT descriptions (not saved)
//   POST { action: 'upsert', source_type, source_id, items:[{object_type,object_key,description}] }
//   POST { action: 'delete', source_type, source_id, object_key }   (or {all:true})
//
// Reads are allowed for any signed-in user (so chat/PanelBuilder can rely on them);
// writes + generate are admin-only, mirroring datasource configuration.
import { getSession } from '@/lib/auth'
import { getDb, nowExpr } from '@/lib/db'
import { log } from '@/lib/logger'
import { getOrFetchSchema, formatSchemaForPrompt, runTool } from '@/lib/tools'
import { describeSchema, type DescribeDraftItem } from '@/lib/ai/describe-schema'
import { sanitizeDescription, MAX_KEY_LEN, MAX_ITEMS_PER_UPSERT } from '@/lib/semantic'
import { coerceStructured, hasStructured } from '@/lib/semantic-model'
import { getSemanticHealth, computeFingerprint, recordFingerprint } from '@/lib/semantic-drift'
import { getSemanticModel } from '@/lib/semantic-model'
import { generateCubeSchema, renderAllCubes } from '@/lib/cube-schema'
import {
  planPrismSample, assessPrismCoverage, summarizePrismDraft,
  PRISM_SAMPLE_DEVICES, type DeviceKeyResult, type PrismDiagnostics,
} from '@/lib/prism-dictionary'
import { extractApiRecords, collectApiFields, API_SAMPLE_RECORDS } from '@/lib/api-dictionary'
export const runtime = 'nodejs'

const SOURCE_TYPES = new Set(['database', 'api', 'file', 'prism'])

interface PrismDraftResult {
  ok: boolean
  draft?: DescribeDraftItem[]
  diagnostics?: PrismDiagnostics
  summary?: string
  warning?: string
  error?: string
  status?: number
}

// Run an async mapper over items with bounded concurrency — keeps the describe
// run responsive against a laggy on-prem gateway without stampeding it.
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]) }
  })
  await Promise.all(workers)
  return out
}

const PRISM_KEY_CONCURRENCY = 6   // in-flight key/value fetches against the gateway

// Introspect a PRISM instance for its telemetry key vocabulary and draft a
// description per key (units-aware). Lists devices, then UNIONS telemetry keys
// across a broad sample of devices (keys are instance-wide but each device only
// reports the subset it emits — a fleet typed entirely "default" spreads the
// vocabulary across devices), pulls latest values from the richest devices for
// units inference, and asks the model to explain the cryptic keys (kWh_sf, v1n,
// mb_error, …). Each key is described once (object_type 'column', object_key =
// the bare key name).
//
// Every exit carries an actionable reason: an unreachable instance, an empty
// fleet, devices erroring on key-listing (auth/connectivity), or devices with no
// timeseries yet are each reported distinctly so the user knows what to fix. On
// success the result carries diagnostics + a one-line summary so the user can
// judge coverage/confidence before saving.
async function generatePrismDraft(sourceId: string): Promise<PrismDraftResult> {
  try {
    const dev = await runTool('query_prism', { instance_id: sourceId, operation: 'devices', page_size: 100 }) as { error?: string; devices?: Array<{ id: string; name: string; type: string }>; total?: number }
    if (!dev || dev.error) {
      return { ok: false, status: 502,
        error: `Couldn't reach PRISM to list devices: ${dev?.error || 'no response'}. Open Settings → PRISM and use "Test connection", then retry.` }
    }
    const devices = (dev.devices || []).filter(d => d.id)
    const fleetSize = typeof dev.total === 'number' ? dev.total : devices.length

    // List telemetry keys for a broad device sample, capturing per-device errors
    // (so an all-errors result can be diagnosed as auth/connectivity, not "no data").
    const sample = devices.slice(0, PRISM_SAMPLE_DEVICES)
    const results: DeviceKeyResult[] = await mapPool(sample, PRISM_KEY_CONCURRENCY, async (d) => {
      try {
        const kr = await runTool('query_prism', { instance_id: sourceId, operation: 'keys', entity_id: d.id, entity_type: 'DEVICE' }) as { keys?: string[]; error?: string }
        if (kr?.error) return { id: d.id, name: d.name, error: kr.error }
        return { id: d.id, name: d.name, keys: Array.isArray(kr?.keys) ? kr!.keys! : [] }
      } catch (e) {
        return { id: d.id, name: d.name, error: e instanceof Error ? e.message : 'keys fetch failed' }
      }
    })

    const plan = planPrismSample(results)
    const errExample = results.find(r => r.error)?.error
    const coverage = assessPrismCoverage(fleetSize, plan, errExample)
    if (!coverage.proceed) return { ok: false, error: coverage.message, status: 422 }

    // Pull latest values from the richest devices for units inference (best-effort).
    const keySet = new Set(plan.keys)
    const byId = new Map(results.filter(r => r.keys?.length).map(r => [r.id, r]))
    const sampleVals: Record<string, unknown> = {}
    for (const id of plan.valueDeviceIds) {
      const want = (byId.get(id)?.keys || []).filter(k => keySet.has(k) && !(k in sampleVals))
      if (!want.length) continue
      try {
        const lr = await runTool('query_prism', { instance_id: sourceId, operation: 'telemetry_latest', entity_id: id, entity_type: 'DEVICE', keys: want.slice(0, 50) }) as { telemetry?: Record<string, { value: unknown }> }
        for (const [k, v] of Object.entries(lr?.telemetry || {})) if (keySet.has(k) && !(k in sampleVals)) sampleVals[k] = v?.value
      } catch { /* values are optional — the model can infer from the key name */ }
      if (plan.keys.every(k => k in sampleVals)) break
    }

    const lines = plan.keys.map(k => `  ${k} (reported by ${plan.keyFreq[k]}/${plan.devicesWithKeys} sampled devices)`).join('\n')
    const schemaText = `PRISM IoT telemetry keys — describe each key (object_type "column", object_key = the key name). This is a fleet of ${fleetSize} devices; the keys below are the union of telemetry channels across a sample of them. Infer units from the key name and sample value (e.g. kWh = energy, kW = power, _sf = scaling factor, v1n = phase-to-neutral voltage, slr_rdtn = solar irradiance, mb_error = Modbus error).\nkeys:\n${lines}`
    const samples = { 'latest values': [Object.fromEntries(plan.keys.filter(k => k in sampleVals).map(k => [k, sampleVals[k]]))] }
    const result = await describeSchema(schemaText, samples)
    if (!result.ok) {
      return { ok: false, status: 502,
        error: `The AI draft step failed: ${result.reason || 'unknown error'}. The telemetry keys were read successfully — retry, or check the Anthropic API key in Settings.` }
    }
    // Keys are columns; force the type so a stray "table" from the model doesn't slip in.
    const draft = (result.items || []).map(i => ({ object_type: 'column' as const, object_key: i.object_key, description: i.description }))
    const diagnostics: PrismDiagnostics = {
      fleet_size: fleetSize,
      devices_sampled: plan.devicesAttempted,
      devices_with_keys: plan.devicesWithKeys,
      devices_errored: plan.devicesErrored,
      distinct_keys: plan.keys.length,
      keys_with_values: plan.keys.filter(k => k in sampleVals).length,
      keys_described: draft.length,
      coverage_status: coverage.status,
    }
    return { ok: true, draft, diagnostics, summary: summarizePrismDraft(diagnostics), warning: coverage.status === 'sparse' ? coverage.message : undefined }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'PRISM generate failed', status: 500 }
  }
}

// -- API source auto-describe -------------------------------------------------
interface ApiDraftResult {
  ok: boolean
  draft?: DescribeDraftItem[]
  summary?: string
  error?: string
  status?: number
}

// Introspect an API connection: fetch a sample of records, union their field
// names, and ask the model to describe the non-obvious ones. object_key = the
// field name, object_type 'column'. Every exit carries an actionable reason.
async function generateApiDraft(connectionId: string): Promise<ApiDraftResult> {
  let basePath = connectionId
  try {
    const sql = getDb()
    const rows = await sql`SELECT base_path FROM api_connections WHERE id = ${connectionId}` as unknown as Array<{ base_path?: string }>
    if (rows.length && rows[0].base_path) basePath = rows[0].base_path
  } catch { /* best-effort — label only */ }

  let data: unknown
  try {
    data = await runTool('call_api', { connection_id: connectionId, method: 'GET', path: '' })
  } catch (e) {
    return { ok: false, status: 502,
      error: `Couldn't fetch a sample record from "${basePath}": ${e instanceof Error ? e.message : 'request failed'}. Open Settings → APIs and use "Test", then retry.` }
  }
  if (data && typeof data === 'object' && 'error' in (data as Record<string, unknown>)) {
    return { ok: false, status: 502,
      error: `The API returned an error while sampling "${basePath}": ${String((data as Record<string, unknown>).error)}. Check the connection in Settings → APIs, then retry.` }
  }

  const records = extractApiRecords(data).slice(0, API_SAMPLE_RECORDS)
  if (!records.length) {
    return { ok: false, status: 422,
      error: `The API responded but returned no records to sample from "${basePath}". Point the connection at an endpoint that lists records (a collection path), then retry.` }
  }

  const { fields, sampleRow } = collectApiFields(records)
  if (!fields.length) {
    return { ok: false, status: 422,
      error: `Sampled ${records.length} record(s) from "${basePath}" but found no describable fields. Retry, or point at a different endpoint.` }
  }

  const lines = fields.map(f => `  ${f}`).join('\n')
  const schemaText = `API record fields from "${basePath}" — describe each field (object_type "column", object_key = the field name). These are the fields of one record returned by this API connection. Infer meaning and units from the field name and sample value; skip obvious ones (id, name, created_at).\nfields:\n${lines}`
  const result = await describeSchema(schemaText, { 'sample record': [sampleRow] })
  if (!result.ok) {
    return { ok: false, status: 502,
      error: `The AI draft step failed: ${result.reason || 'unknown error'}. The sample record was fetched fine — retry, or check the Anthropic API key in Settings.` }
  }
  const draft = (result.items || []).map(i => ({ object_type: 'column' as const, object_key: i.object_key, description: i.description }))
  const summary = `Described ${draft.length} of ${fields.length} field(s) from a sample of ${records.length} record(s) on "${basePath}".`
  return { ok: true, draft, summary }
}

export async function GET(req: Request) {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  const { searchParams } = new URL(req.url)
  const sourceType = searchParams.get('source_type') || 'database'
  const sourceId = searchParams.get('source_id')
  if (!sourceId) return Response.json({ error: 'source_id required' }, { status: 400 })

  // Health view: coverage/verification summary for the semantic model of this source.
  if (searchParams.get('view') === 'health') {
    const n = Number(searchParams.get('schema_fields'))
    const health = await getSemanticHealth(sourceType, sourceId, isFinite(n) && n > 0 ? n : undefined)
    return Response.json({ health })
  }

  // Cube view: generate the Cube (cube.dev) data model from the structured semantic
  // model, for DB sources that will be queried through Cube (Phase 5).
  if (searchParams.get('view') === 'cube') {
    const model = await getSemanticModel(sourceType, sourceId)
    const cubes = generateCubeSchema([...model.byKey.values()])
    return Response.json({ cubes, cube_js: renderAllCubes(cubes) })
  }

  const sql = getDb()
  const rows = await sql`
    SELECT object_type, object_key, description, updated_at,
           role, data_type, unit, default_aggregation, additivity, accumulation, time_grain, status, confidence
    FROM   semantic_descriptions
    WHERE  source_type = ${sourceType} AND source_id = ${sourceId}
    ORDER  BY object_type DESC, object_key`
  return Response.json({ descriptions: rows })
}

export async function POST(req: Request) {
  try {
    const session = await getSession()
    if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
    if (session.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 })
    const sql = getDb()
    const body = await req.json()
    const { action, source_type = 'database', source_id } = body
    if (!source_id) return Response.json({ error: 'source_id required' }, { status: 400 })
    if (!SOURCE_TYPES.has(source_type)) return Response.json({ error: `source_type must be one of: ${[...SOURCE_TYPES].join(', ')}` }, { status: 400 })

    // -- GENERATE: propose descriptions from real schema + samples (not saved) ----
    if (action === 'generate') {
      if (source_type === 'prism') {
        const gen = await generatePrismDraft(source_id)
        if (gen.ok) return Response.json({ draft: gen.draft ?? [], diagnostics: gen.diagnostics, summary: gen.summary, warning: gen.warning })
        return Response.json({ error: gen.error || 'Generation failed' }, { status: gen.status || 500 })
      }
      if (source_type === 'api') {
        const gen = await generateApiDraft(source_id)
        if (gen.ok) return Response.json({ draft: gen.draft ?? [], summary: gen.summary })
        return Response.json({ error: gen.error || 'Generation failed' }, { status: gen.status || 500 })
      }
      // database (default)
      const schema = await getOrFetchSchema(source_id)
      if (!schema || schema.error) {
        return Response.json({ error: schema?.error || 'Schema not available for this source' }, { status: 400 })
      }
      // Record a schema fingerprint so drift can be detected on the next introspect.
      try {
        const fields: Array<{ object_key: string; data_type: string }> = []
        for (const t of (schema.tables || []) as Array<Record<string, unknown>>) {
          const tn = t.schema && t.schema !== 'public' ? `${t.schema}.${t.name}` : String(t.name)
          for (const c of ((t.columns as Array<Record<string, unknown>>) || [])) {
            fields.push({ object_key: `${tn}.${c.name ?? c.column_name}`, data_type: String(c.type ?? c.data_type ?? '') })
          }
        }
        if (fields.length) await recordFingerprint('database', source_id, computeFingerprint(fields))
      } catch { /* best-effort */ }
      // Sample a few rows from up to 6 tables — same approach as schema-preview.
      const tables = (schema.tables || []).slice(0, 6)
      const samples: Record<string, unknown[]> = {}
      await Promise.all(tables.map(async t => {
        try {
          const name = t.schema && t.schema !== 'public' ? `${t.schema}.${t.name}` : t.name
          const r = await runTool('query_database', { connection_id: source_id, sql: `SELECT * FROM ${name} LIMIT 3` }) as { rows?: unknown[] } | null
          if (r?.rows?.length) samples[name] = r.rows
        } catch { /* skip tables that error */ }
      }))
      const schemaText = formatSchemaForPrompt(schema, { maxChars: 6000 })
      const result = await describeSchema(schemaText, samples)
      if (!result.ok) return Response.json({ error: result.reason || 'Generation failed' }, { status: 502 })
      return Response.json({ draft: result.items ?? [] })
    }

    // -- UPSERT: save confirmed/edited descriptions -------------------------------
    if (action === 'upsert') {
      const items = Array.isArray(body.items) ? body.items : []
      if (items.length > MAX_ITEMS_PER_UPSERT) {
        return Response.json({ error: `too many items (${items.length}); max ${MAX_ITEMS_PER_UPSERT} per call` }, { status: 400 })
      }
      // Reject an over-long key outright (a real table.column key is never this long) —
      // surfaces a bug rather than silently storing junk.
      const badKey = items.find((it: { object_key?: unknown }) => String(it?.object_key || '').trim().length > MAX_KEY_LEN)
      if (badKey) return Response.json({ error: `object_key exceeds ${MAX_KEY_LEN} chars` }, { status: 400 })
      let saved = 0
      for (const it of items) {
        const objectType = it.object_type === 'column' ? 'column' : 'table'
        const objectKey = String(it.object_key || '').trim()
        const description = sanitizeDescription(String(it.description || ''))  // bounded, single-line, control-stripped
        const s = coerceStructured(it)   // validated structured fields (role/unit/aggregation/accumulation/…)
        if (!objectKey) continue
        if (!description && !hasStructured(s)) {
          // Nothing to store (no description and no structured fields) → clear the entry.
          await sql`DELETE FROM semantic_descriptions WHERE source_type=${source_type} AND source_id=${source_id} AND object_key=${objectKey}`
          continue
        }
        await sql`
          INSERT INTO semantic_descriptions
            (source_type, source_id, object_type, object_key, description,
             role, data_type, unit, default_aggregation, additivity, accumulation, time_grain, status, confidence, evidence,
             created_by, updated_at)
          VALUES
            (${source_type}, ${source_id}, ${objectType}, ${objectKey}, ${description},
             ${s.role}, ${s.data_type}, ${s.unit}, ${s.default_aggregation}, ${s.additivity}, ${s.accumulation}, ${s.time_grain}, ${s.status}, ${s.confidence}, ${s.evidence},
             ${session.id}, ${nowExpr()})
          ON CONFLICT(source_type, source_id, object_key)
          DO UPDATE SET description=${description}, object_type=${objectType},
             role=${s.role}, data_type=${s.data_type}, unit=${s.unit}, default_aggregation=${s.default_aggregation},
             additivity=${s.additivity}, accumulation=${s.accumulation}, time_grain=${s.time_grain},
             status=${s.status}, confidence=${s.confidence}, evidence=${s.evidence}, updated_at=${nowExpr()}`
        saved++
      }
      return Response.json({ ok: true, saved })
    }

    // -- DELETE: one key, or all for the source -----------------------------------
    if (action === 'delete') {
      if (body.all === true) {
        await sql`DELETE FROM semantic_descriptions WHERE source_type=${source_type} AND source_id=${source_id}`
        return Response.json({ ok: true })
      }
      const objectKey = String(body.object_key || '').trim()
      if (!objectKey) return Response.json({ error: 'object_key required' }, { status: 400 })
      await sql`DELETE FROM semantic_descriptions WHERE source_type=${source_type} AND source_id=${source_id} AND object_key=${objectKey}`
      return Response.json({ ok: true })
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    log.error({ service: 'api_semantic', err }, 'POST /api/semantic failed')
    return Response.json({ error: (err as Error).message }, { status: 500 })
  }
}
