import { NextResponse } from 'next/server'
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs'
import { getSession } from '@/lib/auth'
import { getDb } from '@/lib/db'

export const runtime = 'nodejs'

const STATUS_FILE  = '/backup-status/last.json'
const TRIGGER_FILE = '/backup-status/trigger'
const CONFIG_FILE  = '/backup-status/config.json'
const BACKUP_DIR   = '/backups'

// ── GET — status + config + archive list ─────────────────────────────────────
export async function GET() {
  const user = await getSession()
  if (!user || user.role !== 'admin')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Read sidecar status
  let status: Record<string, unknown> = {
    status: 'unknown', last_backup_at: null, last_archive: null,
    error: 'Backup sidecar not running — start with docker compose up -d',
    schedule_hours: null,
  }
  try { status = JSON.parse(readFileSync(STATUS_FILE, 'utf8')) } catch { /* sidecar not started */ }

  // Read config (schedule + retention from DB, fallback to env defaults)
  let schedule_hours = 24
  let keep_count = 30
  try {
    const sql = getDb()
    const rows = await sql`SELECT key, value FROM guardrail_settings WHERE key IN ('backup_schedule_hours','backup_keep_count')`
    for (const r of rows as Array<{ key: string; value: string }>) {
      if (r.key === 'backup_schedule_hours') schedule_hours = Number(r.value)
      if (r.key === 'backup_keep_count')     keep_count     = Number(r.value)
    }
  } catch { /* DB not available */ }

  // List existing archives
  let archives: Array<{ name: string; size: number; size_human: string; created_at: string }> = []
  try {
    const files = readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('mosaic-backup-') && f.endsWith('.tar.gz'))
      .map(name => {
        const stat = statSync(`${BACKUP_DIR}/${name}`)
        return { name, size: stat.size, size_human: humanSize(stat.size), created_at: stat.birthtime.toISOString() }
      })
      .sort((a, b) => b.name.localeCompare(a.name))
    archives = files
  } catch { /* backups dir doesn't exist yet */ }

  return NextResponse.json({ ...status, schedule_hours, keep_count, archives })
}

// ── POST — trigger backup or save config ─────────────────────────────────────
export async function POST(req: Request) {
  const user = await getSession()
  if (!user || user.role !== 'admin')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const { action } = body as { action: string }

  // Trigger an immediate backup by writing a trigger file the sidecar watches
  if (action === 'trigger') {
    try {
      writeFileSync(TRIGGER_FILE, new Date().toISOString())
      return NextResponse.json({ ok: true, message: 'Backup triggered — check status in a few seconds.' })
    } catch {
      return NextResponse.json({ error: 'Could not write trigger file — is the backup sidecar running?' }, { status: 500 })
    }
  }

  // Save schedule / retention config
  if (action === 'save_config') {
    const { schedule_hours, keep_count } = body as { schedule_hours: number; keep_count: number }
    try {
      const sql = getDb()
      await sql`INSERT INTO guardrail_settings (key, value) VALUES ('backup_schedule_hours', ${String(schedule_hours)})
        ON CONFLICT (key) DO UPDATE SET value = ${String(schedule_hours)}`
      await sql`INSERT INTO guardrail_settings (key, value) VALUES ('backup_keep_count', ${String(keep_count)})
        ON CONFLICT (key) DO UPDATE SET value = ${String(keep_count)}`
      // Also write to config file so the sidecar can read it without a DB connection
      try { writeFileSync(CONFIG_FILE, JSON.stringify({ schedule_hours, keep_count })) } catch { /* ok */ }
      return NextResponse.json({ ok: true })
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Save failed' }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

function humanSize(bytes: number): string {
  if (bytes < 1024)         return `${bytes} B`
  if (bytes < 1024 * 1024)  return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
