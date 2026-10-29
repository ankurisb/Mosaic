import { describe, it, expect, vi } from 'vitest'
import { validateToolName, toAnthropicTool, fillTemplate, runCustomTool, type CustomToolDef } from './custom-tools'

const okSsrf = async () => ({ ok: true })
const blockSsrf = async () => ({ ok: false, reason: 'loopback IP not allowed.' })
const def = (over: Partial<CustomToolDef> = {}): CustomToolDef => ({
  name: 'weather_lookup', description: 'Look up weather', method: 'GET',
  url_template: 'https://api.example.com/w/{city}', read_only: true,
  input_schema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
  ...over,
})

describe('custom tools — name validation', () => {
  it('accepts a safe slug', () => expect(validateToolName('my_tool_2')).toBeNull())
  it('rejects non-slug names', () => { expect(validateToolName('My Tool')).toBeTruthy(); expect(validateToolName('2bad')).toBeTruthy() })
  it('rejects collisions with built-in tools', () => { expect(validateToolName('query_database')).toMatch(/built-in/); expect(validateToolName('run_code')).toMatch(/built-in/) })
})

describe('custom tools — templating', () => {
  it('fills and URL-encodes placeholders', () => {
    const r = fillTemplate('https://x/{city}', { city: 'San Jose' }, true)
    expect(r.filled).toBe('https://x/San%20Jose'); expect(r.missing).toEqual([])
  })
  it('reports missing placeholders', () => {
    const r = fillTemplate('https://x/{city}/{day}', { city: 'SF' }, true)
    expect(r.missing).toEqual(['day'])
  })
})

describe('custom tools — execution safety', () => {
  it('fetches and returns parsed JSON on a read-only GET', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ temp: 20 }), { status: 200 }))
    const out = await runCustomTool(def(), { city: 'SF' }, { fetchImpl: fetchImpl as unknown as typeof fetch, ssrf: okSsrf })
    expect(out).toMatchObject({ status: 200, ok: true, data: { temp: 20 } })
    expect(fetchImpl).toHaveBeenCalledWith('https://api.example.com/w/SF', expect.objectContaining({ method: 'GET' }))
  })

  it('BLOCKS a call whose URL fails the SSRF check', async () => {
    const fetchImpl = vi.fn()
    const out = await runCustomTool(def({ url_template: 'http://169.254.169.254/latest/meta-data/{city}' }), { city: 'x' }, { fetchImpl: fetchImpl as unknown as typeof fetch, ssrf: blockSsrf })
    expect((out as { error: string }).error).toMatch(/Blocked/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('refuses a non-GET method on a read-only tool', async () => {
    const fetchImpl = vi.fn()
    const out = await runCustomTool(def({ method: 'POST', read_only: true }), { city: 'x' }, { fetchImpl: fetchImpl as unknown as typeof fetch, ssrf: okSsrf })
    expect((out as { error: string }).error).toMatch(/read-only/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('errors (never throws) when a required input is missing', async () => {
    const out = await runCustomTool(def(), {}, { ssrf: okSsrf })
    expect((out as { error: string }).error).toMatch(/Missing required/)
  })

  it('returns an error object on fetch failure rather than throwing', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'))
    const out = await runCustomTool(def(), { city: 'SF' }, { fetchImpl: fetchImpl as unknown as typeof fetch, ssrf: okSsrf })
    expect((out as { error: string }).error).toMatch(/network down/)
  })

  it('does NOT follow a redirect (SSRF: the guard only vetted the initial URL)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } }))
    const out = await runCustomTool(def(), { city: 'SF' }, { fetchImpl: fetchImpl as unknown as typeof fetch, ssrf: okSsrf })
    expect((out as { error: string }).error).toMatch(/redirect/i)
    // and it requested manual redirect handling (did not auto-follow)
    expect(fetchImpl).toHaveBeenCalledWith('https://api.example.com/w/SF', expect.objectContaining({ redirect: 'manual' }))
  })

  it('allows a POST with a body template on a write tool', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }))
    const out = await runCustomTool(def({ method: 'POST', read_only: false, url_template: 'https://api.example.com/items', body_template: '{"name":"{name}"}' }), { name: 'widget' }, { fetchImpl: fetchImpl as unknown as typeof fetch, ssrf: okSsrf })
    expect((out as { ok: boolean }).ok).toBe(true)
    expect(fetchImpl).toHaveBeenCalledWith('https://api.example.com/items', expect.objectContaining({ method: 'POST', body: '{"name":"widget"}' }))
  })
})

describe('custom tools — anthropic schema', () => {
  it('exposes name, description and input schema', () => {
    const t = toAnthropicTool(def())
    expect(t.name).toBe('weather_lookup')
    expect(t.input_schema).toMatchObject({ type: 'object' })
  })
})
