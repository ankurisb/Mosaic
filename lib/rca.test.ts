import { describe, test, expect } from 'vitest'
import { isRcaQuery, parseRcaOutput } from './rca'

// ── isRcaQuery ────────────────────────────────────────────────────────────────

describe('isRcaQuery', () => {
  test('detects root cause keyword', () => {
    expect(isRcaQuery('what is the root cause of this failure?')).toBe(true)
  })

  test('detects rca keyword', () => {
    expect(isRcaQuery('run an RCA on PRESS-01')).toBe(true)
  })

  test('detects 5 why keyword', () => {
    expect(isRcaQuery('do a 5 why analysis')).toBe(true)
  })

  test('detects fishbone keyword', () => {
    expect(isRcaQuery('show me a fishbone diagram')).toBe(true)
  })

  test('detects downtime keyword', () => {
    expect(isRcaQuery('why did the machine have downtime yesterday?')).toBe(true)
  })

  test('detects defect keyword', () => {
    expect(isRcaQuery('we have too many defects on line B')).toBe(true)
  })

  test('detects failure keyword', () => {
    expect(isRcaQuery('bearing failure on CNC-03')).toBe(true)
  })

  test('detects oee drop keyword', () => {
    expect(isRcaQuery('there has been an OEE drop this week')).toBe(true)
  })

  test('detects corrective action keyword', () => {
    expect(isRcaQuery('what corrective action should we take?')).toBe(true)
  })

  test('is case-insensitive', () => {
    expect(isRcaQuery('ROOT CAUSE ANALYSIS needed')).toBe(true)
    expect(isRcaQuery('FISHBONE chart please')).toBe(true)
  })

  test('returns false for general question', () => {
    expect(isRcaQuery('what is OEE?')).toBe(false)
  })

  test('returns false for data query', () => {
    expect(isRcaQuery('show me all machines and their current status')).toBe(false)
  })

  test('returns false for empty string', () => {
    expect(isRcaQuery('')).toBe(false)
  })

  test('returns false for greeting', () => {
    expect(isRcaQuery('hello, how are you?')).toBe(false)
  })
})

// ── parseRcaOutput ────────────────────────────────────────────────────────────

const VALID_RCA_BLOCK = JSON.stringify({
  renderers: [
    { type: 'pareto', insight: 'Top 3 causes account for 80% of defects', data: { rows: [], total: 100 } }
  ],
  actions: [
    { id: 'export_word', label: 'Export as Word doc' }
  ]
})

describe('parseRcaOutput', () => {
  test('extracts rca block from text with tags', () => {
    const raw = `Analysis complete.\n<rca_output>${VALID_RCA_BLOCK}</rca_output>`
    const { text, rca } = parseRcaOutput(raw)
    expect(rca).not.toBeNull()
    expect(rca?.renderers).toHaveLength(1)
    expect(rca?.renderers[0].type).toBe('pareto')
  })

  test('strips rca_output tags from returned text', () => {
    const raw = `Some analysis.\n<rca_output>${VALID_RCA_BLOCK}</rca_output>`
    const { text } = parseRcaOutput(raw)
    expect(text).toBe('Some analysis.')
    expect(text).not.toContain('<rca_output>')
    expect(text).not.toContain('</rca_output>')
  })

  test('returns null rca if no rca_output tag present', () => {
    const { text, rca } = parseRcaOutput('Just a plain response with no RCA block.')
    expect(rca).toBeNull()
    expect(text).toBe('Just a plain response with no RCA block.')
  })

  test('returns null rca for malformed JSON inside tag — but still strips the tag', () => {
    const raw = `Text before.\n<rca_output>{ this is not valid json }</rca_output>`
    const { text, rca } = parseRcaOutput(raw)
    expect(rca).toBeNull()
    expect(text).toBe('Text before.')
    expect(text).not.toContain('<rca_output>')
  })

  test('handles rca block with actions array', () => {
    const { rca } = parseRcaOutput(`Done.\n<rca_output>${VALID_RCA_BLOCK}</rca_output>`)
    expect(rca?.actions).toHaveLength(1)
    expect(rca?.actions?.[0].id).toBe('export_word')
  })

  test('handles empty string input', () => {
    const { text, rca } = parseRcaOutput('')
    expect(rca).toBeNull()
    expect(text).toBe('')
  })

  test('text is trimmed after tag removal', () => {
    const raw = `  Analysis.  \n<rca_output>${VALID_RCA_BLOCK}</rca_output>\n  `
    const { text } = parseRcaOutput(raw)
    expect(text).toBe('Analysis.')
  })
})
