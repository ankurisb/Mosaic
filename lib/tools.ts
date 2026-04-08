import type Anthropic from '@anthropic-ai/sdk'

export const TOOLS: Anthropic.Tool[] = [
  {
    name: 'web_search',
    description: 'Search the web for current information, news, or anything that may have changed recently.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query' },
      },
      required: ['query'],
    },
  },
]

export async function runTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  if (name === 'web_search') return webSearch(String(input.query))
  throw new Error(`Unknown tool: ${name}`)
}

async function webSearch(query: string) {
  // Tavily — free at app.tavily.com
  if (process.env.TAVILY_API_KEY) {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query, max_results: 5 }),
    })
    if (!res.ok) throw new Error(`Tavily error ${res.status}`)
    const data = await res.json()
    return (data.results || []).map((r: { title: string; url: string; content: string }) => ({
      title: r.title, url: r.url, snippet: String(r.content || '').slice(0, 400),
    }))
  }

  // Brave fallback
  if (process.env.BRAVE_SEARCH_API_KEY) {
    const res = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`,
      { headers: { 'X-Subscription-Token': process.env.BRAVE_SEARCH_API_KEY, Accept: 'application/json' } }
    )
    if (!res.ok) throw new Error(`Brave error ${res.status}`)
    const data = await res.json()
    return (data.web?.results || []).slice(0, 5).map((r: { title: string; url: string; description: string }) => ({
      title: r.title, url: r.url, snippet: r.description || '',
    }))
  }

  return [{ title: 'Search not configured', url: '', snippet: 'Add TAVILY_API_KEY to your environment variables. Get a free key at app.tavily.com' }]
}
