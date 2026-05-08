import { NextRequest } from 'next/server'
import { getSession } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { runTool } from '@/lib/tools'

export const runtime = 'nodejs'

// -- Auth helper: validate n8n API key from request header --
async function validateN8nKey(req: NextRequest): Promise<boolean> {
  const authHeader = req.headers.get('authorization') || ''
  const key = authHeader.replace('Bearer ', '').trim()
  if (!key) return false
  const sql = getDb()
  try {
    const rows = await sql`SELECT value_enc FROM kv_settings WHERE key = 'N8N_MOSAIC_API_KEY'`
    if (!rows.length) return false
    const { decrypt } = await import('@/lib/encrypt')
    const stored = decrypt(rows[0].value_enc as string)
    return stored === key
  } catch { return false }
}

// -- GET /api/n8n -- status check (used by Automation tab) --
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const sql = getDb()

  // Get n8n URL from kv_settings
  let n8nUrl = process.env.N8N_URL || 'http://localhost:5678'
  try {
    const rows = await sql`SELECT value_enc FROM kv_settings WHERE key = 'N8N_URL'`
    if (rows.length) {
      const { decrypt } = await import('@/lib/encrypt')
      n8nUrl = decrypt(rows[0].value_enc as string)
    }
  } catch {}

  // Get API key status
  let apiKeyConfigured = false
  try {
    const rows = await sql`SELECT value_enc FROM kv_settings WHERE key = 'N8N_API_KEY'`
    apiKeyConfigured = rows.length > 0
  } catch {}

  // Check n8n health
  let n8nStatus: 'online' | 'offline' | 'unknown' = 'unknown'
  let workflowCount = 0
  let recentExecutions: Array<{ id: string; workflowName: string; status: string; startedAt: string }> = []

  try {
    const healthRes = await fetch(`${n8nUrl}/healthz`, { signal: AbortSignal.timeout(3000) })
    if (healthRes.ok) {
      n8nStatus = 'online'

      // If API key configured, fetch workflow stats
      if (apiKeyConfigured) {
        const { decrypt } = await import('@/lib/encrypt')
        const rows = await sql`SELECT value_enc FROM kv_settings WHERE key = 'N8N_API_KEY'`
        const apiKey = decrypt(rows[0].value_enc as string)

        // Fetch workflows
        const wfRes = await fetch(`${n8nUrl}/api/v1/workflows`, {
          headers: { 'X-N8N-API-KEY': apiKey },
          signal: AbortSignal.timeout(5000),
        })
        if (wfRes.ok) {
          const wfData = await wfRes.json()
          workflowCount = wfData.data?.length || 0
        }

        // Fetch recent executions
        const execRes = await fetch(`${n8nUrl}/api/v1/executions?limit=10`, {
          headers: { 'X-N8N-API-KEY': apiKey },
          signal: AbortSignal.timeout(5000),
        })
        if (execRes.ok) {
          const execData = await execRes.json()
          recentExecutions = (execData.data || []).map((e: Record<string, unknown>) => ({
            id: e.id,
            workflowName: (e.workflowData as Record<string, unknown>)?.name || 'Unknown workflow',
            status: e.finished ? (e.stoppedAt ? 'success' : 'error') : 'running',
            startedAt: e.startedAt as string,
          }))
        }
      }
    }
  } catch { n8nStatus = 'offline' }

  return Response.json({
    n8nUrl,
    n8nStatus,
    apiKeyConfigured,
    workflowCount,
    recentExecutions,
    mosaicApiBase: process.env.NEXTAUTH_URL || 'http://localhost:3001',
  })
}

// -- POST /api/n8n -- called BY n8n workflows to query Mosaic --
export async function POST(req: NextRequest) {
  const valid = await validateN8nKey(req)
  if (!valid) return Response.json({ error: 'Invalid API key' }, { status: 401 })

  const body = await req.json()
  const { action } = body

  // -- query: run SQL against any Mosaic connection --
  if (action === 'query') {
    const { connection_id, sql: query } = body
    if (!connection_id || !query) {
      return Response.json({ error: 'connection_id and sql required' }, { status: 400 })
    }
    try {
      const result = await runTool('query_database', { connection_id, sql: query })
      return Response.json({ ok: true, rows: (result as Record<string, unknown>).rows, rowCount: ((result as Record<string, unknown>).rows as unknown[])?.length || 0 })
    } catch (err) {
      return Response.json({ ok: false, error: err instanceof Error ? err.message : 'Query failed' })
    }
  }

  // -- sync: trigger an Airbyte sync by source label --
  if (action === 'sync') {
    const { source_label } = body
    if (!source_label) return Response.json({ error: 'source_label required' }, { status: 400 })
    try {
      const result = await runTool('trigger_airbyte_sync', { source_label })
      return Response.json({ ok: true, result })
    } catch (err) {
      return Response.json({ ok: false, error: err instanceof Error ? err.message : 'Sync failed' })
    }
  }

  // -- notify: write a message into Mosaic system (future: post to conversation) --
  if (action === 'notify') {
    const { title, message, level = 'info' } = body
    if (!message) return Response.json({ error: 'message required' }, { status: 400 })
    // Store as a system notification in kv_settings for now
    const sql = getDb()
    const notification = JSON.stringify({ title, message, level, at: new Date().toISOString() })
    await sql`INSERT INTO kv_settings (key, value_enc, updated_by, updated_at)
              VALUES (${'N8N_LAST_NOTIFICATION'}, ${notification}, ${'n8n'}, ${new Date().toISOString()})
              ON CONFLICT(key) DO UPDATE SET value_enc = ${notification}, updated_at = ${new Date().toISOString()}`
    return Response.json({ ok: true })
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 })
}
