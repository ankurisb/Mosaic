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
