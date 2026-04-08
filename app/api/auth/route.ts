import { signInUser, COOKIE_NAME } from '@/lib/auth'
import { cookies } from 'next/headers'
export const runtime = 'nodejs'
const OPTS = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, maxAge: 60*60*24*7, path: '/' }
export async function POST(req: Request) {
  try {
    const { action, email, password } = await req.json()
    if (action === 'signin') {
      if (!email || !password) return Response.json({ error: 'Email and password required' }, { status: 400 })
      const result = await signInUser(email, password)
      if (!result) return Response.json({ error: 'Incorrect email or password' }, { status: 401 })
      const store = await cookies()
      store.set(COOKIE_NAME, result.token, OPTS)
      return Response.json({ user: result.user })
    }
    if (action === 'signout') {
      const store = await cookies()
      store.delete(COOKIE_NAME)
      return Response.json({ ok: true })
    }
    return Response.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e) { return Response.json({ error: String(e) }, { status: 500 }) }
}
