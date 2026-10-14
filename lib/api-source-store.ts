// lib/api-source-store.ts
// One shared read/write path for a Type-2 API source (service + its
// connections), used by the services route (saveApiSource / getServiceConfig),
// the AI builder's diagnose/apply actions, and the chat apply tool — so every
// surface persists config identically (same encryption, same connection
// replacement, same lifecycle) and there's a single place to audit/change.
import { getDb } from '@/lib/db'
import { encrypt, decrypt } from '@/lib/encrypt'

export interface ApiServiceConfig {
  id?: string
  label?: string
  base_url?: string
  auth_type?: string
  auth_config?: Record<string, unknown>
  default_headers?: Record<string, unknown>
  api_version?: string | null
  version_header?: string | null
  status?: string
}

export interface ApiConnectionConfig {
  label?: string
  description?: string | null
  base_path?: string | null
  pagination_style?: string
  pagination_limit_param?: string
  pagination_cursor_param?: string
  pagination_data_path?: string | null
}

/** Full config for one service, with auth_config decrypted. null if absent. */
export async function getServiceConfigById(id: string): Promise<{ service: ApiServiceConfig; connections: ApiConnectionConfig[] } | null> {
  const sql = getDb()
  const rows = await sql`SELECT id,label,base_url,auth_type,auth_config,default_headers,api_version,version_header,COALESCE(status,'published') AS status FROM api_services WHERE id=${id}`
  if (!rows.length) return null
  const svc = rows[0] as Record<string, unknown>
  let authConfig: Record<string, unknown> = {}
  try { authConfig = JSON.parse(decrypt((svc.auth_config as string) || '')) } catch {}
  let defaultHeaders: Record<string, unknown> = {}
  try { defaultHeaders = JSON.parse((svc.default_headers as string) || '{}') } catch {}
  const conns = await sql`SELECT id,label,description,base_path,pagination_style,pagination_limit_param,pagination_cursor_param,pagination_data_path FROM api_connections WHERE service_id=${id} ORDER BY created_at ASC`
  return {
    service: {
      id: String(svc.id), label: svc.label as string, base_url: svc.base_url as string, auth_type: svc.auth_type as string,
      auth_config: authConfig, default_headers: defaultHeaders,
      api_version: (svc.api_version as string) ?? null, version_header: (svc.version_header as string) ?? null, status: svc.status as string,
    },
    connections: conns as ApiConnectionConfig[],
  }
}

/**
 * Upsert a whole API source (service + its connections) in one call with a
 * lifecycle status. With an id, the existing service is updated and its
 * connections REPLACED; without, a new service is created. If auth_config is
 * omitted on an update, the stored (encrypted) auth is preserved — so a config
 * fix that doesn't touch credentials keeps them intact.
 */
export async function upsertApiSource(params: {
  id?: string
  service?: ApiServiceConfig
  connections?: ApiConnectionConfig[]
  status?: string
}): Promise<{ id: string; status: string }> {
  const sql = getDb()
  const s = params.service || {}
  const connections = params.connections || []
  const lifecycle = params.status === 'draft' ? 'draft' : 'published'
  let serviceId = params.id

  if (serviceId) {
    let authEnc: string
    if (s.auth_config) authEnc = encrypt(JSON.stringify(s.auth_config))
    else {
      const ex = await sql`SELECT auth_config FROM api_services WHERE id=${serviceId}`
      if (!ex.length) throw new Error('Service not found')
      authEnc = (ex[0].auth_config as string) || encrypt(JSON.stringify({}))
    }
    await sql`
      UPDATE api_services SET
        label=${s.label || 'API source'}, base_url=${s.base_url || ''},
        auth_type=${s.auth_type || 'bearer'}, auth_config=${authEnc},
        default_headers=${JSON.stringify(s.default_headers || {})},
        api_version=${s.api_version || null}, version_header=${s.version_header || null},
        status=${lifecycle},
        auth_status='unknown', last_auth_error=NULL, last_auth_check=NULL
      WHERE id=${serviceId}`
    await sql`DELETE FROM api_connections WHERE service_id=${serviceId}`
  } else {
    const authEnc = encrypt(JSON.stringify(s.auth_config || {}))
    const rows = await sql`
      INSERT INTO api_services(label,base_url,environment,auth_type,auth_config,default_headers,api_version,version_header,status)
      VALUES(${s.label || 'API source'},${s.base_url || ''},'production',${s.auth_type || 'bearer'},${authEnc},${JSON.stringify(s.default_headers || {})},${s.api_version || null},${s.version_header || null},${lifecycle})
      RETURNING id`
    serviceId = String(rows[0].id)
  }

  for (const c of connections) {
    await sql`
      INSERT INTO api_connections(service_id,label,description,base_path,pagination_style,pagination_limit_param,pagination_cursor_param,pagination_data_path)
      VALUES(${serviceId},${c.label || 'Endpoint'},${c.description || null},${c.base_path || null},${c.pagination_style || 'none'},${c.pagination_limit_param || 'limit'},${c.pagination_cursor_param || 'cursor'},${c.pagination_data_path || null})`
  }
  return { id: serviceId, status: lifecycle }
}
