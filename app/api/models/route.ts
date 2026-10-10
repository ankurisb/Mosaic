import { getSession } from '@/lib/auth'
import { getAvailableModels, getDefaultModelId } from '@/lib/models'
export const runtime = 'nodejs'

// Live list of selectable models (from the Anthropic API via lib/models) plus the
// resolved default. Powers the chat model picker so it always reflects what's
// actually available — no hardcoded option list in the client.
export async function GET() {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  try {
    const [models, def] = await Promise.all([getAvailableModels(), getDefaultModelId()])
    return Response.json({ models, default: def })
  } catch {
    return Response.json({ models: [], default: '' })
  }
}
