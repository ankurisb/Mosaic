import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the keys store so provider resolution is driven by a plain map, not the DB.
const store: Record<string, string> = {}
vi.mock('./keys', () => ({
  getKey: async (k: string) => (k in store ? store[k] : (process.env[k] || null)),
}))

import { getProvider, getAiClient, getDefaultModelId, getFastModelId, getTopModelId, getAvailableModels, isAiConfigured } from './models'

function reset(obj: Record<string, string>) {
  for (const k of Object.keys(store)) delete store[k]
  Object.assign(store, obj)
}

describe('AI provider abstraction', () => {
  beforeEach(() => reset({}))

  it('defaults to anthropic when AI_PROVIDER is unset', async () => {
    expect(await getProvider()).toBe('anthropic')
  })

  it('reads bedrock/foundry from AI_PROVIDER (case-insensitive)', async () => {
    reset({ AI_PROVIDER: 'BEDROCK' }); expect(await getProvider()).toBe('bedrock')
    reset({ AI_PROVIDER: 'foundry' }); expect(await getProvider()).toBe('foundry')
    reset({ AI_PROVIDER: 'nonsense' }); expect(await getProvider()).toBe('anthropic')
  })

  it('isAiConfigured: bedrock always ready, foundry needs base URL, anthropic needs key', async () => {
    reset({ AI_PROVIDER: 'bedrock' }); expect(await isAiConfigured()).toBe(true)
    reset({ AI_PROVIDER: 'foundry' }); expect(await isAiConfigured()).toBe(false)
    reset({ AI_PROVIDER: 'foundry', FOUNDRY_BASE_URL: 'https://x.services.ai.azure.com/anthropic' }); expect(await isAiConfigured()).toBe(true)
    reset({ AI_PROVIDER: 'anthropic' }); expect(await isAiConfigured()).toBe(false)
    reset({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-ant-xxx' }); expect(await isAiConfigured()).toBe(true)
  })

  it('bedrock model helpers return the admin-configured ids', async () => {
    reset({ AI_PROVIDER: 'bedrock', BEDROCK_MODEL: 'us.anthropic.claude-sonnet-v1:0', BEDROCK_MODEL_FAST: 'us.anthropic.claude-haiku-v1:0', BEDROCK_MODEL_TOP: 'us.anthropic.claude-opus-v1:0' })
    expect(await getDefaultModelId()).toBe('us.anthropic.claude-sonnet-v1:0')
    expect(await getFastModelId()).toBe('us.anthropic.claude-haiku-v1:0')
    expect(await getTopModelId()).toBe('us.anthropic.claude-opus-v1:0')
  })

  it('bedrock fast/top fall back to primary when unset', async () => {
    reset({ AI_PROVIDER: 'bedrock', BEDROCK_MODEL: 'primary-id' })
    expect(await getFastModelId()).toBe('primary-id')
    expect(await getTopModelId()).toBe('primary-id')
  })

  it('foundry uses deployment ids', async () => {
    reset({ AI_PROVIDER: 'foundry', FOUNDRY_BASE_URL: 'https://x.services.ai.azure.com/anthropic', FOUNDRY_DEPLOYMENT: 'sonnet-dep', FOUNDRY_DEPLOYMENT_FAST: 'haiku-dep' })
    expect(await getDefaultModelId()).toBe('sonnet-dep')
    expect(await getFastModelId()).toBe('haiku-dep')
    // top unset → falls back to primary
    expect(await getTopModelId()).toBe('sonnet-dep')
  })

  it('getAvailableModels for a non-direct provider lists only the configured ids', async () => {
    reset({ AI_PROVIDER: 'bedrock', BEDROCK_MODEL: 'm-primary', BEDROCK_MODEL_FAST: 'm-fast' })
    const list = await getAvailableModels()
    const ids = list.map(m => m.id)
    expect(ids).toContain('m-primary')
    expect(ids).toContain('m-fast')
    expect(ids.length).toBe(2)
  })

  it('getAiClient constructs a messages-capable client for each provider without network I/O', async () => {
    reset({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-ant-xxx' })
    const a = await getAiClient(); expect(typeof a.messages.create).toBe('function')

    reset({ AI_PROVIDER: 'foundry', FOUNDRY_BASE_URL: 'https://x.services.ai.azure.com/anthropic', FOUNDRY_API_KEY: 'key' })
    const f = await getAiClient(); expect(typeof f.messages.create).toBe('function')

    reset({ AI_PROVIDER: 'bedrock', BEDROCK_REGION: 'us-east-1' })
    const b = await getAiClient(); expect(typeof b.messages.create).toBe('function')
  })
})
