// lib/fetch.ts
// Safe fetch helpers that always produce human-readable errors.
//
// Usage:
//   const { data, error } = await safeJson<MyType>(r)
//   if (error) { setError(error); return }
//
// Or inline:
//   const d = await getJson<MyType>('/api/something')
//   if (d.error) { setError(d.error); return }

/** Parse a Response as JSON safely.
 *  Returns { data, error } — error is always a plain-English string.
 *  Never throws. */
export async function safeJson<T = Record<string, unknown>>(
  r: Response
): Promise<{ data: T | null; error: string | null }> {
  let text = ''
  try { text = await r.text() } catch {
    return {
      data: null,
      error: `Could not read the server response (HTTP ${r.status}). Check your network connection and try again.`,
    }
  }

  let body: unknown
  try { body = JSON.parse(text) } catch {
    if (!r.ok) return { data: null, error: statusMessage(r.status) }
    return { data: null, error: 'Unexpected response from server. Please try again.' }
  }

  if (!r.ok) {
    const errField = (body as Record<string, unknown>)?.error
    const errMsg = typeof errField === 'string' && errField
      ? errField
      : statusMessage(r.status)
    return { data: null, error: errMsg }
  }

  return { data: body as T, error: null }
}

/** Fetch a URL and parse JSON safely.
 *  Returns { data, error } — error is always human-readable. */
export async function getJson<T = Record<string, unknown>>(
  url: string,
  init?: RequestInit
): Promise<{ data: T | null; error: string | null }> {
  let r: Response
  try { r = await fetch(url, init) } catch (e) {
    const msg = e instanceof Error && e.message.toLowerCase().includes('fetch')
      ? 'Could not reach the server. Check your connection and try again.'
      : (e instanceof Error ? e.message : 'Network error — please try again.')
    return { data: null, error: msg }
  }
  return safeJson<T>(r)
}

/** POST JSON and parse response safely. */
export async function postJson<T = Record<string, unknown>>(
  url: string,
  body: unknown,
  init?: RequestInit
): Promise<{ data: T | null; error: string | null }> {
  return getJson<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    ...init,
  })
}

/** Translate HTTP status codes into plain English. */
function statusMessage(status: number): string {
  if (status === 400) return 'Invalid request. Check your inputs and try again.'
  if (status === 401) return 'You are not signed in. Please refresh the page and log in.'
  if (status === 403) return 'You do not have permission to perform this action.'
  if (status === 404) return 'The requested resource was not found.'
  if (status === 409) return 'A conflict occurred — this item may already exist.'
  if (status === 429) return 'Too many requests. Please wait a moment and try again.'
  if (status >= 500) return `Server error (${status}). Please try again or contact support if this persists.`
  return `Unexpected error (HTTP ${status}). Please try again.`
}
