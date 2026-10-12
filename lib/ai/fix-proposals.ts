// lib/ai/fix-proposals.ts
// Short-lived, in-process store of config fixes the diagnoser proposed, so a
// chat apply is a clean two-step confirm: diagnose returns a fix_id + a
// human-readable diff; the user confirms; apply_api_fix(fix_id, confirm:true)
// looks the proposal back up and applies it. The large candidate never has to
// round-trip through the model, and "confirm" is a real gate (a second tool
// call that can only happen after a user turn), not model discretion.
// Single-process box, same pattern as the token caches in lib/api-auth.

import type { AgentCandidate } from '@/lib/ai/api-agent'

export interface FixProposal {
  serviceId: string
  candidate: AgentCandidate
  diagnosis?: string
  createdAt: number
}

const TTL_MS = 15 * 60 * 1000
const store = new Map<string, FixProposal>()

function sweep() {
  const now = Date.now()
  for (const [k, v] of store) if (now - v.createdAt > TTL_MS) store.delete(k)
}

export function putProposal(p: Omit<FixProposal, 'createdAt'>): string {
  sweep()
  const id = `fix_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  store.set(id, { ...p, createdAt: Date.now() })
  return id
}

export function getProposal(id: string): FixProposal | undefined {
  sweep()
  const p = store.get(id)
  if (!p) return undefined
  if (Date.now() - p.createdAt > TTL_MS) { store.delete(id); return undefined }
  return p
}

export function dropProposal(id: string): void {
  store.delete(id)
}
