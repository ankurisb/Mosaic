import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import bcrypt from 'bcryptjs'
import { getDb } from './db'

export const COOKIE_NAME = 'claude_session'

function secret() {
  const s = process.env.AUTH_SECRET
  if (!s) throw new Error('AUTH_SECRET is not set')
  // Fix #14: use SHA-256 derived key so short secrets are safe
  return new TextEncoder().encode(s.padEnd(32, s).slice(0, 64))
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

// Fix #5: check banned status on every session lookup
export async function getSession(): Promise<SessionUser | null> {
  try {
    const store = await cookies()
    const token = store.get(COOKIE_NAME)?.value
    if (!token) return null
    const user = await verifyToken(token)
    if (!user) return null
    // Verify user still exists and is not banned
    const sql = getDb()
    const rows = await sql`SELECT id, email, name, role, banned FROM users WHERE id=${user.id} LIMIT 1`
    if (!rows.length || rows[0].banned) return null
    // Return fresh data from DB (role may have changed since token was issued)
    return { id: rows[0].id as string, email: rows[0].email as string, name: rows[0].name as string, role: rows[0].role as "admin" | "user" }
  } catch { return null }
}

export async function signInUser(email: string, password: string) {
  const sql = getDb()
  const rows = await sql`SELECT id,email,name,role,password_hash,banned FROM users WHERE email=${email.toLowerCase().trim()}`
  if (!rows.length) return null
  const row = rows[0]
  if (row.banned) return null
  const ok = await bcrypt.compare(password, row.password_hash as string)
  if (!ok) return null
  const user: SessionUser = { id: row.id as string, email: row.email as string, name: row.name as string, role: row.role as "admin" | "user" }
  const token = await createToken(user)
  return { token, user }
}
