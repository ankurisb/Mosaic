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

/**
 * Normalise whatever call_api returned into a flat list of record objects.
 * Handles a bare array, OData V4 {value:[]}, OData V2 {d:{results:[]}} / {d:{…}},
 * our own {data:[]} cap envelope, any first array-of-objects property, or a
 * single object. Returns [] when there is nothing object-shaped to sample.
 */
export function extractApiRecords(data: unknown): Record<string, unknown>[] {
  const onlyObjects = (arr: unknown[]) => arr.filter(r => r && typeof r === 'object' && !Array.isArray(r)) as Record<string, unknown>[]
  if (Array.isArray(data)) return onlyObjects(data)
  if (!data || typeof data !== 'object') return []
  const obj = data as Record<string, unknown>
  const d = obj.d as Record<string, unknown> | undefined
  if (d && Array.isArray(d.results)) return onlyObjects(d.results as unknown[])
  for (const key of ['value', 'data', 'results', 'items']) {
    if (Array.isArray(obj[key])) return onlyObjects(obj[key] as unknown[])
  }
  const arrKey = Object.keys(obj).find(k => Array.isArray(obj[k]) && (obj[k] as unknown[]).some(x => x && typeof x === 'object'))
  if (arrKey) return onlyObjects(obj[arrKey] as unknown[])
  if (d && typeof d === 'object') return [d]
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
