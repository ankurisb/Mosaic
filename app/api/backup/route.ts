import { NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { getSession } from '@/lib/auth'

const STATUS_FILE = '/backup-status/last.json'

export async function GET() {
  try {
    const user = await getSession()
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const raw = readFileSync(STATUS_FILE, 'utf8')
    const status = JSON.parse(raw)
    return NextResponse.json(status)
  } catch {
    // Status file doesn't exist yet — backup sidecar hasn't run or isn't deployed
    return NextResponse.json({
      status: 'unknown',
      last_backup_at: null,
      last_archive: null,
      error: 'Backup sidecar not running or has not completed a backup yet.',
      schedule_hours: null,
    })
  }
}
