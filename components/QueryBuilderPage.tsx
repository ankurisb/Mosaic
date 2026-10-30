'use client'
import AppShell from './AppShell'
import PageHeader from './PageHeader'
import type { SessionUser } from '@/lib/auth'
import TabQueryRunner from './settings/TabQueryRunner'

export default function QueryBuilderPage({ user }: { user: SessionUser }) {
  return (
    <AppShell user={user}>
      <PageHeader
        title="Query Builder"
        subtitle="Explore any connected data source — pick a source, choose a table, and run."
      />
      <div style={{ flex: 1, overflowY: 'auto', height: 0 }}>
        <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 40px' }}>
          <TabQueryRunner />
        </div>
      </div>
    </AppShell>
  )
}
