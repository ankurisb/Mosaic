import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import TemplateBuilder from '@/components/reports/TemplateBuilder'

export default async function EditTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role !== 'admin') redirect('/reports')
  const { id } = await params
  return <TemplateBuilder user={session} templateId={id} />
}
