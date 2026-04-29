import { NextRequest } from 'next/server'
import { getSession } from '@/lib/auth'
import { getOrFetchSchema, runTool } from '@/lib/tools'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { connection_id } = await req.json()
  if (!connection_id) return Response.json({ error: 'connection_id required' }, { status: 400 })

  // Get schema (use cache or fetch fresh)
  const schema = await getOrFetchSchema(connection_id)
  if (!schema || schema.error) {
    return Response.json({ error: schema?.error || 'Schema not available' }, { status: 500 })
  }

  // Get sample rows for up to 5 tables
  const tables = (schema.tables || []).slice(0, 5)
  const samples: Record<string, unknown[]> = {}

  await Promise.all(tables.map(async table => {
    try {
      const tableName = table.schema ? `${table.schema}.${table.name}` : table.name
      const result = await runTool('query_database', {
        connection_id,
        sql: `SELECT * FROM ${tableName} LIMIT 3`,
      })
      if (result?.rows?.length > 0) {
        samples[tableName] = result.rows
      }
    } catch {
      // Skip tables that error
    }
  }))

  return Response.json({ schema, samples })
}
