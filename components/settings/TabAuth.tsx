import type { SessionUser } from '@/lib/auth'
import { SH, SS, SLBL, CARD, ROW, ROW_LAST, Btn, Badge, Alert } from './ui'

export default function TabAuth({ user }: { user: SessionUser }) {
  void user
  return (
    <div>
      <div style={SH}>Authentication</div>
      <div style={SS}>Configure how users sign in.</div>
      <div style={SLBL}>Social providers</div>
      <div style={CARD}>
        {[
          {label:'Microsoft Entra ID', sub:'Office 365 / Azure AD', badge:'enabled', bc:'green' as const},
          {label:'Google Workspace',   sub:'Gmail / Workspace accounts', badge:'enabled', bc:'green' as const},
          {label:'GitHub',             sub:'GitHub accounts', badge:'not set', bc:'amber' as const},
        ].map((p,i,arr)=>(
          <div key={p.label} style={i===arr.length-1?ROW_LAST:ROW}>
            <div>
              <div style={{ fontSize:12, fontWeight:500, color:'var(--text)' }}>{p.label} <Badge label={p.badge} color={p.bc}/></div>
              <div style={{ fontSize:11, color:'var(--text3)', marginTop:2 }}>{p.sub}</div>
            </div>
            <div style={{ display:'flex', gap:6 }}>
              <Btn size="sm">configure</Btn>
              {p.badge==='enabled'&&<Btn size="sm" variant="danger">disable</Btn>}
            </div>
          </div>
        ))}
      </div>
      <div style={SLBL}>Enterprise SSO</div>
      <div style={CARD}>
        <div style={ROW}>
          <div>
            <div style={{ fontSize:12, fontWeight:500, color:'var(--text)' }}>Microsoft Entra ID <Badge label="active" color="blue"/></div>
            <div style={{ fontSize:11, color:'var(--text3)', marginTop:2 }}>OIDC · domain: ugx.ai</div>
          </div>
          <div style={{ display:'flex', gap:6 }}><Btn size="sm">edit</Btn><Btn size="sm" variant="danger">remove</Btn></div>
        </div>
        <div style={ROW_LAST}>
          <div>
            <div style={{ fontSize:12, fontWeight:500, color:'var(--text)' }}>Google Workspace <Badge label="active" color="blue"/></div>
            <div style={{ fontSize:11, color:'var(--text3)', marginTop:2 }}>SAML · domain: ugx.ai</div>
          </div>
          <div style={{ display:'flex', gap:6 }}><Btn size="sm">edit</Btn><Btn size="sm" variant="danger">remove</Btn></div>
        </div>
      </div>
      <div style={SLBL}>Security</div>
      <div style={CARD}>
        <div style={ROW}>
          <div>
            <div style={{ fontSize:12, fontWeight:500, color:'var(--text)' }}>Two-factor authentication <Badge label="optional" color="gray"/></div>
            <div style={{ fontSize:11, color:'var(--text3)', marginTop:2 }}>TOTP via authenticator app</div>
          </div>
          <Btn size="sm">make required</Btn>
        </div>
        <div style={ROW_LAST}>
          <div>
            <div style={{ fontSize:12, fontWeight:500, color:'var(--text)' }}>Session duration</div>
            <div style={{ fontSize:11, color:'var(--text3)', marginTop:2 }}>Sign out after inactivity</div>
          </div>
          <select style={{ background:'var(--bg3)', border:'1px solid var(--border2)', borderRadius:5, padding:'3px 8px', fontSize:11, color:'var(--text2)', outline:'none' }}>
            <option>7 days</option><option>24 hours</option><option>30 days</option>
          </select>
        </div>
      </div>
      <Alert variant="warning">SSO support is on the roadmap. Add team members in the Users tab for now.</Alert>
    </div>
  )
}
