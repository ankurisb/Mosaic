'use client'
import { SH, SS, CARD, ROW, ROW_LAST, Btn, Badge } from './ui'
import type { SessionUser } from '@/lib/auth'

export default function TabAuth({ user }: { user: SessionUser }) {
  return (
    <div>
      <div style={SH}>Authentication</div>
      <div style={SS}>Configure how users sign in to your Claude App.</div>

      <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase' as const, letterSpacing: '.1em', marginBottom: 10 }}>Current method</div>
      <div style={CARD}>
        <div style={ROW}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>Email + password <Badge label="active" color="green" /></div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>Users sign in with email and password. Admin creates accounts manually.</div>
          </div>
        </div>
        <div style={ROW_LAST}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>Session duration</div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>JWT tokens expire after 7 days of inactivity</div>
          </div>
          <span style={{ fontSize: 11, color: 'var(--text2)' }}>7 days</span>
        </div>
      </div>

      <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase' as const, letterSpacing: '.1em', marginBottom: 10 }}>SSO providers (coming soon)</div>
      <div style={CARD}>
        {[
          { name: 'Microsoft Entra ID', desc: 'Office 365 / Azure AD single sign-on', icon: 'M', color: '#00a4ef' },
          { name: 'Google Workspace', desc: 'Gmail and Google Workspace accounts', icon: 'G', color: '#ea4335' },
          { name: 'GitHub', desc: 'GitHub OAuth sign-in', icon: '⌥', color: 'var(--text2)' },
        ].map((p, i, arr) => (
          <div key={p.name} style={i === arr.length - 1 ? ROW_LAST : ROW}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--bg3)', border: '1px solid var(--border2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: p.color }}>{p.icon}</div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{p.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>{p.desc}</div>
              </div>
            </div>
            <Btn disabled>configure</Btn>
          </div>
        ))}
      </div>

      <div style={{ background: 'var(--abg)', border: '1px solid var(--amber)', borderRadius: 8, padding: '12px 16px', fontSize: 11, color: 'var(--at)' }}>
        ⚠ SSO and SAML support is on the roadmap. For now, add users manually in the Users tab and share their credentials securely.
      </div>
    </div>
  )
}
