import fs from 'fs'
import path from 'path'
import { notFound } from 'next/navigation'
import DocsPage from './DocsPage'

// Map URL slug → markdown filename in docs/
const DOC_MAP: Record<string, { file: string; title: string }> = {
  'install':      { file: 'INSTALL.md',      title: 'Installation Guide' },
  'first-steps':  { file: 'FIRST_STEPS.md',  title: 'First Steps' },
  'updating':     { file: 'UPDATING.md',      title: 'Update Guide' },
  'secrets':      { file: 'SECRETS.md',       title: 'Secrets & Credentials' },
  'network':      { file: 'NETWORK.md',       title: 'Network Requirements' },
  'keycloak':     { file: 'KEYCLOAK.md',      title: 'SSO / Keycloak Setup' },
  'backup':       { file: 'BACKUP.md',        title: 'Backup & Restore' },
}

export async function generateStaticParams() {
  return Object.keys(DOC_MAP).map(slug => ({ slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const doc = DOC_MAP[slug]
  return { title: doc ? `${doc.title} — Mosaic` : 'Documentation — Mosaic' }
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const doc = DOC_MAP[slug]
  if (!doc) notFound()

  let content = ''
  try {
    content = fs.readFileSync(path.join(process.cwd(), 'docs', doc.file), 'utf8')
  } catch {
    notFound()
  }

  return <DocsPage title={doc.title} slug={slug} content={content} docMap={DOC_MAP} />
}
