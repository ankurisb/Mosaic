// GET /api/dashboards/[id]/entities
// Lists the selectable entities/devices for a dashboard's entity filter (Phase 9b), from
// the binding stored in dashboards.entity_config. PRISM → query_prism devices/assets; SQL →
// DISTINCT key[,label] from the bound table. Returns [{id,label}] + the default selection.
import { getSession } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { runTool } from '@/lib/tools'
import { prismSeriesToRows } from '@/lib/dashboard-plan'
export const runtime = 'nodejs'

const MAX_ENTITIES = 500

interface EntityConfig {
  source_type?: string; source_id?: string; kind?: string
  key_field?: string; label_field?: string; table?: string; default?: string[]
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  const { id } = await params
  const sql = getDb()
  const rows = await sql`SELECT entity_config FROM dashboards WHERE id = ${id} AND (owner_id = ${session.id} OR is_public = true)`
  if (!rows.length) return Response.json({ error: 'Not found' }, { status: 404 })
  const raw = (rows[0] as { entity_config?: string | null }).entity_config
  if (!raw) return Response.json({ bound: false, entities: [], default: [] })

  let cfg: EntityConfig
  try { cfg = typeof raw === 'string' ? JSON.parse(raw) : raw as EntityConfig } catch { return Response.json({ bound: false, entities: [], default: [] }) }
  if (!cfg.source_id || !cfg.kind) return Response.json({ bound: false, entities: [], default: [] })

  try {
    let entities: { id: string; label: string }[] = []
    if (cfg.kind === 'prism') {
      const op = (cfg.key_field === 'asset' ? 'assets' : 'devices')
      const res = await runTool('query_prism', { instance_id: cfg.source_id, operation: op })
      const list = prismSeriesToRows(res) as Record<string, unknown>[]
      entities = list.map(d => {
        const idv = String(d.id ?? d.entity_id ?? d.deviceId ?? d.uuid ?? '')
        const lab = String(d.name ?? d.label ?? d.title ?? idv)
        return { id: idv, label: lab }
      }).filter(e => e.id)
    } else if (cfg.kind === 'sql') {
      const key = (cfg.key_field || '').replace(/[^A-Za-z0-9_."]/g, '')
      const tbl = (cfg.table || '').replace(/[^A-Za-z0-9_."]/g, '')
      const lab = (cfg.label_field || '').replace(/[^A-Za-z0-9_."]/g, '')
      if (key && tbl) {
        const cols = lab ? `${key}, ${lab}` : key
        const res = await runTool('query_database', { connection_id: cfg.source_id, sql: `SELECT DISTINCT ${cols} FROM ${tbl} LIMIT ${MAX_ENTITIES}` }) as { rows?: Record<string, unknown>[] }
        entities = (res?.rows || []).map(r => {
          const idv = String(r[key.replace(/.*\./, '')] ?? Object.values(r)[0] ?? '')
          const lv = lab ? String(r[lab.replace(/.*\./, '')] ?? idv) : idv
          return { id: idv, label: lv }
        }).filter(e => e.id)
      }
    }
    // api kind: entity values aren't generically discoverable in v1 — return the defaults.
    const seen = new Set<string>()
    entities = entities.filter(e => (seen.has(e.id) ? false : (seen.add(e.id), true))).slice(0, MAX_ENTITIES)
    return Response.json({ bound: true, kind: cfg.kind, entities, default: Array.isArray(cfg.default) ? cfg.default : [] })
  } catch (e) {
    return Response.json({ bound: true, entities: [], default: Array.isArray(cfg.default) ? cfg.default : [], error: e instanceof Error ? e.message : 'discovery failed' })
  }
}
