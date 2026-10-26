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

// ── LLM provider abstraction ────────────────────────────────────────────────
// Mosaic talks to Claude through one of three providers, chosen by the customer
// admin in the setup wizard / Settings (stored as encrypted settings, never an
// env file hand-edit). All three speak the same Anthropic Messages API, so only
// client construction and the model IDs differ — every AI call site uses
// getAiClient() + the model helpers below, so switching provider is config-only.
//   - anthropic : direct Anthropic API (api key)
//   - bedrock   : Claude on Amazon Bedrock, inside the customer's AWS account
//   - foundry   : Claude on Azure AI Foundry, inside the customer's Azure tenancy
export type AiProvider = 'anthropic' | 'bedrock' | 'foundry'

export async function getProvider(): Promise<AiProvider> {
  try { const p = (await getKey('AI_PROVIDER') || '').toLowerCase(); if (p === 'bedrock' || p === 'foundry') return p } catch { /* default */ }
  return 'anthropic'
}

/**
 * The provider-configured client every AI path uses instead of `new Anthropic()`.
 * Returns an Anthropic-SDK-compatible client (Bedrock/Foundry clients share the
 * `.messages` interface), so callers are unchanged.
 */
export async function getAiClient(): Promise<Anthropic> {
  const provider = await getProvider()
  if (provider === 'bedrock') {
    const { AnthropicBedrock } = await import('@anthropic-ai/bedrock-sdk')
    const awsRegion = (await getKey('BEDROCK_REGION')) || 'us-east-1'
    const awsAccessKey = (await getKey('BEDROCK_ACCESS_KEY_ID')) || null
    const awsSecretKey = (await getKey('BEDROCK_SECRET_ACCESS_KEY')) || null
    const awsSessionToken = (await getKey('BEDROCK_SESSION_TOKEN')) || null
    // No static keys → the AWS default credential chain (IAM instance/task role),
    // the clean "no secrets to enter" path when Mosaic runs on the customer's own
    // EC2/ECS. Explicit keys are only used when the admin supplies them.
    const cfg: Record<string, unknown> = { awsRegion }
    if (awsAccessKey && awsSecretKey) { cfg.awsAccessKey = awsAccessKey; cfg.awsSecretKey = awsSecretKey; if (awsSessionToken) cfg.awsSessionToken = awsSessionToken }
    return new AnthropicBedrock(cfg) as unknown as Anthropic
  }
  if (provider === 'foundry') {
    // Claude on Azure AI Foundry: standard Anthropic Messages API at
    // https://<resource>.services.ai.azure.com/anthropic, api-key auth (x-api-key,
    // which the SDK sends from `apiKey`). Entra/managed-identity is a later option.
    const baseURL = ((await getKey('FOUNDRY_BASE_URL')) || '').replace(/\/+$/, '')
    const apiKey = (await getKey('FOUNDRY_API_KEY')) || undefined
    return new Anthropic({ baseURL: baseURL || undefined, apiKey })
  }
  return new Anthropic({ apiKey: (await getKey('ANTHROPIC_API_KEY')) || undefined })
}

/**
 * True when the active provider has enough config to make a call. Call sites use
 * this instead of checking for ANTHROPIC_API_KEY directly, so the no-key paths
 * (Bedrock via IAM role, Foundry via base URL) aren't wrongly treated as unset.
 *   - anthropic : an API key is present
 *   - bedrock   : always ready (static keys OR the AWS default credential chain)
 *   - foundry   : a base URL is present (api key optional if the gateway allows)
 */
export async function isAiConfigured(): Promise<boolean> {
  const provider = await getProvider()
  if (provider === 'bedrock') return true
  if (provider === 'foundry') return !!(await getKey('FOUNDRY_BASE_URL'))
  try { return !!(await getKey('ANTHROPIC_API_KEY')) } catch { return false }
}

/** Configured model IDs for a non-direct provider (admin-entered Bedrock model /
 *  Foundry deployment names). Returns {} for the direct Anthropic provider. */
async function configuredModels(provider: AiProvider): Promise<{ primary?: string; fast?: string; top?: string }> {
  if (provider === 'bedrock') {
    return { primary: (await getKey('BEDROCK_MODEL')) || undefined, fast: (await getKey('BEDROCK_MODEL_FAST')) || undefined, top: (await getKey('BEDROCK_MODEL_TOP')) || undefined }
  }
  if (provider === 'foundry') {
    return { primary: (await getKey('FOUNDRY_DEPLOYMENT')) || undefined, fast: (await getKey('FOUNDRY_DEPLOYMENT_FAST')) || undefined, top: (await getKey('FOUNDRY_DEPLOYMENT_TOP')) || undefined }
  }
  return {}
}

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

/** Live model list from the API (cached 1h). Falls back to last-good, then seed.
 *  For Bedrock/Foundry the API list doesn't apply (different IDs, no models.list),
 *  so the available models are exactly the IDs the admin configured. */
export async function getAvailableModels(): Promise<ModelOption[]> {
  const provider = await getProvider()
  if (provider !== 'anthropic') {
    const c = await configuredModels(provider)
    const seen = new Set<string>()
    const out: ModelOption[] = []
    const add = (id: string | undefined, suffix: string) => { if (id && !seen.has(id)) { seen.add(id); out.push({ id, label: suffix ? `${id} (${suffix})` : id }) } }
    add(c.primary, ''); add(c.top, 'top'); add(c.fast, 'fast')
    // If nothing configured yet, surface the seeds so the UI isn't empty; the
    // provider will still reject an invalid ID, which the Test action catches.
    return out.length ? out : SEED_MODELS
  }
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
  const provider = await getProvider()
  if (provider !== 'anthropic') {
    const c = await configuredModels(provider)
    return c.primary || (await getAvailableModels())[0]?.id || SEED_MODELS[0].id
  }
  const models = await getAvailableModels()
  const envd = process.env.MOSAIC_DEFAULT_MODEL
  if (envd && models.some(m => m.id === envd)) return envd
  // models are newest-first; prefer the newest Sonnet (balanced), else newest overall.
  const sonnet = models.find(m => /sonnet/i.test(m.id))
  return (sonnet || models[0])?.id || SEED_MODELS[0].id
}

/** A cheap/fast model id for internal helper calls (classification, etc.). */
export async function getFastModelId(): Promise<string> {
  const provider = await getProvider()
  if (provider !== 'anthropic') {
    const c = await configuredModels(provider)
    return c.fast || c.primary || getDefaultModelId()
  }
  const models = await getAvailableModels()
  const haiku = models.find(m => /haiku/i.test(m.id))
  if (haiku) return haiku.id
  return getDefaultModelId()
}

/** The most capable model id (newest Opus), for escalating the hardest queries. */
export async function getTopModelId(): Promise<string> {
  const provider = await getProvider()
  if (provider !== 'anthropic') {
    const c = await configuredModels(provider)
    return c.top || c.primary || getDefaultModelId()
  }
  const models = await getAvailableModels()
  const opus = models.find(m => /opus/i.test(m.id))
  if (opus) return opus.id
  return getDefaultModelId()
}

// Escalation of the very hardest RCA queries to the top (Opus) tier. OFF by
// default so Auto never silently raises cost; RCA still always gets the default
// model (today's behaviour) regardless of this flag.
const AUTO_ESCALATE = process.env.AUTO_MODEL_ESCALATE === '1'

/**
 * Auto model routing — pick a model by query shape when the user hasn't chosen one.
 *
 * SAFE BY CONSTRUCTION: an RCA query (or anything not clearly trivial) always gets
 * the DEFAULT model — identical to today's behaviour — or, only with AUTO_MODEL_ESCALATE
 * on, the top tier for the heaviest RCAs. The ONLY downgrade is clearly-trivial
 * small-talk (greetings/acknowledgements) → the fast model. When unsure it returns
 * the default, so a real query can never be silently answered by a weaker model.
 */
export async function pickAutoModel(text: string, opts: { isRca?: boolean } = {}): Promise<string> {
  if (opts.isRca) {
    if (AUTO_ESCALATE && /\b(deep[- ]dive|full (rca|investigation|analysis)|comprehensive|end[- ]to[- ]end|everything)\b/i.test(text)) {
      return getTopModelId()
    }
    return getDefaultModelId()   // RCA floor — never below today's default
  }
  const t = (text || '').trim()
  const smalltalk = t.length <= 80 &&
    /^(hi|hey+|hello|yo|thanks|thank you|thx|ta|ok|okay|k|cool|nice|great|cheers|got it|good (morning|afternoon|evening))\b[\s!.?]*$/i.test(t)
  if (smalltalk) return getFastModelId()
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
