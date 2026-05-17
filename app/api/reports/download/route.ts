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

  try {
    const buf = await readFile(String(r.pdf_path))
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
