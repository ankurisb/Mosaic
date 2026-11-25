import { describe, it, expect } from 'vitest'
import { extractMarkdownTables } from '@/lib/md-table'

describe('extractMarkdownTables — visualisation backstop', () => {
  it('converts a GFM table to a chart artifact and strips it from the text', () => {
    const text = `Here are the OEE figures for the line:

| Machine | OEE % | Downtime (min) |
|---------|------:|---------------:|
| CNC-01  | 82.4  | 45 |
| CNC-02  | 77.1  | 92 |

Overall the line is underperforming on CNC-02.`
    const { cleanText, charts } = extractMarkdownTables(text)
    expect(charts).toHaveLength(1)
    expect(charts[0].kind).toBe('chart_artifact')
    expect(charts[0].spec.type).toBe('table')
    expect(charts[0].spec.columns?.map(c => c.label)).toEqual(['Machine', 'OEE %', 'Downtime (min)'])
    expect(charts[0].spec.rows).toHaveLength(2)
    expect(charts[0].spec.rows?.[0]).toEqual({ c0: 'CNC-01', c1: '82.4', c2: '45' })
    expect(cleanText.includes('|')).toBe(false)
    expect(cleanText).toContain('Overall the line is underperforming')
  })

  it('titles the chart from the preceding short label line', () => {
    const text = `**Machine OEE summary:**
| Machine | OEE % |
|---|---|
| CNC-01 | 82.4 |`
    const { charts } = extractMarkdownTables(text)
    expect(charts[0].spec.title).toBe('Machine OEE summary')
  })

  it('leaves prose with no table untouched (incl. inline code pipes)', () => {
    const plain = 'Just prose, no table. Inline code: `a | b` is fine.'
    const { cleanText, charts } = extractMarkdownTables(plain)
    expect(charts).toHaveLength(0)
    expect(cleanText).toBe(plain)
  })

  it('does not treat a lone pipe line as a table (needs a delimiter row)', () => {
    const text = 'a | b | c\nsome more prose'
    const { charts } = extractMarkdownTables(text)
    expect(charts).toHaveLength(0)
  })

  it('handles multiple tables in one message', () => {
    const text = `| A | B |
|---|---|
| 1 | 2 |

Middle prose.

| C | D |
|---|---|
| 3 | 4 |`
    const { cleanText, charts } = extractMarkdownTables(text)
    expect(charts).toHaveLength(2)
    expect(cleanText.includes('|')).toBe(false)
    expect(cleanText).toContain('Middle prose.')
  })
})
