import { NextRequest } from 'next/server'
import { getSession } from '@/lib/auth'
import { canAccessSurface } from '@/lib/permissions'
import { resolveN8nUrl, resolveN8nApiKey } from '@/lib/n8n'

export const runtime = 'nodejs'

// Outbound Mosaic -> n8n: let a Mosaic user (or the chat AI / rules) list and
// TRIGGER the workflows they built in n8n. This is the "Mosaic uses n8n workflows"
// direction, complementary to the /api/n8n callback ("n8n uses Mosaic data").
//
// n8n's public API cannot execute a workflow directly (POST /workflows/run -> 405),
// so the supported pattern is a Webhook trigger node: the user's workflow starts
// with a Webhook, and we POST to {n8n}/webhook/{path}. This is outbound only, so it
// works even for n8n Cloud from a local Mosaic — no inbound reachability needed.

// Pull the webhook path(s) out of a workflow's node graph.
function webhookPaths(wf: Record<string, unknown>): { path: string; method: string }[] {
  const nodes = (wf.nodes as Array<Record<string, unknown>>) || []
  return nodes
    .filter(n => (n.type as string) === 'n8n-nodes-base.webhook')
    .map(n => {
      const p = (n.parameters as Record<string, unknown>) || {}
      return { path: String(p.path || ''), method: String(p.httpMethod || 'POST').toUpperCase() }
    })
    .filter(w => w.path)
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  if (!(await canAccessSurface({ id: session.id, role: session.role }, 'n8n'))) {
    return Response.json({ error: 'No access to workflow automation' }, { status: 403 })
  }

  const base = await resolveN8nUrl()
  const apiKey = await resolveN8nApiKey()

  const body = await req.json().catch(() => ({}))
  const { action } = body as { action?: string }

  // -- list_workflows: workflows the user built, flagged by whether Mosaic can
  //    trigger them (i.e. they have a Webhook node) --
  if (action === 'list_workflows') {
    if (!apiKey) return Response.json({ error: 'n8n API key not configured' }, { status: 400 })
    try {
      const res = await fetch(`${base}/api/v1/workflows`, {
        headers: { 'X-N8N-API-KEY': apiKey },
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) return Response.json({ error: `n8n returned ${res.status}` }, { status: 502 })
      const data = await res.json()
      const workflows = (data.data || []).map((wf: Record<string, unknown>) => {
        const hooks = webhookPaths(wf)
        return {
          id: wf.id,
          name: wf.name,
          active: !!wf.active,
          triggerable: hooks.length > 0,   // has a Webhook node Mosaic can POST to
          webhooks: hooks,
        }
      })
      return Response.json({ workflows })
    } catch (err) {
      return Response.json({ error: err instanceof Error ? err.message : 'Failed to list workflows' }, { status: 502 })
    }
  }

  // -- trigger_workflow: POST to a workflow's webhook and return its response.
  //    Accepts either an explicit webhook path, or a workflow id we resolve to one. --
  if (action === 'trigger_workflow') {
    const { webhook_path, workflow_id, method, payload } = body as {
      webhook_path?: string; workflow_id?: string; method?: string; payload?: unknown
    }

    let path = webhook_path
    let httpMethod = (method || 'POST').toUpperCase()

    // Resolve a webhook path from a workflow id if a path wasn't given directly.
    if (!path && workflow_id) {
      if (!apiKey) return Response.json({ error: 'n8n API key not configured' }, { status: 400 })
      try {
        const wfRes = await fetch(`${base}/api/v1/workflows/${workflow_id}`, {
          headers: { 'X-N8N-API-KEY': apiKey },
          signal: AbortSignal.timeout(8000),
        })
        if (!wfRes.ok) return Response.json({ error: `Could not load workflow ${workflow_id}` }, { status: 502 })
        const wf = await wfRes.json()
        const hooks = webhookPaths(wf)
        if (hooks.length === 0) {
          return Response.json({ error: 'This workflow has no Webhook trigger, so Mosaic cannot trigger it. Add a Webhook node in n8n.' }, { status: 400 })
        }
        path = hooks[0].path
        httpMethod = hooks[0].method
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : 'Failed to resolve workflow' }, { status: 502 })
      }
    }

    if (!path) return Response.json({ error: 'webhook_path or workflow_id required' }, { status: 400 })

    // POST (or GET) the webhook. This is what actually runs the workflow.
    try {
      const url = `${base}/webhook/${path.replace(/^\//, '')}`
      const t = Date.now()
      const res = await fetch(url, {
        method: httpMethod,
        headers: { 'Content-Type': 'application/json' },
        body: httpMethod === 'GET' ? undefined : JSON.stringify(payload ?? {}),
        signal: AbortSignal.timeout(20000),
      })
      const text = await res.text()
      let parsed: unknown = text
      try { parsed = JSON.parse(text) } catch { /* keep as text */ }
      if (!res.ok) {
        return Response.json({
          ok: false,
          status: res.status,
          error: res.status === 404
            ? 'Webhook not found. The workflow may be inactive — activate it in n8n (webhook workflows only receive requests when active).'
            : `n8n webhook returned ${res.status}`,
          detail: parsed,
        }, { status: 502 })
      }
      return Response.json({ ok: true, latency_ms: Date.now() - t, result: parsed })
    } catch (err) {
      return Response.json({ ok: false, error: err instanceof Error ? err.message : 'Trigger failed' }, { status: 502 })
    }
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 })
}
