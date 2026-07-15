import { getSession } from '@/lib/auth'
import { log, newRequestId } from '@/lib/logger'
import { audit, AUDIT } from '@/lib/audit'
import { syncUserToSuperset } from '@/lib/superset-user-sync'
import { getDb } from '@/lib/db'
import { setUserSurfaces, isSurface, SURFACES, type Surface } from '@/lib/permissions'
import bcrypt from 'bcryptjs'
export const runtime = 'nodejs'

export async function GET() {
  const session = await getSession()
  if (!session || session.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 })
  const sql = getDb()
  const rows = await sql`SELECT id,email,name,role,banned,created_at,invite_sent_at,last_login_at,sso_provider FROM users ORDER BY created_at ASC`
  // Attach granted surfaces per user. Admins implicitly hold all surfaces.
  const perms = await sql`SELECT user_id, surface FROM user_surface_permissions WHERE allowed=1` as { user_id: string; surface: string }[]
  const bySurface = new Map<string, string[]>()
  for (const p of perms) {
    if (!isSurface(p.surface)) continue
    const arr = bySurface.get(p.user_id) || []
    arr.push(p.surface)
    bySurface.set(p.user_id, arr)
  }
  const users = (rows as Record<string, unknown>[]).map(u => ({
    ...u,
    surfaces: u.role === 'admin' ? [...SURFACES] : (bySurface.get(u.id as string) || []),
  }))
  return Response.json({ users })
}

export async function POST(req: Request) {
  const requestId = req.headers.get('x-request-id') || newRequestId()
  const reqLog = log.child({ requestId, service: 'users' })
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not authenticated' }, { status: 401 })
  const sql = getDb()
  const { action, userId, email, name, role, password, surfaces, currentPassword, newPassword } = await req.json()

  // Self-service password change: any authenticated user may change THEIR OWN
  // password. Handled before the admin gate below (it is the one action a
  // non-admin is allowed here). Verifies the current password first.
  if (action === 'changePassword') {
    if (!currentPassword || !newPassword) return Response.json({ error: 'currentPassword and newPassword required' }, { status: 400 })
    const uRows = await sql`SELECT password_hash FROM users WHERE id=${session.id}`
    const valid = uRows.length && await bcrypt.compare(currentPassword, (uRows[0] as { password_hash: string }).password_hash)
    if (!valid) {
      audit(req, { id: session.id, email: session.email, role: session.role }, AUDIT.PASSWORD_CHANGE, `user:${session.email}`, 'failure', { reason: 'wrong_current_password' })
      return Response.json({ error: 'Current password incorrect' }, { status: 401 })
    }
    const newHash = await bcrypt.hash(newPassword, 12)
    await sql`UPDATE users SET password_hash=${newHash} WHERE id=${session.id}`
    audit(req, { id: session.id, email: session.email, role: session.role }, AUDIT.PASSWORD_CHANGE, `user:${session.email}`, 'success', null)
    return Response.json({ ok: true })
  }

  // Everything past this point is admin-only.
  if (session.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 })

  if (action === 'invite') {
    if (!email) return Response.json({ error: 'Email required' }, { status: 400 })
    const tempPassword = password || Math.random().toString(36).slice(-10) + 'A1!'
    const hash = await bcrypt.hash(tempPassword, 12)
    const rows = await sql`INSERT INTO users(email,name,password_hash,role) VALUES(${email.toLowerCase()},${name||email.split('@')[0]},${hash},${role||'user'}) ON CONFLICT(email) DO NOTHING RETURNING id,email,name,role`
    if (!rows.length) return Response.json({ error: 'Email already exists' }, { status: 409 })
    if ((role || 'user') === 'admin') {
      syncUserToSuperset({ email: email.toLowerCase(), name: name || email, password: tempPassword, role: 'admin' }).catch(() => {})
    }
    await sql`UPDATE users SET invite_sent_at=datetime('now') WHERE id=${rows[0].id}`
    // Persist surface grants for the new user (non-admins; admins hold all implicitly).
    if (Array.isArray(surfaces) && (role || 'user') !== 'admin') {
      await setUserSurfaces(rows[0].id as string, (surfaces as unknown[]).filter(isSurface) as Surface[])
    }
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001'
    import('@/lib/mailer').then(({ sendWelcomeEmail }) =>
      sendWelcomeEmail(email.toLowerCase(), name || email.split('@')[0], tempPassword, appUrl)
        .then(r => { if (!r.ok) log.warn({ service: 'users', err: r.error }, 'Welcome email failed') })
        .catch(e => log.warn({ service: 'users', err: e }, 'Welcome email error'))
    )
    audit(req, { id: session.id, email: session.email, role: session.role }, AUDIT.USER_CREATE, `user:${email.toLowerCase()}`, 'success', { email: email.toLowerCase(), role: role || 'user', invited_by: session.email })
    return Response.json({ user: rows[0], tempPassword })
  }

  if (action === 'setRole') {
    if (userId === session.id) return Response.json({ error: 'Cannot change your own role' }, { status: 400 })
    const prevRows = await sql`SELECT email, role FROM users WHERE id=${userId}`
    const prevRole = (prevRows[0] as { role: string } | undefined)?.role || 'unknown'
    await sql`UPDATE users SET role=${role} WHERE id=${userId}`
    if (role === 'admin') {
      const urows = await sql`SELECT email, name FROM users WHERE id=${userId}`
      if (urows.length) {
        syncUserToSuperset({ email: urows[0].email as string, name: urows[0].name as string, password: '', role: 'admin' }).catch(() => {})
      }
    }
    audit(req, { id: session.id, email: session.email, role: session.role }, AUDIT.USER_ROLE_CHANGE, `user:${userId}`, 'success', { from: prevRole, to: role, target_email: (prevRows[0] as { email: string } | undefined)?.email })
    return Response.json({ ok: true })
  }

  if (action === 'resetPassword') {
    // Admin-initiated reset for ANOTHER user. Distinct from 'changePassword',
    // which is self-service and requires the current password. Without this an
    // admin has no way to recover a user who has forgotten their password.
    if (!userId) return Response.json({ error: 'userId required' }, { status: 400 })
    const uRows = await sql`SELECT email FROM users WHERE id=${userId}`
    if (!uRows.length) return Response.json({ error: 'User not found' }, { status: 404 })
    const targetEmail = (uRows[0] as { email: string }).email

    // Cryptographically secure temp password (unlike invite's Math.random()).
    const { randomBytes } = await import('crypto')
    const tempPassword = password || randomBytes(9).toString('base64url') + 'A1!'
    const hash = await bcrypt.hash(tempPassword, 12)
    await sql`UPDATE users SET password_hash=${hash} WHERE id=${userId}`

    audit(req, { id: session.id, email: session.email, role: session.role }, AUDIT.PASSWORD_CHANGE, `user:${userId}`, 'success', { admin_reset: true, target_email: targetEmail })
    return Response.json({ ok: true, tempPassword, email: targetEmail })
  }

  if (action === 'setSurfaces') {
    if (!userId) return Response.json({ error: 'userId required' }, { status: 400 })
    const clean = (Array.isArray(surfaces) ? (surfaces as unknown[]).filter(isSurface) : []) as Surface[]
    const uRows = await sql`SELECT email FROM users WHERE id=${userId}`
    if (!uRows.length) return Response.json({ error: 'User not found' }, { status: 404 })
    await setUserSurfaces(userId, clean)
    audit(req, { id: session.id, email: session.email, role: session.role }, AUDIT.USER_UPDATE, `user:${userId}`, 'success', { surfaces: clean, target_email: (uRows[0] as { email: string }).email })
    return Response.json({ ok: true, surfaces: clean })
  }

  if (action === 'ban') {
    if (userId === session.id) return Response.json({ error: 'Cannot ban yourself' }, { status: 400 })
    const uRows = await sql`SELECT email FROM users WHERE id=${userId}`
    await sql`UPDATE users SET banned=true WHERE id=${userId}`
    audit(req, { id: session.id, email: session.email, role: session.role }, AUDIT.USER_BAN, `user:${userId}`, 'success', { target_email: (uRows[0] as { email: string } | undefined)?.email })
    return Response.json({ ok: true })
  }

  if (action === 'unban') {
    const uRows = await sql`SELECT email FROM users WHERE id=${userId}`
    await sql`UPDATE users SET banned=false WHERE id=${userId}`
    audit(req, { id: session.id, email: session.email, role: session.role }, AUDIT.USER_UNBAN, `user:${userId}`, 'success', { target_email: (uRows[0] as { email: string } | undefined)?.email })
    return Response.json({ ok: true })
  }

  if (action === 'delete') {
    if (userId === session.id) return Response.json({ error: 'Cannot delete yourself' }, { status: 400 })
    const uRows = await sql`SELECT email FROM users WHERE id=${userId}`
    await sql`DELETE FROM users WHERE id=${userId}`
    audit(req, { id: session.id, email: session.email, role: session.role }, AUDIT.USER_DELETE, `user:${userId}`, 'success', { target_email: (uRows[0] as { email: string } | undefined)?.email })
    return Response.json({ ok: true })
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 })
}
