import { getSession } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { encrypt, decrypt } from '@/lib/encrypt'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const sql = getDb()
    const rows = await sql`SELECT id, host, port, username, from_address, from_name, enabled FROM smtp_config WHERE id='default'`
    return Response.json({ smtp: rows[0] || null })
  } catch { return Response.json({ smtp: null }) }
}

export async function POST(req: Request) {
  const session = await getSession()
  if (!session || session.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 })
  try {
    const { action, host, port, username, password, from_address, from_name, enabled } = await req.json()

    if (action === 'save') {
      if (!host || !from_address) return Response.json({ error: 'Host and from address are required' }, { status: 400 })
      const sql = getDb()
      const existing = await sql`SELECT password_enc FROM smtp_config WHERE id='default'`
      const password_enc = password
        ? encrypt(password)
        : (existing[0]?.password_enc as string || '')
      await sql`INSERT INTO smtp_config (id, host, port, username, password_enc, from_address, from_name, enabled)
        VALUES ('default', ${host}, ${port||587}, ${username||''}, ${password_enc}, ${from_address}, ${from_name||'Mosaic'}, ${enabled?1:0})
        ON CONFLICT(id) DO UPDATE SET host=${host}, port=${port||587}, username=${username||''}, password_enc=${password_enc}, from_address=${from_address}, from_name=${from_name||'Mosaic'}, enabled=${enabled?1:0}`
      return Response.json({ ok: true })
    }

    if (action === 'test') {
      const { sendWelcomeEmail } = await import('@/lib/mailer')
      const testEmail = session.email
      await sendWelcomeEmail(testEmail, session.name, 'TestPass123!', process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001')
      return Response.json({ ok: true, message: `Test email sent to ${testEmail}` })
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e) { return Response.json({ error: String(e) }, { status: 500 }) }
}
