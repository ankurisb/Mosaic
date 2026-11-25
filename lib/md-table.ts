// lib/md-table.ts
// Always-on visualisation backstop. The chat model is instructed never to emit a
// markdown table — it must call render_chart (type:'table') — but that is a
// prompt rule, not a guarantee. This deterministically converts any
// GitHub-flavoured markdown table left in a final assistant message into
// render_chart table artifacts and strips it from the text, so a raw pipe-table
// can NEVER reach the stored transcript regardless of model behaviour.
//
// Pure and dependency-free (type-only import of ChartArtifact, erased at
// runtime) so it can be imported and unit-tested in isolation.
import type { ChartArtifact } from '@/lib/tools'

export function extractMarkdownTables(text: string): { cleanText: string; charts: ChartArtifact[] } {
  if (!text || text.indexOf('|') === -1) return { cleanText: text, charts: [] }
  const lines = text.split('\n')
  const charts: ChartArtifact[] = []
  const out: string[] = []
  const isRow = (l: string) => l.includes('|') && l.trim() !== ''
  // A GFM delimiter row: cells of only -, :, spaces (e.g. |---|:--:|)
  const isDelim = (l: string) => /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/.test(l)
  const splitCells = (l: string) => {
    let s = l.trim()
    if (s.startsWith('|')) s = s.slice(1)
    if (s.endsWith('|')) s = s.slice(0, -1)
    // Split on unescaped pipes only.
    return s.split(/(?<!\\)\|/).map(c => c.trim())
  }
  // Nearest preceding short non-empty line becomes the table title if it reads
  // like a heading/label, so the artifact isn't generically titled "Results".
  const titleFromContext = (idx: number): string => {
    for (let j = idx - 1; j >= 0 && j >= idx - 3; j--) {
      const raw = (lines[j] || '').trim()
      if (!raw) continue
      const cand = raw.replace(/^#+\s*/, '').replace(/\*\*/g, '').replace(/:$/, '').trim()
      if (cand && cand.length <= 80 && !cand.includes('|')) return cand
      break
    }
    return 'Results'
  }
  let i = 0
  while (i < lines.length) {
    // A table is: header row, delimiter row, then >=1 body rows.
    if (i + 1 < lines.length && isRow(lines[i]) && isDelim(lines[i + 1])) {
      const header = splitCells(lines[i])
      let j = i + 2
      const bodyRows: string[][] = []
      while (j < lines.length && isRow(lines[j]) && !isDelim(lines[j])) {
        bodyRows.push(splitCells(lines[j]))
        j++
      }
      if (header.length >= 1 && bodyRows.length >= 1) {
        const columns = header.map((h, ci) => ({ key: `c${ci}`, label: h || `Column ${ci + 1}`, format: 'text' as const }))
        const rows = bodyRows.map(cells => {
          const r: Record<string, unknown> = {}
          columns.forEach((col, ci) => { r[col.key] = cells[ci] != null ? cells[ci].replace(/<br\s*\/?>/gi, ' ').replace(/\\\|/g, '|') : '' })
          return r
        })
        charts.push({ kind: 'chart_artifact', spec: { type: 'table', title: titleFromContext(i), columns, rows } })
        i = j
        continue
      }
    }
    out.push(lines[i])
    i++
  }
  // Collapse the blank lines left where tables were removed.
  const cleanText = out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  return { cleanText, charts }
}
