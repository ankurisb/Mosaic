'use client'
import React, { useState, useEffect } from 'react'
import type { SessionUser } from '@/lib/auth'
import { PageTitle, PageSub, SectionLabel, Card, CardRow, Btn, Badge, Alert, Field, INP } from './ui'
import { safeJson } from '@/lib/fetch'

interface SsoProvider { provider: string; client_id: string; tenant_id?: string; realm?: string; server_url?: string; discovery_url?: string; enabled: number; jit_enabled?: number }

const PROVIDERS = [
  {
    id: 'keycloak',
    name: 'Keycloak',
    desc: 'Self-hosted OIDC — enterprise AD/LDAP federation via your own Keycloak server',
    color: '#4a90d9',
    letter: 'K',
    tenantRequired: false,
    docsUrl: 'https://www.keycloak.org/docs/latest/server_admin/',
    docsLabel: 'Keycloak Admin Docs',
    redirectPath: '/api/auth/callback/keycloak',
    isOidc: true,
  },
  {
    id: 'microsoft',
    name: 'Microsoft Entra ID',
    desc: 'Office 365 / Azure AD single sign-on',
    color: '#00a4ef',
    letter: 'M',
    tenantRequired: true,
    tenantLabel: 'Tenant ID',
    tenantHint: 'From Azure portal → App registrations → Directory (tenant) ID',
    docsUrl: 'https://portal.azure.com',
    docsLabel: 'Azure Portal',
    redirectPath: '/api/auth/callback/microsoft',
    isOidc: false,
  },
  {
    id: 'google',
    name: 'Google Workspace',
    desc: 'Gmail and Workspace accounts',
    color: '#ea4335',
    letter: 'G',
    tenantRequired: false,
    docsUrl: 'https://console.cloud.google.com',
    docsLabel: 'Google Cloud Console',
    redirectPath: '/api/auth/callback/google',
    isOidc: false,
  },
]

export default function TabAuth({ user }: { user: SessionUser }) {
  const [providers, setProviders] = useState<SsoProvider[]>([])
  const [configuring, setConfiguring] = useState<string | null>(null)
  const [form, setForm] = useState({ client_id: '', client_secret: '', tenant_id: '', realm: '', server_url: '', discovery_url: '', jit_enabled: false })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const appUrl = typeof window !== 'undefined' ? window.location.origin : ''
  const [smtp, setSmtp] = useState<{ host?: string; port?: number; username?: string; from_address?: string; from_name?: string; enabled?: number } | null>(null)
  const [smtpForm, setSmtpForm] = useState({ host: '', port: '587', username: '', password: '', from_address: '', from_name: 'Mosaic', enabled: true })
  const [smtpSaving, setSmtpSaving] = useState(false)
  const [smtpError, setSmtpError] = useState('')
  const [smtpSuccess, setSmtpSuccess] = useState('')
  const [smtpTesting, setSmtpTesting] = useState(false)
  const [showSmtpForm, setShowSmtpForm] = useState(false)

  useEffect(() => {
    fetch('/api/auth').then(r => r.json()).then(d => setProviders(d.providers || []))
    fetch('/api/smtp').then(r => r.json()).then(d => {
      if (d.smtp) {
        setSmtp(d.smtp)
        setSmtpForm(f => ({ ...f, host: d.smtp.host || '', port: String(d.smtp.port || 587), username: d.smtp.username || '', from_address: d.smtp.from_address || '', from_name: d.smtp.from_name || 'Mosaic' }))
      }
    })
  }, [])

  async function saveSmtp() {
    if (!smtpForm.host || !smtpForm.from_address) { setSmtpError('Host and from address are required'); return }
    setSmtpSaving(true); setSmtpError(''); setSmtpSuccess('')
    try {
      const r = await fetch('/api/smtp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', ...smtpForm, port: Number(smtpForm.port) }),
      })
      const { error: smtpErr } = await safeJson(r)
      if (smtpErr) { setSmtpError(smtpErr); return }
      setSmtpSuccess('SMTP configuration saved')
      setShowSmtpForm(false)
      const updated = await fetch('/api/smtp').then(r => r.json())
      if (updated.smtp) setSmtp(updated.smtp)
    } catch (e) { setSmtpError(e instanceof Error ? e.message : 'Save failed') }
    setSmtpSaving(false)
  }

  async function testSmtp() {
    setSmtpTesting(true); setSmtpError(''); setSmtpSuccess('')
    try {
      const r = await fetch('/api/smtp', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test' }),
      })
      const { data: d, error: testErr } = await safeJson<{ message?: string }>(r)
      if (testErr) { setSmtpError(testErr); return }
      setSmtpSuccess(d?.message || 'Test email sent')
    } catch (e) { setSmtpError(e instanceof Error ? e.message : 'Test failed') }
    setSmtpTesting(false)
  }

  const getProvider = (id: string) => providers.find(p => p.provider === id)

  async function save(providerId: string) {
    const pc = PROVIDERS.find(p => p.id === providerId)!
    if (!form.client_id) { setError('Client ID is required'); return }
    if (pc.tenantRequired && !form.tenant_id) { setError('Tenant ID is required for Microsoft Entra ID'); return }
    if (pc.isOidc && !form.discovery_url && !(form.server_url && form.realm)) {
      setError('Keycloak requires Server URL + Realm (or a custom Discovery URL)'); return
    }
    setSaving(true); setError(''); setSuccess('')
    try {
      const r = await fetch('/api/auth', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'saveSsoConfig', provider: providerId, ...form, enabled: true, jit_enabled: form.jit_enabled }),
      })
      const { error: ssoErr } = await safeJson(r)
      if (ssoErr) { setError(ssoErr); return }
      setSuccess('SSO configured successfully')
      setConfiguring(null)
      setForm({ client_id: '', client_secret: '', tenant_id: '', realm: '', server_url: '', discovery_url: '', jit_enabled: false })
      const updated = await fetch('/api/auth').then(r => r.json())
      setProviders(updated.providers || [])
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed') }
    finally { setSaving(false) }
  }

  async function remove(providerId: string) {
    if (!confirm(`Remove ${providerId} SSO configuration?`)) return
    await fetch('/api/auth', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'deleteSsoConfig', provider: providerId }),
    })
    setProviders(p => p.filter(x => x.provider !== providerId))
  }

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
      {success && <Alert variant="success" style={{ marginBottom: 12 }}>{success}</Alert>}

      {PROVIDERS.map((pc, i) => {
        const configured = getProvider(pc.id)
        const isConfiguring = configuring === pc.id
        return (
          <Card key={pc.id} style={{ marginBottom: 10 }}>
            <CardRow last={!isConfiguring}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 32, height: 32, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--bg3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: pc.color, fontWeight: 700 }}>{pc.letter}</div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', marginBottom: 1 }}>
                    {pc.name} {configured ? <Badge label="configured" color="green" /> : <Badge label="not configured" color="amber" />}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text3)' }}>{pc.desc}</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {user.role === 'admin' && (
                  <>
                    {configured && <Btn size="sm" variant="danger" onClick={() => remove(pc.id)}>Remove</Btn>}
                    <Btn size="sm" onClick={() => {
                      if (isConfiguring) { setConfiguring(null); setError(''); setForm({ client_id: '', client_secret: '', tenant_id: '', realm: '', server_url: '', discovery_url: '', jit_enabled: false }) }
                      else { setConfiguring(pc.id); setError(''); setForm({ client_id: configured?.client_id || '', client_secret: '', tenant_id: configured?.tenant_id || '', realm: configured?.realm || '', server_url: configured?.server_url || '', discovery_url: configured?.discovery_url || '', jit_enabled: !!(configured?.jit_enabled) }) }
                    }}>{isConfiguring ? 'Cancel' : configured ? 'Edit' : 'Configure'}</Btn>
                  </>
                )}
              </div>
            </CardRow>

            {isConfiguring && (
              <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border)', background: 'var(--bg)' }}>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 16, lineHeight: 1.6 }}>
                  Set up an OAuth app in <a href={pc.docsUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--blue-t)' }}>{pc.docsLabel}</a> and add this redirect URI:
                  <code style={{ display: 'block', marginTop: 6, padding: '6px 10px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: 11, fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>{appUrl}{pc.redirectPath}</code>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <Field label="Client ID">
                    <input style={INP} value={form.client_id} onChange={e => setForm(f => ({ ...f, client_id: e.target.value }))} placeholder={pc.isOidc ? 'mosaic (from Keycloak client)' : 'Application (client) ID'} />
                  </Field>
                  <Field label="Client Secret" hint="Leave blank to keep existing">
                    <input style={{ ...INP, fontFamily: 'var(--font-mono)', fontSize: 12 }} type="password" value={form.client_secret} onChange={e => setForm(f => ({ ...f, client_secret: e.target.value }))} placeholder="Client secret value" />
                  </Field>
                  {pc.tenantRequired && (
                    <Field label={pc.tenantLabel!} hint={pc.tenantHint}>
                      <input style={INP} value={form.tenant_id} onChange={e => setForm(f => ({ ...f, tenant_id: e.target.value }))} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
                    </Field>
                  )}
                  {pc.isOidc && (<>
                    <Field label="Keycloak Server URL" hint="Base URL of your Keycloak server">
                      <input style={INP} value={form.server_url} onChange={e => setForm(f => ({ ...f, server_url: e.target.value }))} placeholder="https://auth.company.com" />
                    </Field>
                    <Field label="Realm" hint="The Keycloak realm name (not 'master')">
                      <input style={INP} value={form.realm} onChange={e => setForm(f => ({ ...f, realm: e.target.value }))} placeholder="mosaic" />
                    </Field>
                    <Field label="Discovery URL (optional)" hint="Auto-built from Server URL + Realm. Override only if needed.">
                      <input style={{ ...INP, fontFamily: 'var(--font-mono)', fontSize: 11 }} value={form.discovery_url} onChange={e => setForm(f => ({ ...f, discovery_url: e.target.value }))} placeholder="https://auth.company.com/realms/mosaic/.well-known/openid-configuration" />
                    </Field>
                  </>)}
                </div>

                {error && <Alert variant="error" style={{ marginBottom: 12 }}>{error}</Alert>}

                {/* JIT provisioning toggle */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 16, padding: '12px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
                  <input type="checkbox" id={`jit-${pc.id}`} checked={!!form.jit_enabled} onChange={e => setForm(f => ({ ...f, jit_enabled: e.target.checked }))} style={{ marginTop: 2, flexShrink: 0 }} />
                  <div>
                    <label htmlFor={`jit-${pc.id}`} style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', cursor: 'pointer' }}>Auto-provision users on first sign-in</label>
                    <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3, lineHeight: 1.5 }}>
                      When enabled, any user in your identity provider can sign in and a Mosaic account is created automatically (role: User).
                      When disabled, users must be added manually in the Users tab before they can sign in via SSO.
                    </div>
                  </div>
                </div>

                <Btn variant="primary" onClick={() => save(pc.id)} disabled={saving}>
                  {saving ? 'Saving...' : 'Save configuration'}
                </Btn>
              </div>
            )}
          </Card>
        )
      })}

      <Alert variant="info" style={{ marginTop: 16 }}>
        SSO is additive — users can still sign in with email and password. With auto-provision off, users must be added in the Users tab first. With auto-provision on, any identity provider user can sign in and an account is created automatically.
      </Alert>

      <div style={{ marginTop: 32 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 12 }}>Email / SMTP</div>
        {smtpSuccess && <Alert variant="success" style={{ marginBottom: 12 }}>{smtpSuccess}</Alert>}
        <Card>
          <CardRow last={!showSmtpForm}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', marginBottom: 1 }}>
                SMTP server {smtp ? <Badge label="configured" color="green" /> : <Badge label="not configured" color="amber" />}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>
                {smtp ? `${smtp.host}:${smtp.port} · ${smtp.from_address}` : 'Used to send welcome emails when users are invited'}
              </div>
            </div>
            {user.role === 'admin' && (
              <div style={{ display: 'flex', gap: 6 }}>
                {smtp && <Btn size="sm" onClick={testSmtp} disabled={smtpTesting}>{smtpTesting ? 'Sending...' : 'Test'}</Btn>}
                <Btn size="sm" onClick={() => { setShowSmtpForm(s => !s); setSmtpError('') }}>{showSmtpForm ? 'Cancel' : smtp ? 'Edit' : 'Configure'}</Btn>
              </div>
            )}
          </CardRow>
          {showSmtpForm && (
            <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border)', background: 'var(--bg)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <Field label="SMTP host" hint="e.g. smtp.gmail.com">
                  <input style={INP} value={smtpForm.host} onChange={e => setSmtpForm(f => ({ ...f, host: e.target.value }))} placeholder="smtp.gmail.com" />
                </Field>
                <Field label="Port" hint="587 (TLS) or 465 (SSL)">
                  <input style={INP} value={smtpForm.port} onChange={e => setSmtpForm(f => ({ ...f, port: e.target.value }))} placeholder="587" />
                </Field>
                <Field label="Username">
                  <input style={INP} value={smtpForm.username} onChange={e => setSmtpForm(f => ({ ...f, username: e.target.value }))} placeholder="you@company.com" />
                </Field>
                <Field label="Password" hint="Leave blank to keep existing">
                  <input style={{ ...INP, fontFamily: 'var(--font-mono)', fontSize: 12 }} type="password" value={smtpForm.password} onChange={e => setSmtpForm(f => ({ ...f, password: e.target.value }))} placeholder="App password" />
                </Field>
                <Field label="From address">
                  <input style={INP} value={smtpForm.from_address} onChange={e => setSmtpForm(f => ({ ...f, from_address: e.target.value }))} placeholder="noreply@company.com" />
                </Field>
                <Field label="From name">
                  <input style={INP} value={smtpForm.from_name} onChange={e => setSmtpForm(f => ({ ...f, from_name: e.target.value }))} placeholder="Mosaic" />
                </Field>
              </div>
              {smtpError && <Alert variant="error" style={{ marginBottom: 12 }}>{smtpError}</Alert>}
              <Btn variant="primary" onClick={saveSmtp} disabled={smtpSaving}>{smtpSaving ? 'Saving...' : 'Save configuration'}</Btn>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
