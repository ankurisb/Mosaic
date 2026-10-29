// app/api/custom-tools — list + create admin-authored custom tools.
import { getSession } from '@/lib/auth'
import { getDb, nowExpr } from '@/lib/db'
import { setupDatabase } from '@/lib/setup'
import { validateToolName, type CustomToolDef } from '@/lib/custom-tools'
export const runtime = 'nodejs'

type Row = Record<string, unknown>

export async function GET() {
  const session = await getSession(); if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  await setupDatabase().catch(() => {})
  const rows = await getDb()`SELECT id, name, description, method, url_template, read_only, enabled, created_at FROM custom_tools ORDER BY created_at ASC`.catch(() => [])
  return Response.json({ tools: rows })
}

export async function POST(req: Request) {
  const session = await getSession(); if (!session || session.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 })
  await setupDatabase().catch(() => {})
  const b = await req.json().catch(() => ({})) as Row
  const name = String(b.name || '').trim()
  const nameErr = validateToolName(name)
  if (nameErr) return Response.json({ error: nameErr }, { status: 400 })
  const url = String(b.url_template || '').trim()
  if (!/^https?:\/\//.test(url)) return Response.json({ error: 'url_template must be an http(s) URL.' }, { status: 400 })
  const method = String(b.method || 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET'
  const readOnly = b.read_only === false ? 0 : 1
  const headers = b.headers && typeof b.headers === 'object' ? JSON.stringify(b.headers) : '{}'
  const bodyTpl = typeof b.body_template === 'string' ? b.body_template : null
  const schema = (b.input_schema && typeof b.input_schema === 'object') ? b.input_schema as CustomToolDef['input_schema'] : { type: 'object', properties: {} }
  try {
    const rows = await getDb()`INSERT INTO custom_tools (name, description, method, url_template, headers, body_template, read_only, input_schema, enabled, created_by, created_at)
      VALUES (${name}, ${String(b.description || '').slice(0, 1000)}, ${method}, ${url}, ${headers}, ${bodyTpl}, ${readOnly}, ${JSON.stringify(schema)}, 1, ${session.id}, ${nowExpr()}) RETURNING *`
    return Response.json({ tool: (rows as Row[])[0] })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/unique|constraint/i.test(msg)) return Response.json({ error: `A tool named "${name}" already exists.` }, { status: 409 })
    return Response.json({ error: msg }, { status: 500 })
  }
}
