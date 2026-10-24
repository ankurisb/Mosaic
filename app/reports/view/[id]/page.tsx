import { redirect } from 'next/navigation'
import { log } from '@/lib/logger'
import { getSession } from '@/lib/auth'
import { setupDatabase } from '@/lib/setup'
import { getDb } from '@/lib/db'
import DigestViewer from '@/components/reports/DigestViewer'

export const dynamic = 'force-dynamic'

export default async function ReportView({ params }: { params: Promise<{ id: string }> }) {
  try { await setupDatabase() } catch (e) { log.error({ service: 'report_view', err: e }, 'DB setup error') }
  const session = await getSession()
  if (!session) redirect('/login')
  const { id } = await params

  const sql = getDb()
  const rows = await sql`
    SELECT i.id, i.name, i.type, i.trigger, i.status, i.generated_at, i.pdf_path, i.pdf_size, i.error, i.template_id,
           t.name as template_name
    FROM report_instances i LEFT JOIN report_templates t ON t.id = i.template_id
    WHERE i.id = ${id}
  `.catch(() => []) as Array<Record<string, unknown>>
  const inst = rows[0] || null

  return <DigestViewer user={session} instance={inst} id={id} />
}
