import { getSession } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { encrypt, decrypt } from '@/lib/encrypt'
export const runtime = 'nodejs'

export async function GET() {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  const sql = getDb()
  const services = await sql`SELECT id,label,base_url,environment,auth_type,default_headers,api_version,version_header,rate_limit_rpm,connect_timeout_ms,request_timeout_ms,retry_count,created_at,auth_status,last_auth_error,last_auth_check,COALESCE(status,'published') AS status FROM api_services ORDER BY created_at ASC`
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
    const { label, base_url, environment, auth_type, auth_config, default_headers, api_version, version_header, rate_limit_rpm, connect_timeout_ms, request_timeout_ms, retry_count, status } = body
    const authEnc = encrypt(JSON.stringify(auth_config || {}))
    const rows = await sql`
      INSERT INTO api_services(label,base_url,environment,auth_type,auth_config,default_headers,api_version,version_header,rate_limit_rpm,connect_timeout_ms,request_timeout_ms,retry_count,status)
      VALUES(${label},${base_url},${environment||'production'},${auth_type||'bearer'},${authEnc},${JSON.stringify(default_headers||{})},${api_version||null},${version_header||null},${rate_limit_rpm||null},${connect_timeout_ms||5000},${request_timeout_ms||30000},${retry_count||3},${status||'published'})
      RETURNING id`
    return Response.json({ id: rows[0].id })
  }

  // Upsert a whole API source (service + its connections) in one call, with a
  // lifecycle status. Used by the AI builder for "Save as draft" (status:'draft')
  // and "Publish" (status:'published'), and to re-save a resumed draft (id given).
  if (action === 'saveApiSource') {
    const { id, service = {}, connections = [], status } = body as {
      id?: string
      service?: Record<string, unknown>
      connections?: Array<Record<string, unknown>>
      status?: string
    }
    const s = service
    const lifecycle = status === 'draft' ? 'draft' : 'published'
    let serviceId = id as string | undefined

    if (serviceId) {
      // Update the existing (draft) service. Preserve encrypted auth if none supplied.
      let authEnc: string
      if (s.auth_config) authEnc = encrypt(JSON.stringify(s.auth_config))
      else {
        const ex = await sql`SELECT auth_config FROM api_services WHERE id=${serviceId}`
        if (!ex.length) return Response.json({ error: 'Draft not found' }, { status: 404 })
        authEnc = (ex[0].auth_config as string) || encrypt(JSON.stringify({}))
      }
      await sql`
        UPDATE api_services SET
          label=${s.label || 'API source'}, base_url=${s.base_url || ''},
          auth_type=${s.auth_type || 'bearer'}, auth_config=${authEnc},
          default_headers=${JSON.stringify(s.default_headers || {})},
          api_version=${s.api_version || null}, version_header=${s.version_header || null},
          status=${lifecycle}
        WHERE id=${serviceId}`
      await sql`DELETE FROM api_connections WHERE service_id=${serviceId}`
    } else {
      const authEnc = encrypt(JSON.stringify(s.auth_config || {}))
      const rows = await sql`
        INSERT INTO api_services(label,base_url,environment,auth_type,auth_config,default_headers,api_version,version_header,status)
        VALUES(${s.label || 'API source'},${s.base_url || ''},'production',${s.auth_type || 'bearer'},${authEnc},${JSON.stringify(s.default_headers || {})},${s.api_version || null},${s.version_header || null},${lifecycle})
        RETURNING id`
      serviceId = rows[0].id as string
    }

    for (const c of connections) {
      await sql`
        INSERT INTO api_connections(service_id,label,description,base_path,pagination_style,pagination_limit_param,pagination_cursor_param,pagination_data_path)
        VALUES(${serviceId},${c.label || 'Endpoint'},${c.description || null},${c.base_path || null},${c.pagination_style || 'none'},${c.pagination_limit_param || 'limit'},${c.pagination_cursor_param || 'cursor'},${c.pagination_data_path || null})`
    }
    return Response.json({ id: serviceId, status: lifecycle })
  }

  // Full config for one service (incl. decrypted auth_config) + its connections.
  // Used to resume a draft in the builder with credentials pre-filled. Admin only
  // (this POST handler is already admin-gated).
  if (action === 'getServiceConfig') {
    const { id } = body
    if (!id) return Response.json({ error: 'id required' }, { status: 400 })
    const rows = await sql`SELECT id,label,base_url,auth_type,auth_config,default_headers,api_version,version_header,COALESCE(status,'published') AS status FROM api_services WHERE id=${id}`
    if (!rows.length) return Response.json({ error: 'Service not found' }, { status: 404 })
    const svc = rows[0] as Record<string, unknown>
    let authConfig: Record<string, unknown> = {}
    try { authConfig = JSON.parse(decrypt((svc.auth_config as string) || '')) } catch {}
    let defaultHeaders: Record<string, unknown> = {}
    try { defaultHeaders = JSON.parse((svc.default_headers as string) || '{}') } catch {}
    const conns = await sql`SELECT id,label,description,base_path,pagination_style,pagination_limit_param,pagination_cursor_param,pagination_data_path FROM api_connections WHERE service_id=${id} ORDER BY created_at ASC`
    return Response.json({
      service: {
        id: svc.id, label: svc.label, base_url: svc.base_url, auth_type: svc.auth_type,
        auth_config: authConfig, default_headers: defaultHeaders,
        api_version: svc.api_version, version_header: svc.version_header, status: svc.status,
      },
      connections: conns,
    })
  }

  if (action === 'publishService') {
    if (!body.id) return Response.json({ error: 'id required' }, { status: 400 })
    await sql`UPDATE api_services SET status='published' WHERE id=${body.id}`
    return Response.json({ ok: true })
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
