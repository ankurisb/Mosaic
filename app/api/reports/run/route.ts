import { NextRequest } from 'next/server'
import { getSession }  from '@/lib/auth'
import { runReport }   from '@/lib/report-runner'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || session.role !== 'admin') {
    return Response.json({ error: 'Admin required' }, { status: 403 })
  }
  const { template_id } = await req.json()
  if (!template_id) return Response.json({ error: 'template_id required' }, { status: 400 })

  const result = await runReport(template_id, session.id, 'manual')
  if (!result.ok) return Response.json({ error: result.error }, { status: 500 })

  return Response.json({
    ok: true,
    instance_id:      result.instance_id,
    pdf_size:         result.pdf_size,
    sections_rendered: result.sections_rendered,
    message: `Report generated successfully`,
  })
}
