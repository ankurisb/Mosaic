// lib/models.ts
// Single source of truth for which Claude models are available and what they cost.
//
// The AVAILABLE model list is fetched live from the Anthropic API (client.models.list)
// — nothing hardcoded — so new models (e.g. a new Sonnet/Opus/Fable) appear
// automatically with no code change. Deprecated/retired models are filtered out and
// the list is sorted newest-first.
//
// PRICING cannot come from the API (Anthropic doesn't expose per-token prices), so it
// is resolved as: per-model admin override (MODEL_PRICING_OVERRIDES, $/MTok) → tier
// default by model family → generic fallback (flagged unpriced). The tier defaults are
// editable seeds for cost accounting, NOT an allow-list: any model the API returns is
// usable even if it has no exact price yet.

import Anthropic from '@anthropic-ai/sdk'
import { getKey } from './keys'

export interface ModelOption { id: string; label: string; created_at?: string }
export interface ModelPricing { input: number; output: number; label: string; unpriced?: boolean }

// Tier default rates in $/token (value / 1e6 = per-token). Seeds only — overridable
// per-model via the MODEL_PRICING_OVERRIDES setting. Order matters (first match wins).
const TIER_PRICING: { match: RegExp; input: number; output: number }[] = [
  { match: /haiku/i,  input: 1 / 1e6, output: 5 / 1e6 },
  { match: /sonnet/i, input: 3 / 1e6, output: 15 / 1e6 },
  { match: /opus/i,   input: 5 / 1e6, output: 25 / 1e6 },
  { match: /fable/i,  input: 3 / 1e6, output: 15 / 1e6 },
]
const FALLBACK_PRICE = { input: 3 / 1e6, output: 15 / 1e6 }

// Minimal fallback list used ONLY when the API can't be reached (air-gapped / no key).
// Not an allow-list — when online the list is 100% whatever the API returns.
const SEED_MODELS: ModelOption[] = [
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
  { id: 'claude-opus-5', label: 'Claude Opus 5' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
]

let _cache: { at: number; models: ModelOption[] } | null = null
const TTL_MS = 60 * 60 * 1000

/** Live model list from the API (cached 1h). Falls back to last-good, then seed. */
export async function getAvailableModels(): Promise<ModelOption[]> {
  if (_cache && Date.now() - _cache.at < TTL_MS) return _cache.models
  let key: string | null = null
  try { key = await getKey('ANTHROPIC_API_KEY') } catch { key = null }
  if (key) {
    try {
      const client = new Anthropic({ apiKey: key })
      const out: ModelOption[] = []
      for await (const m of client.models.list({ limit: 100 })) {
        if ((m as { lifecycle?: string }).lifecycle && (m as { lifecycle?: string }).lifecycle !== 'active') continue
        out.push({ id: m.id, label: m.display_name || m.id, created_at: (m as { created_at?: string }).created_at })
      }
      if (out.length) {
        out.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
        _cache = { at: Date.now(), models: out }
        return out
      }
    } catch { /* fall through to cache/seed */ }
  }
  if (_cache) return _cache.models   // stale but better than seed
  return SEED_MODELS
}

/** Resolve the configured/sensible default model id (never hardcoded to one literal). */
export async function getDefaultModelId(): Promise<string> {
  const models = await getAvailableModels()
  const envd = process.env.MOSAIC_DEFAULT_MODEL
  if (envd && models.some(m => m.id === envd)) return envd
  // models are newest-first; prefer the newest Sonnet (balanced), else newest overall.
  const sonnet = models.find(m => /sonnet/i.test(m.id))
  return (sonnet || models[0])?.id || SEED_MODELS[0].id
}

/** A cheap/fast model id for internal helper calls (classification, etc.). */
export async function getFastModelId(): Promise<string> {
  const models = await getAvailableModels()
  const haiku = models.find(m => /haiku/i.test(m.id))
  if (haiku) return haiku.id
  return getDefaultModelId()
}

/** True if the requested id is a currently-available model. */
export async function isModelAvailable(id: string): Promise<boolean> {
  if (!id) return false
  const models = await getAvailableModels()
  return models.some(m => m.id === id)
}

/** Resolve the requested id to an available one, else the default. */
export async function resolveModelId(requested: string | undefined): Promise<string> {
  if (requested && await isModelAvailable(requested)) return requested
  return getDefaultModelId()
}

async function getPricingOverrides(): Promise<Record<string, { input: number; output: number }>> {
  try {
    const raw = await getKey('MODEL_PRICING_OVERRIDES')
    if (!raw) return {}
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return (parsed && typeof parsed === 'object') ? parsed : {}
  } catch { return {} }
}

/** Per-token pricing for a model: admin override ($/MTok) → tier default → fallback. */
export async function getModelPricing(id: string): Promise<ModelPricing> {
  const ov = (await getPricingOverrides())[id]
  if (ov && Number.isFinite(ov.input) && Number.isFinite(ov.output)) {
    return { input: ov.input / 1e6, output: ov.output / 1e6, label: id }
  }
  const tier = TIER_PRICING.find(t => t.match.test(id))
  if (tier) return { input: tier.input, output: tier.output, label: id }
  return { input: FALLBACK_PRICE.input, output: FALLBACK_PRICE.output, label: id, unpriced: true }
}
