// lib/cross-source.ts
// Phase 3: cross-source composed measures. Base measures live in different sources
// (MES DB, PRISM, an API); they are made comparable by a CONFORMED DIMENSION — a
// logical entity (Asset, Line, Shift) whose per-source key columns are declared in a
// crosswalk. This module aligns per-source (already-aggregated) rows on the conformed
// entity (+ time bucket) and computes a formula over the bases.
//
// Deterministic + pure (no DB, no eval). At scale the actual join routes through the
// existing DuckDB combineSources; this is the semantic resolution + formula layer.
import { bucketTime, type Grain } from './semantic-rollup'

// ---- Safe arithmetic formula evaluator (+ - * / parentheses, identifiers) ----
// No eval/Function. Returns null on divide-by-zero or an undefined/non-numeric var.
type Tok = { t: 'num' | 'id' | 'op' | 'lp' | 'rp'; v: string }
function tokenize(s: string): Tok[] {
  const toks: Tok[] = []
  const re = /\s*([0-9]*\.?[0-9]+|[A-Za-z_][A-Za-z0-9_]*|[-+*/()])/y
  let m: RegExpExecArray | null
  let i = 0
  while (i < s.length) {
    re.lastIndex = i
    m = re.exec(s)
    if (!m) throw new Error(`bad formula at: ${s.slice(i)}`)
    i = re.lastIndex
    const v = m[1]
    if (/^[0-9]/.test(v) || v.includes('.') && /[0-9]/.test(v)) toks.push({ t: 'num', v })
    else if (/^[A-Za-z_]/.test(v)) toks.push({ t: 'id', v })
    else if (v === '(') toks.push({ t: 'lp', v })
    else if (v === ')') toks.push({ t: 'rp', v })
    else toks.push({ t: 'op', v })
  }
  return toks
}
export function evalFormula(expr: string, vars: Record<string, number | null | undefined>): number | null {
  let toks: Tok[]
  try { toks = tokenize(expr) } catch { return null }
  let pos = 0
  const peek = () => toks[pos]
  const eat = () => toks[pos++]
  let bad = false
  // expr := term (('+'|'-') term)* ; term := factor (('*'|'/') factor)* ; factor := num|id|'(' expr ')'
  function factor(): number {
    const tk = peek()
    if (!tk) { bad = true; return 0 }
    if (tk.t === 'lp') { eat(); const v = expression(); if (peek()?.t === 'rp') eat(); else bad = true; return v }
    if (tk.t === 'num') { eat(); return Number(tk.v) }
    if (tk.t === 'id') { eat(); const v = vars[tk.v]; if (v == null || !isFinite(Number(v))) { bad = true; return 0 } return Number(v) }
    if (tk.t === 'op' && tk.v === '-') { eat(); return -factor() }
    bad = true; return 0
  }
  function term(): number {
    let v = factor()
    while (peek()?.t === 'op' && (peek()!.v === '*' || peek()!.v === '/')) {
      const op = eat().v; const r = factor()
      if (op === '*') v *= r
      else { if (r === 0) { bad = true; return 0 } v /= r }
    }
    return v
  }
  function expression(): number {
    let v = term()
    while (peek()?.t === 'op' && (peek()!.v === '+' || peek()!.v === '-')) {
      const op = eat().v; const r = term()
      v = op === '+' ? v + r : v - r
    }
    return v
  }
  const result = expression()
  if (bad || pos !== toks.length || !isFinite(result)) return null
  return result
}

// Identifiers referenced by a formula (its base aliases). Empty on parse failure.
export function formulaVars(expr: string): string[] {
  try {
    const ids = new Set<string>()
    for (const t of tokenize(expr)) if (t.t === 'id') ids.add(t.v)
    return [...ids]
  } catch { return [] }
}

// ---- Definitions + verification gate --------------------------------------

export interface BaseRef { source_type: string; source_id: string; column: string; agg?: string }
export interface CrossMeasureDef { name: string; entity: string; grain?: string | null; formula: string; bases: Record<string, BaseRef> }

export interface CrossMeasureValidation { ok: boolean; unverified: string[]; missing: string[]; badFormula: boolean; unknownVars: string[] }

// A cross-source measure may compose only VERIFIED base fields — a wrong auto-label
// compounds across sources. Also checks the formula parses and references only
// declared base aliases. statusLookup returns a field's semantic status or null if
// the field has no semantic record.
export function validateCrossMeasure(
  def: CrossMeasureDef,
  statusLookup: (st: string, sid: string, column: string) => string | null,
): CrossMeasureValidation {
  const unverified: string[] = []
  const missing: string[] = []
  for (const [alias, b] of Object.entries(def.bases)) {
    const s = statusLookup(b.source_type, b.source_id, b.column)
    if (s == null) missing.push(alias)
    else if (s !== 'verified') unverified.push(alias)
  }
  // Formula must parse and reference only declared aliases.
  const vars = formulaVars(def.formula)
  const ones: Record<string, number> = {}
  for (const a of Object.keys(def.bases)) ones[a] = 1
  const parses = def.formula.trim().length > 0 && evalFormula(def.formula, ones) != null
  const unknownVars = vars.filter(v => !(v in def.bases))
  const badFormula = !parses || unknownVars.length > 0
  return { ok: unverified.length === 0 && missing.length === 0 && !badFormula, unverified, missing, badFormula, unknownVars }
}

// Hierarchy: next-coarser / next-finer level for drill navigation (Phase 7b enabler).
export function parseLevels(levelsJson: string | null | undefined): string[] {
  if (!levelsJson) return []
  try { const a = JSON.parse(levelsJson); return Array.isArray(a) ? a.map(String) : [] } catch { return [] }
}
export function drillTo(levels: string[], current: string, dir: 'up' | 'down'): string | null {
  const i = levels.indexOf(current)
  if (i < 0) return null
  const j = dir === 'down' ? i + 1 : i - 1
  return j >= 0 && j < levels.length ? levels[j] : null
}

// ---- Federation -----------------------------------------------------------

export interface BaseSeries {
  rows: Record<string, unknown>[]
  keyCol: string          // the source's conformed-dimension key column (crosswalk)
  valueCol: string        // the measure value column (already aggregated for its grain)
  timeCol?: string        // optional time column to align on
}
export interface FederateOpts { grain?: Grain; formula?: string; entityName?: string; timeName?: string }

// Align bases on (entity[, time bucket]) and compute. Output rows carry the entity,
// optional time, each base alias's value, and `value` = formula(aliases) when given.
export function federate(bases: Record<string, BaseSeries>, opts: FederateOpts = {}): Record<string, unknown>[] {
  const aliases = Object.keys(bases)
  const entityName = opts.entityName || 'entity'
  const timeName = opts.timeName || 'time'
  const useTime = aliases.some(a => bases[a].timeCol)
  // key -> { entity, time, values{alias:number} }
  const combined = new Map<string, { entity: string; time?: string; values: Record<string, number> }>()
  for (const alias of aliases) {
    const b = bases[alias]
    for (const r of b.rows) {
      const entity = String(r[b.keyCol] ?? '')
      const time = b.timeCol != null ? (opts.grain ? bucketTime(r[b.timeCol], opts.grain) : String(r[b.timeCol])) : undefined
      const k = entity + '\u0000' + (time ?? '')
      let g = combined.get(k)
      if (!g) { g = { entity, time, values: {} }; combined.set(k, g) }
      const v = Number(r[b.valueCol])
      if (isFinite(v)) g.values[alias] = v
    }
  }
  const out: Record<string, unknown>[] = []
  for (const g of combined.values()) {
    const row: Record<string, unknown> = { [entityName]: g.entity }
    if (useTime) row[timeName] = g.time
    for (const a of aliases) row[a] = g.values[a] ?? null
    if (opts.formula) row.value = evalFormula(opts.formula, g.values)
    out.push(row)
  }
  out.sort((a, b) => {
    const e = String(a[entityName]).localeCompare(String(b[entityName]))
    if (e !== 0) return e
    return String(a[timeName] ?? '').localeCompare(String(b[timeName] ?? ''))
  })
  return out
}
