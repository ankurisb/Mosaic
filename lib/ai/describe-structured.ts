// lib/ai/describe-structured.ts
// Phase 7: one bounded model call that proposes the STRUCTURED semantic model for a
// source's columns — role, unit, aggregation, accumulation, data type — each with a
// confidence (0–1) and a short evidence note. Everything comes back as status='proposed';
// NOTHING is auto-verified. A human verifies in the dictionary UI (or bulk-accepts the
// high-confidence ones). The parse/validate half is pure and unit-tested.
import Anthropic from '@anthropic-ai/sdk'
import { getDefaultModelId, getAiClient } from '@/lib/models'
import { getKey } from '@/lib/keys'
import { coerceStructured } from '@/lib/semantic-model'

export interface StructuredDraftItem {
  object_type: 'column'
  object_key: string
  description: string
  role: string | null
  data_type: string | null
  unit: string | null
  default_aggregation: string | null
  accumulation: string | null
  confidence: number
  evidence: string | null
  status: 'proposed'
}
export interface StructuredProposalResult { ok: boolean; items?: StructuredDraftItem[]; reason?: string }

export const STRUCTURED_SYSTEM = `You are a semantic-model assistant for an industrial analytics platform.
For each COLUMN of the given schema, infer its structured meaning so the platform can
aggregate and plot it correctly. Return, per column:
- role: one of measure | dimension | time | identifier | attribute
- data_type: one of number | string | timestamp | boolean | json
- unit: physical unit if inferable (kWh, kW, s, V, %, °C, units) else null
- default_aggregation: for measures one of sum | avg | min | max | last | count | count_distinct; else null
- accumulation: for measures one of raw | cumulative_counter | rate; else null
- description: <= 15 words, concrete
- confidence: 0.0–1.0, how sure you are of role+aggregation (be honest; cryptic names = lower)
- evidence: one short clause citing the name/sample that justifies the call (or a doubt)

Rules:
- A monotonically increasing meter reading (kWh, run_hours, counts) is accumulation
  "cumulative_counter" with default_aggregation "sum". A rate/ratio (OEE, %, temperature,
  voltage) is "raw" and usually "avg". A plain event count is "sum".
- time: the event timestamp column. identifier: ids/keys. dimension: low-cardinality
  labels (shift, line, status). attribute: descriptive text.
- When genuinely unsure, still propose your best guess but LOWER the confidence and say
  why in evidence. Do not invent units not supported by the name/samples.
- Output ONLY JSON: {"items":[{"object_key":"table.col","role":"...","data_type":"...",
  "unit":"...|null","default_aggregation":"...|null","accumulation":"...|null",
  "description":"...","confidence":0.0,"evidence":"..."}]}. No markdown, no prose.`

export function extractJson(text: string): { items?: unknown[] } {
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('No JSON object in model output')
  return JSON.parse(cleaned.slice(start, end + 1))
}

// PURE: validate + normalise the model's raw items into proposed draft rows. Invalid
// enum values are coerced to null (via coerceStructured); confidence is clamped to 0–1;
// rows without an object_key are dropped. status is always 'proposed'.
export function parseStructuredDraft(raw: unknown[]): StructuredDraftItem[] {
  const out: StructuredDraftItem[] = []
  for (const r of raw || []) {
    const it = r as Record<string, unknown>
    const key = String(it?.object_key ?? '').trim()
    if (!key) continue
    const s = coerceStructured({
      role: it.role, data_type: it.data_type, unit: it.unit,
      default_aggregation: it.default_aggregation, accumulation: it.accumulation,
      confidence: it.confidence, evidence: it.evidence,
    })
    out.push({
      object_type: 'column',
      object_key: key,
      description: String(it.description ?? '').trim().slice(0, 240),
      role: s.role, data_type: s.data_type, unit: s.unit,
      default_aggregation: s.default_aggregation, accumulation: s.accumulation,
      confidence: s.confidence ?? 0,
      evidence: typeof it.evidence === 'string' ? it.evidence.slice(0, 240) : (s.evidence ?? null),
      status: 'proposed',
    })
  }
  return out
}

// Split a proposed draft by a confidence threshold so the UI can bulk-accept the
// confident ones and surface the rest for review. Pure.
export function partitionByConfidence(items: StructuredDraftItem[], threshold = 0.8): { confident: StructuredDraftItem[]; review: StructuredDraftItem[] } {
  const confident: StructuredDraftItem[] = []
  const review: StructuredDraftItem[] = []
  for (const it of items) (it.confidence >= threshold && it.role ? confident : review).push(it)
  return { confident, review }
}

export async function proposeStructured(schemaText: string, samples: Record<string, unknown[]>): Promise<StructuredProposalResult> {
  try {
    const client = await getAiClient()
    const sampleText = Object.entries(samples)
      .map(([t, rows]) => `# ${t}\n${JSON.stringify(rows, null, 0).slice(0, 2000)}`)
      .join('\n')
    const user = [`Schema:\n${schemaText}`, sampleText ? `\n\nSample rows:\n${sampleText}` : '', `\n\nProduce the semantic-model JSON.`].join('')
    const msg = await client.messages.create({
      model: await getDefaultModelId(),
      max_tokens: 4000,
      system: STRUCTURED_SYSTEM,
      messages: [{ role: 'user', content: user }],
    })
    const text = (msg.content.find(b => b.type === 'text') as { text: string } | undefined)?.text ?? ''
    return { ok: true, items: parseStructuredDraft(extractJson(text).items || []) }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}
