import type { SessionUser } from '@/lib/auth'
import { PageTitle, PageSub, SectionLabel, Card, CardRow, Btn, Badge, Alert } from './ui'

export default function TabAuth({ user }: { user: SessionUser }) {
  return (
    <div className="fade-in">
      <PageTitle>Authentication</PageTitle>
      <PageSub>Configure how users sign in to your Mosaic.</PageSub>

      <SectionLabel>Active method</SectionLabel>
      <Card>
        <CardRow>
          <div>
            <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', marginBottom: 2 }}>Email + password <Badge label="active" color="green" /></div>
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>Users sign in with email and password. Admin manages accounts manually.</div>
          </div>
        </CardRow>
        <CardRow last>
          <div>
            <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', marginBottom: 2 }}>Session duration</div>
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>JWT tokens expire after 7 days</div>
          </div>
          <span style={{ fontSize: 13, color: 'var(--text2)', fontWeight: 500 }}>7 days</span>
        </CardRow>
      </Card>

      <SectionLabel>SSO providers</SectionLabel>
      <Card>
        {[
          { name: 'Microsoft Entra ID', desc: 'Office 365 / Azure AD single sign-on', color: '#00a4ef', letter: 'M' },
          { name: 'Google Workspace', desc: 'Gmail and Workspace accounts', color: '#ea4335', letter: 'G' },
          { name: 'GitHub', desc: 'GitHub OAuth', color: '#333', letter: '' },
        ].map((p, i, arr) => (
          <CardRow key={p.name} last={i === arr.length - 1}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 32, height: 32, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--bg3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: p.color, fontWeight: 700 }}>{p.letter}</div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', marginBottom: 1 }}>{p.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)' }}>{p.desc}</div>
              </div>
            </div>
            <Btn size="sm" disabled>coming soon</Btn>
          </CardRow>
        ))}
      </Card>

      <Alert variant="warning">
         SSO support is on the roadmap. For now, add team members in the Users tab and share credentials securely.
      </Alert>
    </div>
  )
}
