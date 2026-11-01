// lib/cube-readiness.ts
// Phase 8: prove a verified source is actually servable through Cube — don't just
// assume it. Verification fills in the semantic model, but the cube still has to
// compile AND Cube has to connect to the source with its own driver and build the
// pre-aggregation. Those steps fail independently (schema-qualified names, MySQL-8
// caching_sha2 auth, SQL-Server `server` config, network reachability, permissions),
// and when they do the dashboard silently falls back to SQL — correct, but not what
// the "✓ Semantics" badge implied.
//
// This probe issues ONE trivial Cube query against the source's generated cube and
// records whether it actually served (engine would be `cube`) or fell back, with the
// reason. It reuses the exact routing+load path the dashboard uses, so the badge
// reflects reality, not a model-shape guess. Result is persisted on semantic_sources
// (migration 029) and surfaced in the Databases tab.
import { getDb } from './db'
import { getStoredFingerprint } from './semantic-drift'
import { getSemanticModel } from './semantic-model'
import { planCubeRouting, loadViaCube, cubeDialectSupported, isNativeAgg } from './cube-client'

export interface CubeReadiness {
  serving: boolean
  reason: string            // 'ok' when serving; otherwise a routing/compile/connect reason
  cube?: string
  checked_at: string
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// Persist the probe outcome. Upserts onto the existing semantic_sources row (created
// by recordFingerprint on introspection) without touching the fingerprint/version.
export async function recordCubeReadiness(sourceId: string, serving: boolean, reason: string, checkedAt: string): Promise<void> {
  try {
    const sql = getDb()
    const state = serving ? 'serving' : 'unreachable'
    await sql`
      INSERT INTO semantic_sources (source_type, source_id, cube_serving, cube_reason, cube_checked_at, updated_at)
      VALUES ('database', ${sourceId}, ${state}, ${reason}, ${checkedAt}, datetime('now'))
      ON CONFLICT(source_type, source_id)
      DO UPDATE SET cube_serving=${state}, cube_reason=${reason}, cube_checked_at=${checkedAt}, updated_at=datetime('now')`
  } catch { /* best-effort — readiness is advisory */ }
}

async function finalize(sourceId: string, r: CubeReadiness): Promise<CubeReadiness> {
  await recordCubeReadiness(sourceId, r.serving, r.reason, r.checked_at)
  return r
}

// Probe whether `sourceId` actually serves through Cube right now. Synthesizes the
// cheapest possible query — a single verified, Cube-native measure as a scalar total
// (no time axis, no dimensions) — routes it through the real planner, and runs it via
// Cube. A fresh model takes a few seconds to compile + build its pre-aggregation, so
// we poll briefly (a 200 with no rows is Cube's "Continue wait" while building).
// Fails closed to serving:false with a precise reason; never throws.
export async function probeCubeServing(sourceId: string, opts: { attempts?: number; delayMs?: number } = {}): Promise<CubeReadiness> {
  const attempts = Math.max(1, opts.attempts ?? 5)
  const delayMs = opts.delayMs ?? 3000
  const started = new Date().toISOString()
  try {
    const sql = getDb()
    const conn = (await sql`SELECT dialect FROM db_connections WHERE id=${sourceId}` as Array<{ dialect?: string | null }>)[0]
    const dialect = conn?.dialect ?? null
    if (!cubeDialectSupported(dialect)) {
      return finalize(sourceId, { serving: false, reason: `dialect-unsupported:${dialect ?? 'none'}`, checked_at: started })
    }

    const model = await getSemanticModel('database', sourceId)
    // A source is Cube-servable only if it has at least one verified, Cube-native
    // measure — that's what BI/dashboards would actually pull. Probe with the first one.
    const measure = [...model.byKey.values()].find(f => f.role === 'measure' && f.status === 'verified' && isNativeAgg(f.default_aggregation))
    if (!measure) {
      return finalize(sourceId, { serving: false, reason: 'no-verified-native-measure', checked_at: started })
    }
    const yCol = measure.object_key.includes('.') ? measure.object_key.split('.').pop()! : measure.object_key

    const fpCurrent = !!(await getStoredFingerprint('database', sourceId))
    const plan = planCubeRouting({ cfg: { y: yCol }, model, dialect, fingerprintCurrent: fpCurrent, sourceId })
    if (!plan.route || !plan.query || !plan.cube) {
      return finalize(sourceId, { serving: false, reason: plan.reason, checked_at: started })
    }

    const CUBE_URL = process.env.CUBE_URL || ''
    const CUBE_SECRET = process.env.CUBEJS_API_SECRET || process.env.AUTH_SECRET || ''
    if (!CUBE_URL) return finalize(sourceId, { serving: false, reason: 'cube-not-deployed', checked_at: started })

    let last = 'cube-no-response'
    for (let i = 0; i < attempts; i++) {
      const res = await loadViaCube(CUBE_URL, CUBE_SECRET, plan.cube, plan.query)
      if (res.ok && !res.fallback && res.rows.length > 0) {
        return finalize(sourceId, { serving: true, reason: 'ok', cube: plan.cube, checked_at: new Date().toISOString() })
      }
      // 200 with no rows == Cube still compiling / building the pre-aggregation → retry.
      last = res.reason || (res.ok ? 'cube-building' : 'cube-fallback')
      if (i < attempts - 1) await sleep(delayMs)
    }
    return finalize(sourceId, { serving: false, reason: last, cube: plan.cube, checked_at: new Date().toISOString() })
  } catch (e) {
    return finalize(sourceId, { serving: false, reason: `probe-error:${(e as Error)?.name || 'unknown'}`, checked_at: started })
  }
}
