// lib/superset-auth.ts
// Server-side Superset browser login for the native-UI handshake.
//
// NOTE: this is distinct from lib/superset-sync.ts, which uses the *API*
// login (/api/v1/security/login -> JWT access_token). A JWT does not
// authenticate Superset's web UI. The native UI uses Flask-Login: a form
// POST to /login/ with a CSRF token bound to a session cookie, returning an
// authenticated `session` cookie.
//
// All Mosaic users share this single Superset identity; access is gated by
// Mosaic's canAccessSurface('superset'), not by Superset itself.

const SUPERSET_URL = (process.env.SUPERSET_URL || 'http://localhost:8088').replace(/\/$/, '')
const SUPERSET_USER = process.env.SUPERSET_ADMIN_USER || 'admin'
const SUPERSET_PASS = process.env.SUPERSET_ADMIN_PASSWORD || ''

/** Extract the `session=...` cookie (name + value only) from Set-Cookie headers. */
function pickSession(res: Response): string | null {
  const cookies = res.headers.getSetCookie?.() || []
  const raw = cookies.find(c => c.startsWith('session='))
  return raw ? raw.split(';')[0] : null
}

/**
 * Log in to Superset's web UI and return the full `Set-Cookie` string for the
 * authenticated session, to relay to the browser. Throws if login fails.
 */
export async function ensureSupersetSession(): Promise<string> {
  // 1. GET the login page: yields a session cookie + a CSRF token bound to it.
  const loginPage = await fetch(`${SUPERSET_URL}/login/`, { signal: AbortSignal.timeout(8000) })
  if (!loginPage.ok) throw new Error('Superset unreachable')

  const preSession = pickSession(loginPage)
  const html = await loginPage.text()
  const csrf = html.match(/name="csrf_token"[^>]*value="([^"]+)"/)?.[1]
  if (!csrf || !preSession) throw new Error('Superset login page missing CSRF/session')

  // 2. POST the form with the CSRF token AND its matching session cookie.
  const body = new URLSearchParams({
    username: SUPERSET_USER,
    password: SUPERSET_PASS,
    csrf_token: csrf,
  })
  const res = await fetch(`${SUPERSET_URL}/login/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: preSession,
    },
    body,
    redirect: 'manual',
    signal: AbortSignal.timeout(8000),
  })

  // Success is a 302 to '/'. A 200 means the form was re-rendered with an error.
  if (res.status !== 302) throw new Error('Superset authentication failed')

  const cookies = res.headers.getSetCookie?.() || []
  const authCookie = cookies.find(c => c.startsWith('session='))
  if (!authCookie) throw new Error('Superset returned no session cookie')

  return authCookie
}
