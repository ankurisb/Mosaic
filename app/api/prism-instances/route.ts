import { getSession } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { encrypt, decrypt } from '@/lib/encrypt'
import { getPrismToken, invalidatePrismToken } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const sql = getDb()
  const instances = await sql`
    SELECT id, label, base_url, environment, username, active, created_at
    FROM prism_instances
    WHERE active = 1
    ORDER BY created_at ASC`
  return Response.json({ instances })
}

export async function POST(req: Request) {
  const session = await getSession()
  if (!session || session.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 })
  const body = await req.json()
  const { id, label, base_url, environment, username, password } = body

  if (!label?.trim()) return Response.json({ error: 'Label is required' }, { status: 400 })
  if (!base_url?.trim()) return Response.json({ error: 'URL is required' }, { status: 400 })
  if (!username?.trim()) return Response.json({ error: 'Username is required' }, { status: 400 })

  const sql = getDb()

  if (id) {
    if (password) {
      const password_enc = encrypt(password)
      await sql`
        UPDATE prism_instances
        SET label=${label.trim()}, base_url=${base_url.trim().replace(/\/$/, '')},
            environment=${environment || 'production'}, username=${username.trim()},
            password_enc=${password_enc}, token_enc=NULL, refresh_token_enc=NULL,
            token_expiry=NULL, updated_at=datetime('now')
        WHERE id=${id}`
      invalidatePrismToken(id)
    } else {
      await sql`
        UPDATE prism_instances
        SET label=${label.trim()}, base_url=${base_url.trim().replace(/\/$/, '')},
            environment=${environment || 'production'}, username=${username.trim()},
            updated_at=datetime('now')
        WHERE id=${id}`
    }
    return Response.json({ ok: true, id })
  } else {
    if (!password?.trim()) return Response.json({ error: 'Password is required' }, { status: 400 })
    const password_enc = encrypt(password)
    const rows = await sql`
      INSERT INTO prism_instances (label, base_url, environment, username, password_enc)
      VALUES (${label.trim()}, ${base_url.trim().replace(/\/$/, '')}, ${environment || 'production'}, ${username.trim()}, ${password_enc})
      RETURNING id`
    return Response.json({ ok: true, id: rows[0]?.id })
  }
}

export async function DELETE(req: Request) {
  const session = await getSession()
  if (!session || session.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await req.json()
  if (!id) return Response.json({ error: 'id required' }, { status: 400 })
  const sql = getDb()
  await sql`UPDATE prism_instances SET active=0 WHERE id=${id}`
  invalidatePrismToken(id)
  return Response.json({ ok: true })
}
