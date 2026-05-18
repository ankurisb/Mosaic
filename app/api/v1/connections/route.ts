import { validateDevApiKey, logDevApiUsage } from '@/lib/dev-api-auth'
import { getDb } from '@/lib/db'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const start = Date.now()
  const auth = await validateDevApiKey(req, ['read'])
  if (!auth.ok) return auth.response

  const sql = getDb()

  const [databases, apis, fileServers] = await Promise.all([
    sql`SELECT id, label, dialect, environment, host, port,
               database_name, schema_name, ssl_mode, read_only,
               managed, description, created_at
        FROM db_connections ORDER BY created_at ASC`,
    sql`SELECT s.id as service_id, s.label as service_name, s.base_url,
               s.auth_type, s.environment, s.rate_limit_rpm,
               c.id, c.label, c.base_path, c.description, c.created_at
        FROM api_connections c
        JOIN api_services s ON s.id = c.service_id
        ORDER BY s.created_at ASC, c.created_at ASC`,
    sql`SELECT id, label, transport, environment,
               host, share_path, bucket, file_types, created_at
        FROM file_servers ORDER BY created_at ASC`,
  ])

  await logDevApiUsage(auth.keyId, '/api/v1/connections', 'GET', 200, Date.now() - start)
  return Response.json({
    databases,
    apis,
    file_servers: fileServers,
    summary: {
      databases: databases.length,
      api_endpoints: apis.length,
      file_servers: fileServers.length,
    },
  })
}
