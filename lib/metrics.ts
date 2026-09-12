// lib/metrics.ts
// Metrics & definitions layer — lets a customer define their business terms ONCE
// (how THEY compute OEE, what a 'defect' means, which machines are 'Line A') so every
// AI answer uses THEIR definitions, consistently. This is the "fix the context, not the
// model" lesson: manufacturing answers are only trustworthy when the AI uses the
// plant's own definitions, not a generic guess. Mirrors the guardrail-rules injection
// pattern (a small table + a prompt-injection helper).
import { getDb } from './db'

export interface MetricDefinition {
  id: string
  name: string          // e.g. "OEE", "First Pass Yield", "Line A"
  kind: string          // 'metric' | 'entity' | 'term'
  definition: string    // plain-language definition the AI reads
  formula: string | null // optional explicit formula/SQL expression
  applies_to: string | null // optional: which source/table it relates to
  enabled: number
}

// Build the system-prompt block. Kept compact and unambiguous so the model treats
// these as authoritative over its own assumptions. Returns '' when none defined.
export async function getMetricsInjection(): Promise<string> {
  try {
    const sql = getDb()
    const rows = await sql`
      SELECT name, kind, definition, formula, applies_to
      FROM metric_definitions
      WHERE enabled = 1
      ORDER BY kind, name
    ` as unknown as MetricDefinition[]
    if (!rows.length) return ''

    const metrics = rows.filter(r => r.kind !== 'entity')
    const entities = rows.filter(r => r.kind === 'entity')

    let out = '\n\n## Business definitions (AUTHORITATIVE — use these exact definitions, not your own assumptions)\n'
    out += 'When the user refers to any term below, compute/interpret it EXACTLY as defined here. If a question needs a metric not defined here, say how you computed it.\n'

    if (metrics.length) {
      out += '\nMetrics:\n'
      for (const m of metrics) {
        out += `- ${m.name}: ${m.definition}`
        if (m.formula) out += ` (formula: ${m.formula})`
        if (m.applies_to) out += ` [source: ${m.applies_to}]`
        out += '\n'
      }
    }
    if (entities.length) {
      out += '\nEntities / groupings:\n'
      for (const e of entities) {
        out += `- ${e.name}: ${e.definition}`
        if (e.applies_to) out += ` [source: ${e.applies_to}]`
        out += '\n'
      }
    }
    return out
  } catch {
    return ''
  }
}
