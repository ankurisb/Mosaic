// lib/dashboard-readiness.ts
// Readiness gate for the dashboard builder: a panel is only "ready" to be created when it
// is deterministically buildable — shape valid, read-only, grounded (referenced keys/fields
// exist), executable AND non-empty in the preview, and (for a multi-entity source) scoped to
// a device. Not-ready panels block creation and return specific gaps the chat uses to
// interrogate the user, so dashboards don't get built on hallucinated columns or
// under-specified requests. Pure + unit-tested; the caller supplies the dry-run result and
// the known key/field sets.

export type PanelClass = 'data' | 'empty' | 'error' | 'invalid'

export interface ReadinessInput {
  sourceType: string
  cls: PanelClass               // dry-run classification (executability)
  detail?: string               // dry-run error/shape detail
  // Grounding: the source's known column/key/field names (lowercased). Empty/undefined =
  // grounding not available for this source → skipped (dry-run still gates).
  knownRefs?: string[]
  // References the panel actually uses (lowercased): PRISM keys, API $select/$filter fields.
  usedRefs?: string[]
  // Entity scope (Phase 9): is the source multi-entity, and did the panel declare a scope
  // ({{entity_id}} + a dashboard entity binding)?
  multiEntity?: boolean
  hasEntityScope?: boolean
  // The panel is entity-templated ({{entity_id}}) but no default device was available to
  // preview it against, so the dry-run could not run. This is NOT a query error — the panel
  // is well-formed; it just needs a default device chosen before it can be validated/opened.
  needsSampleEntity?: boolean
}

export interface Readiness { ready: boolean; gaps: string[] }

export function assessPanelReadiness(inp: ReadinessInput): Readiness {
  const gaps: string[] = []

  // Entity-templated but no default device to preview against: the one gap is to pick a
  // default device. Report only this (don't also fire the executability/empty gaps, since
  // the query was deliberately NOT run) — keep {{entity_id}} in the saved query either way.
  if (inp.needsSampleEntity) {
    return { ready: false, gaps: ['no default device set — pick a device for the Device filter so the panel can be previewed (keep {{entity_id}} in the query; do not hard-code a device)'] }
  }

  if (inp.cls === 'invalid') gaps.push(`chart/shape invalid${inp.detail ? `: ${inp.detail}` : ''}`)
  else if (inp.cls === 'error') gaps.push(`query failed${inp.detail ? `: ${inp.detail}` : ''} — check columns/filters`)
  else if (inp.cls === 'empty') gaps.push('returned no data in the preview window — confirm the metric, filter, or device is right')

  // Grounding: any used ref not in the known set is likely hallucinated/misspelled.
  if (inp.usedRefs && inp.usedRefs.length && inp.knownRefs && inp.knownRefs.length) {
    const known = new Set(inp.knownRefs.map(r => r.toLowerCase()))
    const unknown = inp.usedRefs.map(r => r.toLowerCase()).filter(r => !known.has(r))
    if (unknown.length) gaps.push(`unknown field(s): ${unknown.join(', ')} — not in this source's schema`)
  }

  // Multi-entity sources must be scoped (Phase 9 device filter), not silently pinned to one.
  if (inp.multiEntity && !inp.hasEntityScope) {
    gaps.push('source has many devices/entities — scope the panel to a device ({{entity_id}} + the Device filter) or pick which to show')
  }

  return { ready: gaps.length === 0, gaps }
}

export interface PlanReadiness { allReady: boolean; readyCount: number; total: number; gaps: { panel: string; gaps: string[] }[] }

// Aggregate per-panel readiness into a plan-level verdict for the build gate.
export function assessPlanReadiness(panels: { title: string; readiness: Readiness }[]): PlanReadiness {
  const gaps = panels.filter(p => !p.readiness.ready).map(p => ({ panel: p.title, gaps: p.readiness.gaps }))
  return { allReady: gaps.length === 0, readyCount: panels.length - gaps.length, total: panels.length, gaps }
}

// Extract the field references a PRISM params object uses (its keys[]), lowercased.
export function prismUsedRefs(params: Record<string, unknown>): string[] {
  const k = params.keys
  return Array.isArray(k) ? k.map(x => String(x).toLowerCase()) : []
}

// Extract field references from an API OData-ish path ($select, and identifiers in $filter).
export function apiUsedRefs(path: string): string[] {
  const refs = new Set<string>()
  const sel = path.match(/[$]select=([^&]+)/i)
  if (sel) for (const f of decodeURIComponent(sel[1]).split(',')) { const t = f.trim(); if (t) refs.add(t.toLowerCase()) }
  const filt = path.match(/[$]filter=([^&]+)/i)
  if (filt) {
    const expr = decodeURIComponent(filt[1])
    // field names are identifiers immediately before an operator (eq/ne/gt/ge/lt/le)
    for (const m of expr.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s+(?:eq|ne|gt|ge|lt|le)\b/gi)) refs.add(m[1].toLowerCase())
  }
  return [...refs]
}

// ── Multi-entity scoping for SQL / API sources (dictionary-driven) ────────────
// A source is "multi-entity" when its semantic dictionary marks a column/field as an
// IDENTIFIER (role='identifier') — e.g. machine_id, device_id. A panel over such a source
// must be SCOPED to an entity (the {{entity_id}} filter + a Device binding, a WHERE on the
// id, or a GROUP BY the id) OR be a deliberate aggregate rollup; otherwise it silently mixes
// many entities into one ambiguous series (the SQL/API analogue of PRISM picking a random
// device). These are pure string checks — the caller supplies the identifier column names.

const canon = (s: string) => s.toLowerCase().replace(/[^a-z0-9_]/g, '')

// Does a SQL query scope to an entity? {{entity_id}} placeholder, a WHERE filter on an
// identifier column (col = / col IN (), or a GROUP BY that includes one.
export function sqlScopesEntity(query: string, entityCols: string[]): boolean {
  if (!query) return false
  if (/\{\{entity_id\}\}/.test(query)) return true
  const lc = query.toLowerCase()
  const gb = lc.match(/group\s+by\s+([\s\S]*?)(?:\border\s+by\b|\bhaving\b|\blimit\b|$)/i)
  for (const col of entityCols) {
    const c = canon(col); if (!c) continue
    if (new RegExp(`\\b${c}\\s*(?:=|in\\b)`).test(lc)) return true           // WHERE machine_id = / IN (
    if (gb && new RegExp(`\\b${c}\\b`).test(gb[1])) return true              // GROUP BY machine_id
  }
  return false
}

// A query that collapses rows with an explicit aggregate is a deliberate rollup (allowed);
// a raw unscoped multi-entity series (no aggregate) mixes entities ambiguously (flagged).
export function sqlHasAggregate(query: string): boolean {
  return /\b(?:sum|avg|count|min|max)\s*\(/i.test(query || '')
}

// Does an API path scope to an entity? {{entity_id}} present, or an identifier field used
// in $filter/$select (reuses apiUsedRefs).
export function apiScopesEntity(path: string, entityCols: string[]): boolean {
  if (!path) return false
  if (/\{\{entity_id\}\}/.test(path)) return true
  const used = new Set(apiUsedRefs(path).map(canon))
  return entityCols.some(c => used.has(canon(c)))
}
