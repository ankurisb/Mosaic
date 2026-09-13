// lib/csv-parse.ts
// Minimal RFC-4180 CSV parser. The previous naive `line.split(',')` broke on any
// quoted field containing a comma (very common in industrial data — descriptions,
// downtime reasons, part names): it split at the internal comma, truncating the field
// AND shifting every subsequent column, producing silently WRONG data. This parses
// quoted fields, escaped quotes ("" -> "), and quoted newlines correctly.

export interface ParsedCsv { headers: string[]; rows: Record<string, string>[] }

// Tokenise one CSV row into fields, honouring quotes. `delim` defaults to comma.
function parseLineFields(line: string, delim = ','): string[] {
  const out: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { field += '"'; i++ }  // escaped quote
        else inQuotes = false
      } else field += c
    } else {
      if (c === '"') inQuotes = true
      else if (c === delim) { out.push(field); field = '' }
      else field += c
    }
  }
  out.push(field)
  return out.map(f => f.trim())
}

// Split raw CSV text into logical rows, keeping quoted newlines inside a field
// together (a quoted field may span multiple physical lines).
function splitRows(text: string): string[] {
  const rows: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') {
      // toggle, respecting escaped ""
      if (inQuotes && text[i + 1] === '"') { cur += '""'; i++; continue }
      inQuotes = !inQuotes
      cur += c
    } else if ((c === '\n' || c === '\r') && !inQuotes) {
      if (c === '\r' && text[i + 1] === '\n') i++  // CRLF
      if (cur.length) { rows.push(cur); cur = '' }
    } else {
      cur += c
    }
  }
  if (cur.length) rows.push(cur)
  return rows
}

// Detect the delimiter from the header line (comma, semicolon, or tab) — European
// exports and some historians use ; or tab.
function detectDelim(headerLine: string): string {
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 }
  let inQ = false
  for (const c of headerLine) {
    if (c === '"') inQ = !inQ
    else if (!inQ && c in counts) counts[c]++
  }
  return (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[1] ?? 0) > 0
    ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
    : ','
}

export function parseCsv(text: string, maxRows = 500): ParsedCsv {
  const rawRows = splitRows(text).filter(r => r.trim().length > 0)
  if (!rawRows.length) return { headers: [], rows: [] }
  const delim = detectDelim(rawRows[0])
  const headers = parseLineFields(rawRows[0], delim)
  const rows: Record<string, string>[] = []
  for (let i = 1; i < rawRows.length && rows.length < maxRows; i++) {
    const fields = parseLineFields(rawRows[i], delim)
    const row: Record<string, string> = {}
    for (let j = 0; j < headers.length; j++) row[headers[j]] = fields[j] ?? ''
    rows.push(row)
  }
  return { headers, rows }
}
