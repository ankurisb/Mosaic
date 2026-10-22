// lib/dashboard-entity.ts
// Dashboard entity/device filter. Panels reference {{entity_id}} (and {{entity}} for a
// label) instead of a baked device id; the data route substitutes the dashboard's selected
// entity at query time, and fans out one query per entity when several are selected (one
// series per device). Pure + unit-tested; the route supplies the actual query runner.

export const ENTITY_ID_PH = '{{entity_id}}'
export const ENTITY_LABEL_PH = '{{entity}}'
export const MAX_OVERLAY_ENTITIES = 12
export const SERIES_KEY = '__entity'   // the per-row series column fan-out tags rows with

// Does this panel depend on the entity filter? (SQL/API query text, or a PRISM params
// object whose entity_id is the placeholder or missing-but-templated.)
export function hasEntityPlaceholder(query: string | null | undefined): boolean {
  return typeof query === 'string' && (query.includes(ENTITY_ID_PH) || query.includes(ENTITY_LABEL_PH))
}

// Parse the `entity` request param ("id1,id2,…") into a deduped, capped id list.
export function parseEntitySelection(raw: string | null | undefined, cap = MAX_OVERLAY_ENTITIES): string[] {
  if (!raw) return []
  const out: string[] = []
  for (const part of String(raw).split(',')) {
    const id = part.trim()
    if (id && !out.includes(id)) out.push(id)
    if (out.length >= cap) break
  }
  return out
}

function sqlEscape(v: string): string { return v.replace(/'/g, "''") }

// Substitute the entity placeholders for one entity id. SQL/API: the id is injected as a
// quoted literal (both `'{{entity_id}}'` and bare `{{entity_id}}` forms, mirroring the time
// substitution). API paths get a URL-encoded bare value. label replaces {{entity}}.
export function substituteEntityQuery(query: string, sourceType: string, id: string, label?: string): string {
  const lab = label ?? id
  if (sourceType === 'api' || sourceType === 'file_server') {
    return query
      .split(`'${ENTITY_ID_PH}'`).join(encodeURIComponent(id))
      .split(ENTITY_ID_PH).join(encodeURIComponent(id))
      .split(ENTITY_LABEL_PH).join(encodeURIComponent(lab))
  }
  // database (SQL): always a quoted literal so `WHERE device = {{entity_id}}` is valid.
  const q = `'${sqlEscape(id)}'`
  return query
    .split(`'${ENTITY_ID_PH}'`).join(q)
    .split(ENTITY_ID_PH).join(q)
    .split(ENTITY_LABEL_PH).join(sqlEscape(lab))
}

// PRISM params carry entity_id as a field; set it to the selected id (replacing the
// placeholder or a baked id). Returns a new object; never mutates input.
export function applyPrismEntity(params: Record<string, unknown>, id: string): Record<string, unknown> {
  return { ...params, entity_id: id }
}

// Does a PRISM params object depend on the entity filter? (entity_id missing or placeholder.)
export function prismNeedsEntity(params: Record<string, unknown>): boolean {
  const e = params.entity_id
  return e == null || e === ENTITY_ID_PH || e === ''
}

// Tag every row with the series label so an overlay chart draws one series per entity.
export function tagEntityRows(rows: Record<string, unknown>[], label: string): Record<string, unknown>[] {
  return rows.map(r => ({ ...r, [SERIES_KEY]: label }))
}

// Merge fan-out results (already tagged) into one row set, preserving order.
export function mergeEntityRows(parts: Record<string, unknown>[][]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (const p of parts) for (const r of p) out.push(r)
  return out
}
