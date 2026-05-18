import { getSession } from '@/lib/auth'
import { getDb } from '@/lib/db'
import { encrypt, decrypt } from '@/lib/encrypt'
export const runtime = 'nodejs'

// -- GET -- list all file servers -------------------------------
export async function GET() {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  const sql = getDb()
  const rows = await sql`
    SELECT id, label, transport, environment, host, port, share_path, sub_path,
           username, bucket, endpoint_url, access_key_id, tenant_id, client_id,
           file_types, poll_interval_sec, max_files, max_rows,
           filename_date_pattern, ts_strategy, created_at
    FROM file_servers ORDER BY created_at ASC`
  return Response.json({ file_servers: rows })
}

// -- POST -- create / update / delete / test --------------------
export async function POST(req: Request) {
  const session = await getSession()
  if (!session || session.role !== 'admin') return Response.json({ error: 'Admin only' }, { status: 403 })
  const sql = getDb()
  const body = await req.json()
  const { action } = body

  // -- CREATE ----------------------------------------------------
  if (action === 'create') {
    const {
      label, transport, environment,
      host, port, share_path, sub_path, username, password, ssh_key,
      bucket, endpoint_url, access_key_id, secret_key,
      file_types, poll_interval_sec, max_files, max_rows,
      filename_date_pattern, ts_strategy,
    } = body

    if (!label) return Response.json({ error: 'Label is required' }, { status: 400 })
    if (!transport) return Response.json({ error: 'Transport is required' }, { status: 400 })

    const passwordEnc  = password  ? encrypt(password)   : null
    const sshKeyEnc    = ssh_key   ? encrypt(ssh_key)     : null
    const secretKeyEnc = secret_key ? encrypt(secret_key) : null

    const rows = await sql`
      INSERT INTO file_servers (
        label, transport, environment, host, port, share_path, sub_path,
        username, password_enc, ssh_key_enc,
        bucket, endpoint_url, access_key_id, secret_key_enc,
        tenant_id, client_id,
        file_types, poll_interval_sec, max_files, max_rows,
        filename_date_pattern, ts_strategy
      ) VALUES (
        ${label}, ${transport}, ${environment || 'production'},
        ${host || null}, ${port || null}, ${share_path || null}, ${sub_path || null},
        ${username || null}, ${passwordEnc}, ${sshKeyEnc},
        ${bucket || null}, ${endpoint_url || null}, ${access_key_id || null}, ${secretKeyEnc},
        ${body.tenant_id || null}, ${body.client_id || null},
        ${file_types || 'csv,xlsx,pdf'}, ${poll_interval_sec || 60},
        ${max_files || 20}, ${max_rows || 500},
        ${filename_date_pattern || null}, ${ts_strategy || 'auto'}
      ) RETURNING id`
    return Response.json({ id: rows[0].id })
  }

  // -- UPDATE ----------------------------------------------------
  if (action === 'update') {
    const {
      id, label, transport, environment,
      host, port, share_path, sub_path, username, password, ssh_key,
      bucket, endpoint_url, access_key_id, secret_key,
      file_types, poll_interval_sec, max_files, max_rows,
      filename_date_pattern, ts_strategy,
    } = body

    if (!id) return Response.json({ error: 'ID required' }, { status: 400 })

    const passwordEnc  = password   ? encrypt(password)   : null
    const sshKeyEnc    = ssh_key    ? encrypt(ssh_key)     : null
    const secretKeyEnc = secret_key ? encrypt(secret_key) : null

    await sql`
      UPDATE file_servers SET
        label = ${label},
        transport = ${transport},
        environment = ${environment || 'production'},
        host = ${host || null},
        port = ${port || null},
        share_path = ${share_path || null},
        sub_path = ${sub_path || null},
        username = ${username || null},
        bucket = ${bucket || null},
        endpoint_url = ${endpoint_url || null},
        access_key_id = ${access_key_id || null},
        file_types = ${file_types || 'csv,xlsx,pdf'},
        poll_interval_sec = ${poll_interval_sec || 60},
        max_files = ${max_files || 20},
        max_rows = ${max_rows || 500},
        filename_date_pattern = ${filename_date_pattern || null},
        ts_strategy = ${ts_strategy || 'auto'},
        tenant_id = ${body.tenant_id || null},
        client_id = ${body.client_id || null}
      WHERE id = ${id}`

    // Update encrypted credentials only when new values are supplied;
    // null/undefined means "leave existing value alone".
    if (passwordEnc !== null) {
      await sql`UPDATE file_servers SET password_enc = ${passwordEnc} WHERE id = ${id}`
    }
    if (sshKeyEnc !== null) {
      await sql`UPDATE file_servers SET ssh_key_enc = ${sshKeyEnc} WHERE id = ${id}`
    }
    if (secretKeyEnc !== null) {
      await sql`UPDATE file_servers SET secret_key_enc = ${secretKeyEnc} WHERE id = ${id}`
    }
    return Response.json({ ok: true })
  }

  // -- DELETE ----------------------------------------------------
  if (action === 'delete') {
    await sql`DELETE FROM file_servers WHERE id = ${body.id}`
    return Response.json({ ok: true })
  }

  // -- TEST -- connectivity check ---------------------------------
  if (action === 'test') {
    const rows = await sql`SELECT * FROM file_servers WHERE id = ${body.id}`
    if (!rows.length) return Response.json({ ok: false, message: 'File server not found' })
    const fs = rows[0] as Record<string, unknown>
    const transport = fs.transport as string
    const start = Date.now()

    try {
      if (transport === 'smb') {
        // SMB: basic reachability via TCP port 445
        const { createConnection } = await import('net')
        await new Promise<void>((resolve, reject) => {
          const sock = createConnection({ host: fs.host as string, port: 445, timeout: 5000 })
          sock.once('connect', () => { sock.destroy(); resolve() })
          sock.once('error',   (e) => reject(e))
          sock.once('timeout', () => { sock.destroy(); reject(new Error('Timeout')) })
        })
        return Response.json({ ok: true, latency_ms: Date.now() - start, message: 'SMB port 445 reachable' })
      }

      if (transport === 'sftp' || transport === 'ftp') {
        // SFTP/FTP: TCP reachability check
        const { createConnection } = await import('net')
        const port = (fs.port as number) || (transport === 'sftp' ? 22 : 21)
        await new Promise<void>((resolve, reject) => {
          const sock = createConnection({ host: fs.host as string, port, timeout: 5000 })
          sock.once('connect', () => { sock.destroy(); resolve() })
          sock.once('error',   (e) => reject(e))
          sock.once('timeout', () => { sock.destroy(); reject(new Error('Timeout')) })
        })
        return Response.json({ ok: true, latency_ms: Date.now() - start, message: `${transport.toUpperCase()} port ${port} reachable` })
      }

      if (transport === 'local') {
        // Local path: check it exists and is readable
        const { access, constants } = await import('fs/promises')
        await access(fs.share_path as string, constants.R_OK)
        return Response.json({ ok: true, latency_ms: Date.now() - start, message: 'Path readable' })
      }

      if (transport === 's3') {
        // S3-compatible: HEAD bucket request
        const endpoint = (fs.endpoint_url as string) || 'https://s3.amazonaws.com'
        const url = `${endpoint.replace(/\/$/, '')}/${fs.bucket}`
        const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) })
        // 200 = accessible, 403 = exists but auth needed (still reachable)
        const ok = res.status === 200 || res.status === 403
        return Response.json({ ok, latency_ms: Date.now() - start, message: ok ? `S3 endpoint reachable (${res.status})` : `S3 returned ${res.status}` })
      }

      return Response.json({ ok: false, message: `Unknown transport: ${transport}` })
    } catch (err) {
      return Response.json({ ok: false, latency_ms: Date.now() - start, message: err instanceof Error ? err.message : 'Connection failed' })
    }
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 })
}
