import { NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { readFile } from 'fs/promises'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return new Response('Not signed in', { status: 401 })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return new Response('id required', { status: 400 })

  const sql = getDb()
  const [row] = await sql`SELECT * FROM report_instances WHERE id = ${id}`
  if (!row) return new Response('Report not found', { status: 404 })

  const r = row as Record<string, unknown>
  if (!r.pdf_path) return new Response('PDF not available', { status: 404 })

  // Defense-in-depth: pdf_path comes from the DB, but ensure it resolves inside the
  // expected reports directory so a poisoned/legacy path can't read arbitrary files.
  const path = await import('path')
  const REPORTS_DIR = process.env.REPORTS_DIR || '/data/reports'
  const resolved = path.resolve(String(r.pdf_path))
  const rootReal = path.resolve(REPORTS_DIR)
  if (!resolved.startsWith(rootReal + path.sep) && resolved !== rootReal) {
    // Allow the legacy/default location too, but nothing outside a known area.
    if (!resolved.startsWith('/tmp/') && !resolved.startsWith(path.resolve('/data'))) {
      return new Response('Report path is outside the allowed directory', { status: 403 })
    }
  }

  try {
    const buf = await readFile(resolved)
    const filename = `${String(r.name).replace(/[^a-z0-9]/gi, '_')}.pdf`
    return new Response(buf, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(buf.length),
      },
    })
  } catch {
    return new Response('PDF file not found on disk', { status: 404 })
  }
}
