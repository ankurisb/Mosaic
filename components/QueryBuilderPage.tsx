'use client'
import AppShell from './AppShell'
import type { SessionUser } from '@/lib/auth'
import TabQueryRunner from './settings/TabQueryRunner'

export default function QueryBuilderPage({ user }: { user: SessionUser }) {
  return (
    <AppShell user={user}>
      <div style={{ flex: 1, overflowY: 'auto', height: 0 }}>
        <div style={{ maxWidth: 960, margin: '0 auto', padding: '32px 40px' }}>
          <TabQueryRunner />
        </div>
      </div>
    </AppShell>
  )
}
