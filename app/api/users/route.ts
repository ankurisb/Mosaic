import { getSession } from '@/lib/auth'
import { log, newRequestId } from '@/lib/logger'
import { audit, AUDIT } from '@/lib/audit'
import { syncUserToSuperset } from '@/lib/superset-user-sync'
import { getDb } from '@/lib/db'
import bcrypt from 'bcryptjs'
export const runtime = 'nodejs'

export async function GET() {
  const session = await getSession()
  if (!session || session.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 })
  const sql = getDb()
  const rows = await sql`SELECT id,email,name,role,banned,created_at,invite_sent_at,last_login_at,sso_provider FROM users ORDER BY created_at ASC`
  return Response.json({ users: rows })
}

export async function POST(req: Request) {
  const requestId = req.headers.get('x-request-id') || newRequestId()
  const reqLog = log.child({ requestId, service: 'users' })
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
    // Track invite timestamp
    await sql`UPDATE users SET invite_sent_at=datetime('now') WHERE id=${rows[0].id}`
    // Send welcome email (non-blocking — don't fail invite if email fails)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001'
    import('@/lib/mailer').then(({ sendWelcomeEmail }) =>
      sendWelcomeEmail(email.toLowerCase(), name || email.split('@')[0], tempPassword, appUrl)
        .then(r => { if (!r.ok) log.warn({ service: 'users', err: r.error }, 'Welcome email failed') })
        .catch(e => log.warn({ service: 'users', err: e }, 'Welcome email error'))
    )
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
