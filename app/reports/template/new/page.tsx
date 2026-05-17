import { getSession } from '@/lib/auth'
import { redirect } from 'next/navigation'
import TemplateBuilder from '@/components/reports/TemplateBuilder'

export default async function NewTemplatePage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role !== 'admin') redirect('/reports')
  return <TemplateBuilder user={session} />
}
