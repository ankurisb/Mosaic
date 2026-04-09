import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import bcrypt from 'bcryptjs'
import { getDb } from './db'

export const COOKIE_NAME = 'claude_session'

function secret() {
  const s = process.env.AUTH_SECRET
  if (!s) throw new Error('AUTH_SECRET is not set')
  return new TextEncoder().encode(s)
}

export interface SessionUser {
  id: string
  email: string
  name: string
  role: 'admin' | 'user'
}

export async function createToken(user: SessionUser) {
  return new SignJWT({ id: user.id, email: user.email, name: user.name, role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .setIssuedAt()
    .sign(secret())
}

export async function verifyToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, secret())
    return payload as unknown as SessionUser
  } catch { return null }
}

export async function getSession(): Promise<SessionUser | null> {
  try {
    const store = await cookies()
    const token = store.get(COOKIE_NAME)?.value
    if (!token) return null
    return verifyToken(token)
  } catch { return null }
}

export async function signInUser(email: string, password: string) {
  const sql = getDb()
  const rows = await sql`SELECT id,email,name,role,password_hash FROM users WHERE email=${email.toLowerCase().trim()}`
  if (!rows.length) return null
  const row = rows[0]
  const ok = await bcrypt.compare(password, row.password_hash)
  if (!ok) return null
  const user: SessionUser = { id: row.id, email: row.email, name: row.name, role: row.role }
  const token = await createToken(user)
  return { token, user }
}
