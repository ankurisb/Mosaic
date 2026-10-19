// lib/ai/describe-schema.ts
// Auto-describe helper for the semantic dictionary. Given a source's real schema +
// sample rows, one bounded model call proposes a plain-language description for each
// table and for the columns whose meaning isn't obvious from the name. Returns a
// DRAFT the user confirms/edits before anything is saved — the same propose→confirm
// loop as the data-source "Test with AI" flow.
import Anthropic from '@anthropic-ai/sdk'
import { getDefaultModelId } from '@/lib/models'
import { getKey } from '@/lib/keys'

export interface DescribeDraftItem {
  object_type: 'table' | 'column'
  object_key: string        // 'orders' | 'orders.cycle_time_s'
  description: string
}
export interface DescribeResult {
  ok: boolean
  items?: DescribeDraftItem[]
  reason?: string
}

const SYSTEM = `You are a data-dictionary assistant for an industrial analytics platform.
Given a database schema and a few sample rows, write SHORT plain-language descriptions
so a text-to-SQL model understands what each table and column means.

Rules:
- Describe every table (one clause each: what one row represents).
- Describe only columns whose meaning is NOT obvious from the name. Skip plain ones
  like id, name, created_at. ALWAYS describe cryptic/industrial columns (e.g. kWh_sf,
  v1n, mb_error, machine_status) — infer meaning from the name and sample values.
- Each description <= 15 words, concrete, no filler. State units where inferable
  (kWh, seconds, volts, %). Do NOT invent facts not supported by name or samples.
- Output ONLY a JSON object: {"items":[{"object_type":"table"|"column","object_key":"<table or table.column>","description":"..."}]}
  object_key must use the exact table names given (and table.column for columns). No markdown, no prose.`

function extractJson(text: string): { items?: DescribeDraftItem[] } {
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('No JSON object in model output')
  return JSON.parse(cleaned.slice(start, end + 1))
}

/**
 * schemaText: the formatted schema (tables/columns) exactly as the model will see it.
 * samples: map of tableName -> up to a few sample row objects.
 */
export async function describeSchema(schemaText: string, samples: Record<string, unknown[]>): Promise<DescribeResult> {
  try {
    const client = new Anthropic({ apiKey: (await getKey('ANTHROPIC_API_KEY')) || undefined })
    const sampleText = Object.entries(samples)
      .map(([t, rows]) => `# ${t}\n${JSON.stringify(rows, null, 0).slice(0, 2000)}`)
      .join('\n')
    const user = [
      `Schema:\n${schemaText}`,
      sampleText ? `\n\nSample rows:\n${sampleText}` : '',
      `\n\nProduce the data-dictionary JSON.`,
    ].join('')
    const msg = await client.messages.create({
      model: await getDefaultModelId(),
      max_tokens: 3000,
      system: SYSTEM,
      messages: [{ role: 'user', content: user }],
    })
    const text = (msg.content.find(b => b.type === 'text') as { text: string } | undefined)?.text ?? ''
    const parsed = extractJson(text)
    const items = (parsed.items || [])
      .filter(i => i && (i.object_type === 'table' || i.object_type === 'column') && i.object_key && i.description)
      .map(i => ({ object_type: i.object_type, object_key: String(i.object_key), description: String(i.description).trim() }))
    return { ok: true, items }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}
