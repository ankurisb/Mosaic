import { getSession } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { encrypt, decrypt } from '@/lib/encrypt'
export const runtime = 'nodejs'

export async function GET() {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  const sql = getDb()
  const services = await sql`SELECT id,label,base_url,environment,auth_type,default_headers,api_version,version_header,rate_limit_rpm,connect_timeout_ms,request_timeout_ms,retry_count,created_at,auth_status,last_auth_error,last_auth_check FROM api_services ORDER BY created_at ASC`
  const connections = await sql`SELECT id,service_id,label,description,base_path,pagination_style,pagination_limit_param,pagination_cursor_param,pagination_data_path,auth_override,created_at FROM api_connections ORDER BY created_at ASC`
  return Response.json({ services, connections })
}

export async function POST(req: Request) {
  const session = await getSession()
  if (!session || session.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 })
  const sql = getDb()
  const body = await req.json()
  const { action } = body

  // -- Services --
  if (action === 'createService') {
    const { label, base_url, environment, auth_type, auth_config, default_headers, api_version, version_header, rate_limit_rpm, connect_timeout_ms, request_timeout_ms, retry_count } = body
    const authEnc = encrypt(JSON.stringify(auth_config || {}))
    const rows = await sql`
      INSERT INTO api_services(label,base_url,environment,auth_type,auth_config,default_headers,api_version,version_header,rate_limit_rpm,connect_timeout_ms,request_timeout_ms,retry_count)
      VALUES(${label},${base_url},${environment||'production'},${auth_type||'bearer'},${authEnc},${JSON.stringify(default_headers||{})},${api_version||null},${version_header||null},${rate_limit_rpm||null},${connect_timeout_ms||5000},${request_timeout_ms||30000},${retry_count||3})
      RETURNING id`
    return Response.json({ id: rows[0].id })
  }

  if (action === 'updateService') {
    const { id, label, base_url, environment, auth_type, auth_config, default_headers, api_version, version_header, rate_limit_rpm, connect_timeout_ms, request_timeout_ms, retry_count } = body
    // If auth_config was provided, encrypt and update it; otherwise preserve the
    // existing encrypted value so partial edits don't wipe auth.
    let authEnc: string
    if (auth_config) {
      authEnc = encrypt(JSON.stringify(auth_config))
    } else {
      const existing = await sql`SELECT auth_config FROM api_services WHERE id=${id}`
      authEnc = (existing[0]?.auth_config as string) || encrypt(JSON.stringify({}))
    }
    await sql`
      UPDATE api_services
      SET label=${label},
          base_url=${base_url},
          environment=${environment},
          auth_type=${auth_type},
          auth_config=${authEnc},
          default_headers=${JSON.stringify(default_headers||{})},
          api_version=${api_version||null},
          version_header=${version_header||null},
          rate_limit_rpm=${rate_limit_rpm||null},
          connect_timeout_ms=${connect_timeout_ms||5000},
          request_timeout_ms=${request_timeout_ms||30000},
          retry_count=${retry_count||3}
      WHERE id=${id}`
    return Response.json({ ok: true })
  }

  if (action === 'patchServiceAuth') {
    // Lightweight patch -- only updates auth_config, used by the Try It token copy shortcut
    const { id, auth_config } = body
    if (!id || !auth_config) return Response.json({ error: 'id and auth_config required' }, { status: 400 })
    const rows = await sql`SELECT auth_config FROM api_services WHERE id=${id}`
    if (!rows.length) return Response.json({ error: 'Service not found' }, { status: 404 })
    // Merge new token into existing auth config so other fields (client_id etc.) are preserved
    let existing: Record<string, unknown> = {}
    try { existing = JSON.parse(decrypt(rows[0].auth_config as string || '')) } catch {}
    const merged = { ...existing, ...auth_config }
    const authEnc = encrypt(JSON.stringify(merged))
    await sql`UPDATE api_services SET auth_config=${authEnc} WHERE id=${id}`
    return Response.json({ ok: true })
  }

  if (action === 'deleteService') {
    await sql`DELETE FROM api_services WHERE id=${body.id}`
    return Response.json({ ok: true })
  }

  if (action === 'testService') {
    const rows = await sql`SELECT * FROM api_services WHERE id=${body.id}`
    if (!rows.length) return Response.json({ ok: false, message: 'Service not found' })
    const svc = rows[0]
    try {
      const start = Date.now()
      const res = await fetch(svc.base_url as string, { method: 'HEAD', signal: AbortSignal.timeout(5000) })
      return Response.json({ ok: true, latencyMs: Date.now() - start, status: res.status })
    } catch (e) {
      return Response.json({ ok: false, message: (e instanceof Error ? e.message : 'Unreachable') })
    }
  }

  // -- Connections --
  if (action === 'createConnection') {
    const { service_id, label, description, base_path, pagination_style, pagination_limit_param, pagination_cursor_param, pagination_data_path } = body
    const rows = await sql`
      INSERT INTO api_connections(service_id,label,description,base_path,pagination_style,pagination_limit_param,pagination_cursor_param,pagination_data_path)
      VALUES(${service_id},${label},${description||null},${base_path||null},${pagination_style||'none'},${pagination_limit_param||'limit'},${pagination_cursor_param||'cursor'},${pagination_data_path||null})
      RETURNING id`
    return Response.json({ id: rows[0].id })
  }

  if (action === 'updateConnection') {
    const { id, label, description, base_path, pagination_style, pagination_limit_param, pagination_cursor_param, pagination_data_path } = body
    await sql`
      UPDATE api_connections SET label=${label},description=${description||null},base_path=${base_path||null},
      pagination_style=${pagination_style||'none'},pagination_limit_param=${pagination_limit_param||'limit'},
      pagination_cursor_param=${pagination_cursor_param||'cursor'},pagination_data_path=${pagination_data_path||null}
      WHERE id=${id}`
    return Response.json({ ok: true })
  }

  if (action === 'deleteConnection') {
    await sql`DELETE FROM api_connections WHERE id=${body.id}`
    return Response.json({ ok: true })
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 })
}
