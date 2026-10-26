import { getSession } from '@/lib/auth'
import { log, newRequestId } from '@/lib/logger'
import { getAiClient, getProvider, getDefaultModelId, isAiConfigured } from '@/lib/models'

export const runtime = 'nodejs'
export const maxDuration = 30

// Live "Test connection" for the active LLM provider. Makes the smallest possible
// Messages call through the same getAiClient() every AI path uses, so a green
// result here means chat/RCA/reports will work too. Admin-only; never echoes
// credentials — only whether the round-trip succeeded, the model that answered,
// and a cleaned-up error string on failure.
export async function POST(req: Request) {
  const requestId = req.headers.get('x-request-id') || newRequestId()
  const reqLog = log.child({ requestId, service: 'ai-provider-test' })
  const session = await getSession()
  if (!session || session.role !== 'admin')
    return Response.json({ error: 'Admin only' }, { status: 403 })

  const provider = await getProvider()
  if (!(await isAiConfigured())) {
    return Response.json({
      ok: false, provider,
      error: provider === 'foundry'
        ? 'Set the Foundry base URL before testing.'
        : 'No credentials configured for this provider yet.',
    })
  }

  const t0 = Date.now()
  try {
    const model = await getDefaultModelId()
    const client = await getAiClient()
    const msg = await client.messages.create({
      model,
      max_tokens: 8,
      messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
    })
    const text = (msg.content.find((b) => (b as { type?: string }).type === 'text') as { text?: string } | undefined)?.text?.trim() || ''
    reqLog.info({ provider, model, latencyMs: Date.now() - t0 }, 'Provider test ok')
    return Response.json({ ok: true, provider, model, latencyMs: Date.now() - t0, reply: text.slice(0, 40) })
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err)
    // Map the common failure shapes to an actionable line without leaking secrets.
    let hint = raw
    if (/credential|security token|UnrecognizedClient|not authorized|AccessDenied/i.test(raw))
      hint = provider === 'bedrock'
        ? 'AWS credentials were rejected or the role lacks bedrock:InvokeModel. Check the IAM role / access keys and that the model is enabled in this region.'
        : 'Authentication was rejected. Check the API key.'
    else if (/could not resolve|ENOTFOUND|ECONNREFUSED|getaddrinfo|fetch failed/i.test(raw))
      hint = 'Could not reach the endpoint. Check the base URL / region and network egress.'
    else if (/model|not found|does not exist|invalid.*model|ValidationException/i.test(raw))
      hint = provider === 'anthropic'
        ? `Model was rejected: ${raw}`
        : 'The configured model / deployment id was rejected. Check it matches a model enabled in your account for this region.'
    reqLog.warn({ provider, err: raw, latencyMs: Date.now() - t0 }, 'Provider test failed')
    return Response.json({ ok: false, provider, latencyMs: Date.now() - t0, error: hint })
  }
}
