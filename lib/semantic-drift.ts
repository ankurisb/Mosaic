// lib/semantic-drift.ts
// Phase 2: semantic-model drift lifecycle. A source's schema is fingerprinted on
// introspection; when it changes we can tell WHICH fields were added/removed/retyped
// and re-describe only those, instead of silently serving a stale model. Pure diff +
// a thin read/write of semantic_sources (migration 021).
import { createHash } from 'crypto'
import { getDb } from './db'

export interface SchemaField { object_key: string; data_type?: string | null }

// Stable fingerprint of a source's schema: sorted `key:type` pairs, hashed. Order-
// independent, so re-introspecting the same schema yields the same fingerprint.
export function computeFingerprint(fields: SchemaField[]): string {
  const norm = fields
    .map(f => `${f.object_key}:${(f.data_type || '').toLowerCase()}`)
    .sort()
    .join('\n')
  return createHash('sha1').update(norm).digest('hex')
}

export interface SchemaDiff { added: string[]; removed: string[]; retyped: string[]; changed: boolean }

// Compare two schemas (key -> type). added/removed by key; retyped where the key
// exists in both but the type differs.
export function diffSchema(prev: SchemaField[], cur: SchemaField[]): SchemaDiff {
  const p = new Map(prev.map(f => [f.object_key, (f.data_type || '').toLowerCase()]))
  const c = new Map(cur.map(f => [f.object_key, (f.data_type || '').toLowerCase()]))
  const added: string[] = [], removed: string[] = [], retyped: string[] = []
  for (const k of c.keys()) if (!p.has(k)) added.push(k)
  for (const k of p.keys()) if (!c.has(k)) removed.push(k)
  for (const [k, t] of c) if (p.has(k) && p.get(k) !== t) retyped.push(k)
  added.sort(); removed.sort(); retyped.sort()
  return { added, removed, retyped, changed: added.length + removed.length + retyped.length > 0 }
}

// ---- semantic_sources read/write (degrades silently) -----------------------

export async function getStoredFingerprint(sourceType: string, sourceId: string): Promise<string | null> {
  try {
    const sql = getDb()
    const r = await sql`SELECT schema_fingerprint FROM semantic_sources WHERE source_type=${sourceType} AND source_id=${sourceId}` as Array<{ schema_fingerprint: string | null }>
    return r[0]?.schema_fingerprint ?? null
  } catch { return null }
}

export async function recordFingerprint(sourceType: string, sourceId: string, fingerprint: string): Promise<void> {
  try {
    const sql = getDb()
    await sql`
      INSERT INTO semantic_sources (source_type, source_id, schema_fingerprint, last_introspected_at, updated_at)
      VALUES (${sourceType}, ${sourceId}, ${fingerprint}, datetime('now'), datetime('now'))
      ON CONFLICT(source_type, source_id)
      DO UPDATE SET schema_fingerprint=${fingerprint}, last_introspected_at=datetime('now'),
                    model_version = model_version + 1, updated_at=datetime('now')`
  } catch { /* best-effort */ }
}

export interface SemanticHealth {
  total: number; described: number; verified: number; proposed: number
  structured: number; coverage_pct: number; last_introspected_at: string | null
}

export interface SourceCoverage {
  source_type: string; source_id: string; label: string
  structured: number; verified: number; proposed: number; needs_config: boolean
}
export interface CoverageSummary { sources: SourceCoverage[]; unconfigured: number }

// Per-source coverage across all database connections, for the "needs configuration"
// badges + global banner. A source needs config when it has no verified semantic fields
// yet. Pure counting over semantic_descriptions; degrades to empty on error.
export async function getCoverageSummary(): Promise<CoverageSummary> {
  try {
    const sql = getDb()
    const conns = await sql`SELECT id, label FROM db_connections ORDER BY created_at ASC` as Array<{ id: string; label: string }>
    const counts = await sql`
      SELECT source_id,
             SUM(CASE WHEN role IS NOT NULL THEN 1 ELSE 0 END) AS structured,
             SUM(CASE WHEN status='verified' THEN 1 ELSE 0 END) AS verified,
             SUM(CASE WHEN status='proposed' THEN 1 ELSE 0 END) AS proposed
      FROM semantic_descriptions WHERE source_type='database' GROUP BY source_id` as Array<{ source_id: string; structured: number; verified: number; proposed: number }>
    const byId = new Map(counts.map(c => [c.source_id, c]))
    const sources: SourceCoverage[] = conns.map(c => {
      const n = byId.get(c.id)
      const verified = Number(n?.verified ?? 0)
      return {
        source_type: 'database', source_id: c.id, label: c.label,
        structured: Number(n?.structured ?? 0), verified, proposed: Number(n?.proposed ?? 0),
        needs_config: verified === 0,
      }
    })
    return { sources, unconfigured: sources.filter(s => s.needs_config).length }
  } catch {
    return { sources: [], unconfigured: 0 }
  }
}

// Coverage/verification summary for a source — the semantic-health surface.
export async function getSemanticHealth(sourceType: string, sourceId: string, schemaFieldCount?: number): Promise<SemanticHealth> {
  const base: SemanticHealth = { total: schemaFieldCount ?? 0, described: 0, verified: 0, proposed: 0, structured: 0, coverage_pct: 0, last_introspected_at: null }
  try {
    const sql = getDb()
    const rows = await sql`
      SELECT description, role, status FROM semantic_descriptions
      WHERE source_type=${sourceType} AND source_id=${sourceId}` as Array<{ description: string; role: string | null; status: string | null }>
    base.described = rows.filter(r => r.description && r.description.trim()).length
    base.structured = rows.filter(r => r.role).length
    base.verified = rows.filter(r => r.status === 'verified').length
    base.proposed = rows.filter(r => r.status === 'proposed').length
    const denom = schemaFieldCount && schemaFieldCount > 0 ? schemaFieldCount : rows.length
    base.coverage_pct = denom ? Math.round((base.structured / denom) * 100) : 0
    const src = await sql`SELECT last_introspected_at FROM semantic_sources WHERE source_type=${sourceType} AND source_id=${sourceId}` as Array<{ last_introspected_at: string | null }>
    base.last_introspected_at = src[0]?.last_introspected_at ?? null
  } catch { /* degrade to base */ }
  return base
}
