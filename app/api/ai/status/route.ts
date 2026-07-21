// -- /api/ai/status -------------------------------------------
// Is an AI model available to this deployment?
//
// Any authenticated user can call this (unlike /api/setup-status, which is
// admin-only) so ordinary surfaces can degrade gracefully instead of offering
// controls that fail. Returns no key material — only whether one exists.
//
// `disabled` distinguishes a deliberate no-AI deployment (air-gapped site that
// set AI_ENABLED=false) from a key simply not having been added yet, so the UI
// can say the right thing rather than nagging an operator about a choice they
// made on purpose.

import { getSession } from '@/lib/auth'
import { getKey } from '@/lib/keys'

export const runtime = 'nodejs'

export async function GET() {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const [apiKey, aiEnabledRaw] = await Promise.all([
    getKey('ANTHROPIC_API_KEY'),
    getKey('AI_ENABLED'),
  ])

  const disabled = (aiEnabledRaw ?? '').toLowerCase() === 'false'

  return Response.json({
    available: !!apiKey && !disabled,
    disabled,
  })
}
