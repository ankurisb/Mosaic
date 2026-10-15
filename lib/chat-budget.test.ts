// lib/chat-budget.test.ts
import { describe, it, expect } from 'vitest'
import { parseToolBudget, chatTurnMode, BUILD_TOOL_NAMES } from './chat-budget'

describe('parseToolBudget', () => {
  it('defaults to 40 when unset or invalid', () => {
    expect(parseToolBudget(undefined)).toBe(40)
    expect(parseToolBudget('')).toBe(40)
    expect(parseToolBudget('abc')).toBe(40)
  })
  it('honours a valid value', () => {
    expect(parseToolBudget('60')).toBe(60)
    expect(parseToolBudget('4')).toBe(4)
    expect(parseToolBudget('200')).toBe(200)
  })
  it('rejects out-of-range values', () => {
    expect(parseToolBudget('3')).toBe(40)
    expect(parseToolBudget('201')).toBe(40)
    expect(parseToolBudget('-5')).toBe(40)
  })
})

describe('chatTurnMode', () => {
  const B = 40, G = 6
  it('normal well under budget', () => {
    expect(chatTurnMode(0, B, G)).toBe('normal')
    expect(chatTurnMode(30, B, G)).toBe('normal')
  })
  it('approaching within 4 of budget', () => {
    expect(chatTurnMode(36, B, G)).toBe('approaching')
    expect(chatTurnMode(39, B, G)).toBe('approaching')
  })
  it('build at/over budget, within grace', () => {
    expect(chatTurnMode(40, B, G)).toBe('build')
    expect(chatTurnMode(45, B, G)).toBe('build')
  })
  it('synthesis past budget + grace', () => {
    expect(chatTurnMode(46, B, G)).toBe('synthesis')
    expect(chatTurnMode(100, B, G)).toBe('synthesis')
  })
})

describe('BUILD_TOOL_NAMES', () => {
  it('includes the deliverable tools and excludes data-source tools', () => {
    expect(BUILD_TOOL_NAMES.has('run_code')).toBe(true)
    expect(BUILD_TOOL_NAMES.has('render_chart')).toBe(true)
    expect(BUILD_TOOL_NAMES.has('render_map')).toBe(true)
    expect(BUILD_TOOL_NAMES.has('call_api')).toBe(false)
    expect(BUILD_TOOL_NAMES.has('query_database')).toBe(false)
  })
})
