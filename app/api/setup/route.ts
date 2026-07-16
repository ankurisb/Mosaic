import { getDb, nowExpr } from '@/lib/db'
import { log } from '@/lib/logger'
import bcrypt from 'bcryptjs'
export const runtime = 'nodejs'

export async function POST(req: Request) {
  try {
    const { name, email, password } = await req.json() as {
      name: string; email: string; password: string
    }

    if (!name?.trim() || !email?.trim() || !password?.trim())
      return Response.json({ error: 'Name, email and password are required' }, { status: 400 })

    if (password.length < 8)
      return Response.json({ error: 'Password must be at least 8 characters' }, { status: 400 })

    const sql = getDb()

    // Guard: only works when no users exist
    const rows = await sql`SELECT COUNT(*) as cnt FROM users`
    const count = Number((rows[0] as { cnt: string })?.cnt || 0)
    if (count > 0)
      return Response.json({ error: 'Setup already complete' }, { status: 409 })

    const hash = await bcrypt.hash(password.trim(), 12)
    await sql`
      INSERT INTO users (email, name, password_hash, role)
      VALUES (${email.toLowerCase().trim()}, ${name.trim()}, ${hash}, 'admin')
    `

    // Mark setup complete so the wizard is never shown again
    await sql`
      INSERT INTO kv_settings (key, value_enc, updated_by, updated_at)
      VALUES ('SETUP_COMPLETE', 'true', 'setup-wizard', ${nowExpr()})
      ON CONFLICT(key) DO UPDATE SET value_enc = 'true', updated_at = ${nowExpr()}
    `

    return Response.json({ ok: true })
  } catch (err) {
    log.error({ service: 'setup', err: err }, '[setup] POST error:')
    return Response.json({ error: 'Setup failed' }, { status: 500 })
  }
}
