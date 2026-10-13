// app/api/files/[id]/route.ts
// Download a file produced by the code sandbox (run_code). Access is restricted
// to the file's owner (or an admin); images/PDFs render inline, everything else
// downloads. Bytes are streamed from disk; metadata/ownership come from the
// generated_files table.
import { getSession } from '@/lib/auth'
import { getGeneratedFileForUser, readGeneratedFileBytes } from '@/lib/generated-files'

export const runtime = 'nodejs'

const INLINE_MIMES = /^(image\/|application\/pdf$|text\/plain$|text\/html$)/i

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 })
  const { id } = await params
  const row = await getGeneratedFileForUser(String(id), session.id, session.role)
  if (!row) return Response.json({ error: 'File not found or not accessible' }, { status: 404 })

  let bytes: Buffer
  try { bytes = await readGeneratedFileBytes(row) }
  catch { return Response.json({ error: 'File bytes missing' }, { status: 410 }) }

  const disposition = INLINE_MIMES.test(row.mime) ? 'inline' : 'attachment'
  // RFC 5987 filename* so names with spaces/unicode survive.
  const safeName = row.name.replace(/[\r\n"]/g, '_')
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': row.mime || 'application/octet-stream',
      'Content-Length': String(bytes.length),
      'Content-Disposition': `${disposition}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(row.name)}`,
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
