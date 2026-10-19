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
export const runtime = 'nodejs'

const SOURCE_TYPES = new Set(['database', 'api', 'file', 'prism'])

interface PrismDraftResult { ok: boolean; draft?: DescribeDraftItem[]; error?: string; status?: number }

// How many devices to sample for the telemetry-key vocabulary. PRISM/ThingsBoard
// fleets routinely type every device "default" and spread the key vocabulary
// across devices (one inverter reports kWh/kW, a meter reports v1n, a weather
// station reports slr_rdtn). Sampling one device — or one per type — misses most
// of the dictionary, so we union keys across a broad sample of devices instead.
const PRISM_SAMPLE_DEVICES = 50
const PRISM_VALUE_DEVICES = 10   // devices to pull latest values from (for units inference)
const PRISM_MAX_KEYS = 120

// Introspect a PRISM instance for its telemetry key vocabulary and draft a
// description per key (units-aware). Lists devices, then UNIONS telemetry keys
// across a broad sample of devices (keys are instance-wide but each device only
// reports the subset it emits), pulls latest values from the richest devices for
// units inference, and asks the model to explain the cryptic keys (kWh_sf, v1n,
// mb_error, …). Each key is described once (object_type 'column', object_key =
// the bare key name).
async function generatePrismDraft(sourceId: string): Promise<PrismDraftResult> {
  try {
    const dev = await runTool('query_prism', { instance_id: sourceId, operation: 'devices', page_size: 100 }) as { error?: string; devices?: Array<{ id: string; name: string; type: string }> }
    if (!dev || dev.error) return { ok: false, error: dev?.error || 'Could not list PRISM devices', status: 400 }
    const devices = (dev.devices || []).filter(d => d.id)
    if (!devices.length) return { ok: false, error: 'No devices found on this PRISM instance', status: 400 }

    // Union telemetry keys across a broad device sample. Track per-key device
    // frequency (how many sampled devices report it) so the model gets a hint at
    // how core vs peripheral a key is, and remember which devices are richest so
    // we can pull representative latest values from them.
    const sample = devices.slice(0, PRISM_SAMPLE_DEVICES)
    const keyFreq = new Map<string, number>()
    const deviceKeys: Array<{ id: string; name: string; keys: string[] }> = []
    for (const d of sample) {
      const kr = await runTool('query_prism', { instance_id: sourceId, operation: 'keys', entity_id: d.id, entity_type: 'DEVICE' }) as { keys?: string[] }
      const keys = Array.isArray(kr?.keys) ? kr!.keys! : []
      if (!keys.length) continue
      deviceKeys.push({ id: d.id, name: d.name, keys })
      for (const k of keys) keyFreq.set(k, (keyFreq.get(k) || 0) + 1)
    }
    if (!keyFreq.size) return { ok: false, error: 'No telemetry keys found across this instance\'s devices', status: 400 }

    // Keys sorted by how commonly they appear (most-reported first), capped.
    const allKeys = [...keyFreq.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k).slice(0, PRISM_MAX_KEYS)
    const keySet = new Set(allKeys)

    // Pull latest values from the devices that report the most keys, until every
    // key has at least one representative value (or we run out of budget).
    const sampleVals: Record<string, unknown> = {}
    const richest = [...deviceKeys].sort((a, b) => b.keys.length - a.keys.length).slice(0, PRISM_VALUE_DEVICES)
    for (const d of richest) {
      const want = d.keys.filter(k => keySet.has(k) && !(k in sampleVals))
      if (!want.length) continue
      const lr = await runTool('query_prism', { instance_id: sourceId, operation: 'telemetry_latest', entity_id: d.id, entity_type: 'DEVICE', keys: want.slice(0, 50) }) as { telemetry?: Record<string, { value: unknown }> }
      for (const [k, v] of Object.entries(lr?.telemetry || {})) if (keySet.has(k) && !(k in sampleVals)) sampleVals[k] = v?.value
      if (allKeys.every(k => k in sampleVals)) break
    }

    const lines = allKeys.map(k => `  ${k} (reported by ${keyFreq.get(k)}/${deviceKeys.length} sampled devices)`).join('\n')
    const schemaText = `PRISM IoT telemetry keys — describe each key (object_type "column", object_key = the key name). This is a fleet of ${dev.devices!.length} devices; the keys below are the union of telemetry channels across a sample of them. Infer units from the key name and sample value (e.g. kWh = energy, kW = power, _sf = scaling factor, v1n = phase-to-neutral voltage, slr_rdtn = solar irradiance, mb_error = Modbus error).\nkeys:\n${lines}`
    const samples = { 'latest values': [Object.fromEntries(allKeys.filter(k => k in sampleVals).map(k => [k, sampleVals[k]]))] }
    const result = await describeSchema(schemaText, samples)
    if (!result.ok) return { ok: false, error: result.reason || 'Generation failed', status: 502 }
    // Keys are columns; force the type so a stray "table" from the model doesn't slip in.
    const draft = (result.items || []).map(i => ({ object_type: 'column' as const, object_key: i.object_key, description: i.description }))
    return { ok: true, draft }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'PRISM generate failed', status: 500 }
  }
}

export async function GET(req: Request) {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  const { searchParams } = new URL(req.url)
  const sourceType = searchParams.get('source_type') || 'database'
  const sourceId = searchParams.get('source_id')
  if (!sourceId) return Response.json({ error: 'source_id required' }, { status: 400 })
  const sql = getDb()
  const rows = await sql`
    SELECT object_type, object_key, description, updated_at
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
        if (gen.ok) return Response.json({ draft: gen.draft ?? [] })
        return Response.json({ error: gen.error || 'Generation failed' }, { status: gen.status || 500 })
      }
      // database (default)
      const schema = await getOrFetchSchema(source_id)
      if (!schema || schema.error) {
        return Response.json({ error: schema?.error || 'Schema not available for this source' }, { status: 400 })
      }
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
        if (!objectKey) continue
        if (!description) {
          // Empty description clears the entry rather than storing a blank.
          await sql`DELETE FROM semantic_descriptions WHERE source_type=${source_type} AND source_id=${source_id} AND object_key=${objectKey}`
          continue
        }
        await sql`
          INSERT INTO semantic_descriptions (source_type, source_id, object_type, object_key, description, created_by, updated_at)
          VALUES (${source_type}, ${source_id}, ${objectType}, ${objectKey}, ${description}, ${session.id}, ${nowExpr()})
          ON CONFLICT(source_type, source_id, object_key)
          DO UPDATE SET description=${description}, object_type=${objectType}, updated_at=${nowExpr()}`
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
