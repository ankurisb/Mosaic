import { describe, test, expect } from 'vitest'
import { sanitizeHistory } from './chat-history'
import type Anthropic from '@anthropic-ai/sdk'

const txt = (role: 'user' | 'assistant', t: string): Anthropic.MessageParam => ({ role, content: t })
const asstTool = (id: string): Anthropic.MessageParam => ({ role: 'assistant', content: [{ type: 'text', text: 'calling' }, { type: 'tool_use', id, name: 'call_api', input: {} }] })
const userResult = (id: string): Anthropic.MessageParam => ({ role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] })

describe('sanitizeHistory', () => {
  test('leaves a well-formed tool exchange untouched', () => {
    const h = [txt('user', 'hi'), asstTool('t1'), userResult('t1'), txt('assistant', 'done')]
    expect(sanitizeHistory(h)).toEqual(h)
  })

  test('drops an orphaned tool_result whose tool_use was trimmed away (the 400 bug)', () => {
    // trimHistory cut the assistant(tool_use), leaving the user(tool_result) first
    const h = [userResult('t1'), txt('assistant', 'answer')]
    const out = sanitizeHistory(h)
    expect(out).toEqual([txt('assistant', 'answer')])
  })

  test('drops an orphaned tool_result mixed with text, keeps the text', () => {
    const h: Anthropic.MessageParam[] = [
      { role: 'user', content: [{ type: 'text', text: 'q' }, { type: 'tool_result', tool_use_id: 'gone', content: 'x' }] },
    ]
    const out = sanitizeHistory(h)
    expect(out).toHaveLength(1)
    expect((out[0].content as unknown[]).length).toBe(1)
    expect((out[0].content as { type: string }[])[0].type).toBe('text')
  })

  test('drops an assistant tool_use that was never answered', () => {
    const h = [txt('user', 'hi'), asstTool('t1'), txt('user', 'next question')]
    const out = sanitizeHistory(h)
    // the assistant message had ONLY an unanswered tool_use (plus text) -> text kept, tool_use dropped
    expect(out).toHaveLength(3)
    const assistantContent = out[1].content as { type: string }[]
    expect(assistantContent.every(b => b.type !== 'tool_use')).toBe(true)
    expect(assistantContent.some(b => b.type === 'text')).toBe(true)
  })

  test('keeps matched pairs while dropping an unmatched one in the same list', () => {
    const h = [txt('user', 'hi'), asstTool('good'), userResult('good'), userResult('orphan')]
    const out = sanitizeHistory(h)
    // the trailing orphan user(tool_result) is dropped; the good pair stays
    expect(out).toEqual([txt('user', 'hi'), asstTool('good'), userResult('good')])
  })

  test('multiple tool_use in one assistant message, only answered ones kept', () => {
    const h: Anthropic.MessageParam[] = [
      { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'x', input: {} }, { type: 'tool_use', id: 'b', name: 'y', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: 'ok' }] },
    ]
    const out = sanitizeHistory(h)
    const ids = (out[0].content as { type: string; id?: string }[]).filter(b => b.type === 'tool_use').map(b => b.id)
    expect(ids).toEqual(['a'])
  })
})
