import { getSession } from '@/lib/auth'
import { syncUserToSuperset } from '@/lib/superset-user-sync'
import { getDb } from '@/lib/db'
import bcrypt from 'bcryptjs'
export const runtime = 'nodejs'

export async function GET() {
  const session = await getSession()
  if (!session || session.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 })
  const sql = getDb()
  const rows = await sql`SELECT id,email,name,role,banned,created_at FROM users ORDER BY created_at ASC`
  return Response.json({ users: rows })
}

export async function POST(req: Request) {
  const session = await getSession()
  if (!session || session.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 })
  const sql = getDb()
  const { action, userId, email, name, role, password } = await req.json()

  if (action === 'invite') {
    if (!email) return Response.json({ error: 'Email required' }, { status: 400 })
    const tempPassword = password || Math.random().toString(36).slice(-10) + 'A1!'
    const hash = await bcrypt.hash(tempPassword, 12)
    const rows = await sql`INSERT INTO users(email,name,password_hash,role) VALUES(${email.toLowerCase()},${name||email.split('@')[0]},${hash},${role||'user'}) ON CONFLICT(email) DO NOTHING RETURNING id,email,name,role`
    if (!rows.length) return Response.json({ error: 'Email already exists' }, { status: 409 })
    if ((role || 'user') === 'admin') {
      syncUserToSuperset({ email: email.toLowerCase(), name: name || email, password: tempPassword, role: 'admin' }).catch(() => {})
    }
    return Response.json({ user: rows[0], tempPassword })
  }

  if (action === 'setRole') {
    if (userId === session.id) return Response.json({ error: 'Cannot change your own role' }, { status: 400 })
    await sql`UPDATE users SET role=${role} WHERE id=${userId}`
    if (role === 'admin') {
      const urows = await sql`SELECT email, name FROM users WHERE id=${userId}`
      if (urows.length) {
        syncUserToSuperset({ email: urows[0].email as string, name: urows[0].name as string, password: '', role: 'admin' }).catch(() => {})
      }
    }
    return Response.json({ ok: true })
  }

  if (action === 'ban') {
    if (userId === session.id) return Response.json({ error: 'Cannot ban yourself' }, { status: 400 })
    await sql`UPDATE users SET banned=true WHERE id=${userId}`
    return Response.json({ ok: true })
  }

  if (action === 'unban') {
    await sql`UPDATE users SET banned=false WHERE id=${userId}`
    return Response.json({ ok: true })
  }

  if (action === 'delete') {
    if (userId === session.id) return Response.json({ error: 'Cannot delete yourself' }, { status: 400 })
    await sql`DELETE FROM users WHERE id=${userId}`
    return Response.json({ ok: true })
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 })
}
