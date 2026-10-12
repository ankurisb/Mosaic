// lib/chat-history.ts
// Keep a tool-using message history well-formed for the Anthropic API.
// History trimming (last-N slice, char-budget trimming) can cut between an
// assistant's tool_use block and the following user's tool_result, leaving an
// orphan. The API then rejects the ENTIRE request with
//   "unexpected tool_use_id found in tool_result blocks" (orphan tool_result), or
//   "tool_use ids were found without tool_result blocks" (orphan tool_use).
// sanitizeHistory drops any unmatched tool block on either side and removes
// messages left empty, so the request is always valid however it was trimmed.
import type Anthropic from '@anthropic-ai/sdk'

type Block = { type?: string; id?: string; tool_use_id?: string }

export function sanitizeHistory(hist: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  // Forward pass: a user tool_result must match the IMMEDIATELY preceding
  // assistant message's tool_use ids.
  const pass1: Anthropic.MessageParam[] = []
  let prevToolUseIds = new Set<string>()
  for (const m of hist) {
    if (Array.isArray(m.content)) {
      if (m.role === 'user') {
        const kept = (m.content as Block[]).filter(b => b.type === 'tool_result' ? prevToolUseIds.has(String(b.tool_use_id)) : true)
        prevToolUseIds = new Set()
        if (kept.length) pass1.push({ role: 'user', content: kept as typeof m.content })
      } else {
        prevToolUseIds = new Set((m.content as Block[]).filter(b => b.type === 'tool_use').map(b => String(b.id)))
        pass1.push(m)
      }
    } else {
      prevToolUseIds = new Set()
      pass1.push(m)
    }
  }
  // Backward pass: an assistant tool_use must be answered by the IMMEDIATELY
  // following user message's tool_results.
  const out: Anthropic.MessageParam[] = []
  for (let i = 0; i < pass1.length; i++) {
    const m = pass1[i]
    if (Array.isArray(m.content) && m.role === 'assistant' && (m.content as Block[]).some(b => b.type === 'tool_use')) {
      const next = pass1[i + 1]
      const answered = new Set<string>()
      if (next && Array.isArray(next.content) && next.role === 'user') {
        for (const b of next.content as Block[]) if (b.type === 'tool_result') answered.add(String(b.tool_use_id))
      }
      const kept = (m.content as Block[]).filter(b => b.type === 'tool_use' ? answered.has(String(b.id)) : true)
      if (kept.length) out.push({ role: 'assistant', content: kept as typeof m.content })
      // else: drop the assistant message entirely (all its tool_use are unanswered)
    } else {
      out.push(m)
    }
  }
  return out
}
