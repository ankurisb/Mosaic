// app/api/semantic/route.ts
// Semantic schema dictionary — CRUD + AI auto-describe (propose→confirm).
//   GET  ?source_type=&source_id=          -> list stored descriptions for a source
//   POST { action: 'generate', source_type, source_id }
//                                            -> DRAFT descriptions (not saved)
//   POST { action: 'upsert', source_type, source_id, items:[{object_type,object_key,description}] }
//   POST { action: 'delete', source_type, source_id, object_key }   (or {all:true})
//
// Reads are allowed for any signed-in user (so chat/PanelBuilder can rely on them);
// writes + generate are admin-only, mirroring datasource configuration.
import { getSession } from '@/lib/auth'
import { getDb, nowExpr } from '@/lib/db'
import { log } from '@/lib/logger'
import { getOrFetchSchema, formatSchemaForPrompt, runTool } from '@/lib/tools'
import { describeSchema } from '@/lib/ai/describe-schema'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  const { searchParams } = new URL(req.url)
  const sourceType = searchParams.get('source_type') || 'database'
  const sourceId = searchParams.get('source_id')
  if (!sourceId) return Response.json({ error: 'source_id required' }, { status: 400 })
  const sql = getDb()
  const rows = await sql`
    SELECT object_type, object_key, description, updated_at
    FROM   semantic_descriptions
    WHERE  source_type = ${sourceType} AND source_id = ${sourceId}
    ORDER  BY object_type DESC, object_key`
  return Response.json({ descriptions: rows })
}

export async function POST(req: Request) {
  try {
    const session = await getSession()
    if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
    if (session.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 })
    const sql = getDb()
    const body = await req.json()
    const { action, source_type = 'database', source_id } = body
    if (!source_id) return Response.json({ error: 'source_id required' }, { status: 400 })

    // -- GENERATE: propose descriptions from real schema + samples (not saved) ----
    if (action === 'generate') {
      const schema = await getOrFetchSchema(source_id)
      if (!schema || schema.error) {
        return Response.json({ error: schema?.error || 'Schema not available for this source' }, { status: 400 })
      }
      // Sample a few rows from up to 6 tables — same approach as schema-preview.
      const tables = (schema.tables || []).slice(0, 6)
      const samples: Record<string, unknown[]> = {}
      await Promise.all(tables.map(async t => {
        try {
          const name = t.schema && t.schema !== 'public' ? `${t.schema}.${t.name}` : t.name
          const r = await runTool('query_database', { connection_id: source_id, sql: `SELECT * FROM ${name} LIMIT 3` }) as { rows?: unknown[] } | null
          if (r?.rows?.length) samples[name] = r.rows
        } catch { /* skip tables that error */ }
      }))
      const schemaText = formatSchemaForPrompt(schema, { maxChars: 6000 })
      const result = await describeSchema(schemaText, samples)
      if (!result.ok) return Response.json({ error: result.reason || 'Generation failed' }, { status: 502 })
      return Response.json({ draft: result.items ?? [] })
    }

    // -- UPSERT: save confirmed/edited descriptions -------------------------------
    if (action === 'upsert') {
      const items = Array.isArray(body.items) ? body.items : []
      let saved = 0
      for (const it of items) {
        const objectType = it.object_type === 'column' ? 'column' : 'table'
        const objectKey = String(it.object_key || '').trim()
        const description = String(it.description || '').trim()
        if (!objectKey) continue
        if (!description) {
          // Empty description clears the entry rather than storing a blank.
          await sql`DELETE FROM semantic_descriptions WHERE source_type=${source_type} AND source_id=${source_id} AND object_key=${objectKey}`
          continue
        }
        await sql`
          INSERT INTO semantic_descriptions (source_type, source_id, object_type, object_key, description, created_by, updated_at)
          VALUES (${source_type}, ${source_id}, ${objectType}, ${objectKey}, ${description}, ${session.id}, ${nowExpr()})
          ON CONFLICT(source_type, source_id, object_key)
          DO UPDATE SET description=${description}, object_type=${objectType}, updated_at=${nowExpr()}`
        saved++
      }
      return Response.json({ ok: true, saved })
    }

    // -- DELETE: one key, or all for the source -----------------------------------
    if (action === 'delete') {
      if (body.all === true) {
        await sql`DELETE FROM semantic_descriptions WHERE source_type=${source_type} AND source_id=${source_id}`
        return Response.json({ ok: true })
      }
      const objectKey = String(body.object_key || '').trim()
      if (!objectKey) return Response.json({ error: 'object_key required' }, { status: 400 })
      await sql`DELETE FROM semantic_descriptions WHERE source_type=${source_type} AND source_id=${source_id} AND object_key=${objectKey}`
      return Response.json({ ok: true })
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    log.error({ service: 'api_semantic', err }, 'POST /api/semantic failed')
    return Response.json({ error: (err as Error).message }, { status: 500 })
  }
}
