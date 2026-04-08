import { signInUser, COOKIE_NAME } from '@/lib/auth'
import { cookies } from 'next/headers'

export const runtime = 'nodejs'

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 60 * 60 * 24 * 7,
  path: '/',
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { action } = body

    if (action === 'signin') {
      const { email, password } = body
      if (!email || !password)
        return Response.json({ error: 'Email and password are required' }, { status: 400 })
      const result = await signInUser(email, password)
      if (!result)
        return Response.json({ error: 'Incorrect email or password' }, { status: 401 })
      const store = await cookies()
      store.set(COOKIE_NAME, result.token, COOKIE_OPTS)
      return Response.json({ user: result.user })
    }

    if (action === 'signout') {
      const store = await cookies()
      store.delete(COOKIE_NAME)
      return Response.json({ ok: true })
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    console.error('Auth error:', err)
    return Response.json({ error: 'Server error' }, { status: 500 })
  }
}
