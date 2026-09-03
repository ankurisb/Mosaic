// lib/condition-eval.ts
// Extract the value(s) a rule condition compares, from whatever an API or DB tool
// returned, and evaluate the operator across them. Handles the realistic universe of
// API response shapes so a condition like "field > threshold" works whether the API
// returns a flat object, an array, or a data-path-wrapped envelope (OData, etc.).

// Follow a dot-path like "d.results" or "data.items" into an object. Returns the
// value at the path, or undefined if any segment is missing.
function atPath(obj: unknown, path: string): unknown {
  if (!path) return obj
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key]
    }
    return undefined
  }, obj)
}

// Common wrapper keys that hold the data array/object across popular API conventions.
const WRAPPER_KEYS = ['rows', 'data', 'results', 'value', 'items', 'records', 'd']

/**
 * Turn a raw tool response into an array of candidate row objects to read `field`
 * from. Two-tier:
 *   1. If `dataPath` is configured (the connection's pagination_data_path), follow it
 *      — the user has told us exactly where the data lives, so any shape works.
 *   2. Otherwise auto-detect: unwrap the response through common wrapper keys until we
 *      reach an array or a plain object, so the common shapes work without config.
 * Always returns an array (possibly of one object, possibly empty).
 */
export function extractRows(data: unknown, dataPath?: string): Record<string, unknown>[] {
  let node: unknown = data

  // Tier 1: explicit configured path.
  if (dataPath) {
    const found = atPath(data, dataPath)
    if (found !== undefined) node = found
  } else {
    // Tier 2: auto-detect. Peel known wrapper keys (e.g. {d:{results:[…]}} ->
    // {results:[…]} -> [...]) until we hit an array or a non-wrapper object. Bounded
    // depth so a pathological response can't loop.
    for (let depth = 0; depth < 6; depth++) {
      if (Array.isArray(node)) break
      if (node && typeof node === 'object') {
        const obj = node as Record<string, unknown>
        const wrapper = WRAPPER_KEYS.find(k => k in obj && obj[k] && typeof obj[k] === 'object')
        if (wrapper) { node = obj[wrapper]; continue }
      }
      break
    }
  }

  if (Array.isArray(node)) return node.filter(r => r && typeof r === 'object') as Record<string, unknown>[]
  if (node && typeof node === 'object') return [node as Record<string, unknown>]
  // A bare scalar (e.g. the API returned just `42`) becomes a one-row object under a
  // synthetic key so field-less conditions can still read "the value".
  if (node !== undefined && node !== null) return [{ value: node } as Record<string, unknown>]
  return []
}

// Read the comparison number from a row: the named field if present, else the row's
// first value (matches the legacy behaviour). Coerces strings like "500.000" -> 500.
export function readFieldValue(row: Record<string, unknown>, field: string): number | null {
  const raw = (field && field in row) ? row[field] : row[Object.keys(row)[0]]
  if (raw === null || raw === undefined || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

export type CompareOp = '<' | '<=' | '>' | '>=' | '==' | '!='

export function compare(value: number, op: CompareOp, threshold: number): boolean {
  switch (op) {
    case '<':  return value <  threshold
    case '<=': return value <= threshold
    case '>':  return value >  threshold
    case '>=': return value >= threshold
    case '==': return value === threshold
    case '!=': return value !== threshold
    default:   return false
  }
}

export interface ConditionResult {
  met: boolean
  matchedValue: number | null   // the value that decided it (for the run snapshot)
  rowsChecked: number
}

/**
 * Evaluate a condition over the extracted rows.
 *  - matchMode 'first' : compare the first row's field (default, back-compatible).
 *  - matchMode 'any'   : condition is met if ANY row satisfies it (e.g. "alert if any
 *                        machine's oee < 70"); reports the first matching value.
 */
export function evaluateCondition(
  rows: Record<string, unknown>[],
  field: string,
  op: CompareOp,
  threshold: number,
  matchMode: 'first' | 'any' = 'first',
): ConditionResult {
  if (rows.length === 0) return { met: false, matchedValue: null, rowsChecked: 0 }

  if (matchMode === 'any') {
    for (const row of rows) {
      const v = readFieldValue(row, field)
      if (v !== null && compare(v, op, threshold)) {
        return { met: true, matchedValue: v, rowsChecked: rows.length }
      }
    }
    // none matched — report the first row's value for context
    return { met: false, matchedValue: readFieldValue(rows[0], field), rowsChecked: rows.length }
  }

  const v = readFieldValue(rows[0], field)
  return { met: v !== null && compare(v, op, threshold), matchedValue: v, rowsChecked: rows.length }
}
