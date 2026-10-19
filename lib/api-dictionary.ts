// lib/api-dictionary.ts
// Pure helpers for the API-source semantic-dictionary auto-describe path. Kept
// free of I/O so the envelope-normalisation and field-collection logic is
// unit-testable: generateApiDraft (app/api/semantic/route.ts) does the call_api
// fetch and feeds the response here.
//
// Why this exists: REST/OData responses come in many envelopes (a bare array,
// OData V4 {value:[]}, OData V2 {d:{results:[]}}, a {data|results|items:[]}
// wrapper, any array-of-objects property, or a single object). To learn an
// endpoint's fields we must normalise all of those to a flat record list, then
// drop transport/metadata noise.

export const API_SAMPLE_RECORDS = 5
export const API_MAX_FIELDS = 120

/** Transport/metadata noise, not business data. */
export function isApiMetaField(k: string): boolean {
  return k === '__metadata' || k === 'uri' || k.startsWith('@') || k === '_capped' || k === '_total' || k === '_returned'
}

// Fields whose presence marks an object as a response ENVELOPE (a wrapper around
// the real records), not a record itself — e.g. FactoryOS's {status,message,data}.
const ENVELOPE_SIBLING = new Set(['status', 'success', 'message', 'code', 'error', 'page', 'total', 'total_records', 'total_pages', 'count', 'fetch_all'])
// Wrapper keys whose value holds the payload (sometimes JSON-stringified).
const PAYLOAD_KEYS = ['data', 'result', 'results', 'payload', 'response', 'body']

// Parse any JSON-stringified payload field in place (shallow copy), so a wrapper
// like {status,message,data:"[{…}]"} or {data:"{\"records\":[…]}"} is navigable.
function coerceJsonPayloads(obj: Record<string, unknown>): Record<string, unknown> {
  const out = { ...obj }
  for (const k of PAYLOAD_KEYS) {
    const v = out[k]
    if (typeof v === 'string') {
      const t = v.trim()
      if (t.startsWith('{') || t.startsWith('[')) { try { out[k] = JSON.parse(t) } catch { /* leave as-is */ } }
    }
  }
  return out
}

/**
 * Normalise whatever call_api returned into a flat list of record objects.
 * Handles a bare array, OData V4 {value:[]}, OData V2 {d:{results:[]}} / {d:{…}},
 * our own {data:[]} cap envelope, any first array-of-objects property, a single
 * object, and nested/stringified envelopes like FactoryOS's
 * {status,message,data:"<json of {records:[…],page,…}>"}. Returns [] when there
 * is nothing object-shaped to sample.
 */
export function extractApiRecords(data: unknown, depth = 0): Record<string, unknown>[] {
  const onlyObjects = (arr: unknown[]) => arr.filter(r => r && typeof r === 'object' && !Array.isArray(r)) as Record<string, unknown>[]
  if (Array.isArray(data)) return onlyObjects(data)
  if (!data || typeof data !== 'object') return []
  const obj = coerceJsonPayloads(data as Record<string, unknown>)
  const d = obj.d as Record<string, unknown> | undefined
  if (d && Array.isArray(d.results)) return onlyObjects(d.results as unknown[])
  for (const key of ['value', 'data', 'results', 'items', 'records', 'rows']) {
    if (Array.isArray(obj[key])) return onlyObjects(obj[key] as unknown[])
  }
  const arrKey = Object.keys(obj).find(k => Array.isArray(obj[k]) && (obj[k] as unknown[]).some(x => x && typeof x === 'object'))
  if (arrKey) return onlyObjects(obj[arrKey] as unknown[])
  // Envelope: records are nested one level down under a payload key. Only recurse
  // when the object looks like a wrapper (has a status/message/pagination sibling),
  // so a genuine record that merely has a `data` field isn't mistaken for one.
  const isEnvelope = Object.keys(obj).some(k => ENVELOPE_SIBLING.has(k))
  if (isEnvelope && depth < 2) {
    for (const key of PAYLOAD_KEYS) {
      if (obj[key] && typeof obj[key] === 'object') {
        const inner = extractApiRecords(obj[key], depth + 1)
        if (inner.length) return inner
      }
    }
  }
  if (d && typeof d === 'object') return [d]
  // A bare envelope with no discoverable records — don't describe the wrapper.
  if (isEnvelope) return []
  return [obj]
}

export interface ApiFieldSample { fields: string[]; sampleRow: Record<string, unknown> }

/**
 * Union top-level fields across the sampled records (metadata dropped), keeping
 * one representative non-null sample value per field, and build a compact sample
 * row (nested values JSON-stringified + truncated) to feed the model.
 */
export function collectApiFields(records: Record<string, unknown>[], maxFields: number = API_MAX_FIELDS): ApiFieldSample {
  const fieldVals = new Map<string, unknown>()
  for (const rec of records) {
    for (const [k, v] of Object.entries(rec)) {
      if (isApiMetaField(k)) continue
      if (!fieldVals.has(k) || (fieldVals.get(k) == null && v != null)) fieldVals.set(k, v)
    }
  }
  const fields = [...fieldVals.keys()].slice(0, maxFields)
  const sampleRow: Record<string, unknown> = {}
  for (const f of fields) {
    const v = fieldVals.get(f)
    sampleRow[f] = v && typeof v === 'object' ? JSON.stringify(v).slice(0, 120) : v
  }
  return { fields, sampleRow }
}
