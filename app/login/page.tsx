'use client'
import React from 'react'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import ThemeToggle from '@/components/ThemeToggle'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(() => {
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search).get('error')
      if (p === 'account_not_provisioned') return 'Your account has not been set up yet. Contact your administrator.'
      if (p === 'account_banned') return 'Your account has been disabled.'
      if (p === 'sso_failed') return 'SSO sign-in failed. Please try again or use email and password.'
      if (p) return `SSO error: ${p.replace(/_/g, ' ')}`
    }
    return ''
  })
  const [loading, setLoading] = useState(false)
  const [ssoProviders, setSsoProviders] = useState<Array<{ provider: string; enabled: number }>>([])

  React.useEffect(() => {
    fetch('/api/auth').then(r => r.json()).then(d => setSsoProviders((d.providers || []).filter((p: { enabled: number }) => p.enabled)))
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      const res = await fetch('/api/auth', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'signin', email, password }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Login failed'); return }
      router.push('/'); router.refresh()
    } catch { setError('Could not connect. Please try again.') }
    finally { setLoading(false) }
  }

  const inp: React.CSSProperties = { width: '100%', background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-sm)', padding: '10px 13px', fontSize: 13, color: 'var(--text)', outline: 'none', fontFamily: 'inherit' }
  const lbl: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text2)', marginBottom: 6 }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: 24, position: 'relative' }}>
      <div style={{ position: 'fixed', top: 20, right: 20 }}><ThemeToggle /></div>

      <div className="slide-up" style={{ width: '100%', maxWidth: 380, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)', overflow: 'hidden' }}>
        <div style={{ padding: '32px 32px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
            <span style={{ fontFamily: 'var(--font-serif)', fontSize: 22, color: 'var(--text)' }}>Mosaic</span>
            <span style={{ fontSize: 11, color: 'var(--text3)', background: 'var(--bg3)', padding: '2px 7px', borderRadius: 'var(--radius-pill)', border: '1px solid var(--border)' }}>v1.0.0</span>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text3)' }}>Sign in to continue . ugx.ai</p>
        </div>

        <div style={{ padding: '0 32px 32px' }}>
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 12 }}>
              <label style={lbl}>Email</label>
              <input type="email" placeholder="you@company.com" value={email} onChange={e => setEmail(e.target.value)} required style={inp} />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={lbl}>Password</label>
              <input type="password" placeholder="" value={password} onChange={e => setPassword(e.target.value)} required style={inp} />
            </div>
            {error && <div style={{ background: 'var(--red-bg)', border: '1px solid rgba(220,38,38,.2)', borderRadius: 'var(--radius-sm)', padding: '9px 13px', fontSize: 12, color: 'var(--red-t)', marginBottom: 16 }}>{error}</div>}
            <button type="submit" disabled={loading} style={{ width: '100%', padding: 11, background: 'var(--accent-bg)', border: 'none', borderRadius: 'var(--radius-pill)', fontSize: 14, fontWeight: 500, cursor: loading ? 'not-allowed' : 'pointer', color: 'var(--accent-fg)', opacity: loading ? .6 : 1, boxShadow: 'var(--shadow)', fontFamily: 'inherit' }}>
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

          {ssoProviders.length > 0 && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '20px 0 16px' }}>
                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>or continue with</span>
                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {ssoProviders.map(p => {
                  const label = p.provider === 'microsoft' ? 'Microsoft' : p.provider === 'google' ? 'Google' : p.provider === 'keycloak' ? 'Keycloak' : p.provider.charAt(0).toUpperCase() + p.provider.slice(1)
                  const logo = p.provider === 'microsoft'
                    ? <svg width="16" height="16" viewBox="0 0 21 21"><rect x="1" y="1" width="9" height="9" fill="#f25022"/><rect x="11" y="1" width="9" height="9" fill="#7fba00"/><rect x="1" y="11" width="9" height="9" fill="#00a4ef"/><rect x="11" y="11" width="9" height="9" fill="#ffb900"/></svg>
                    : <svg width="16" height="16" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.08 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-3.59-13.46-8.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
                  return (
                    <a key={p.provider} href={`/api/auth/sso?provider=${p.provider}`}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '10px 16px', border: '1px solid var(--border2)', borderRadius: 'var(--radius-pill)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, fontWeight: 500, textDecoration: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                      {logo}
                      Continue with {label}
                    </a>
                  )
                })}
              </div>
            </>
          )}
        </div>

        <div style={{ padding: '12px 32px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text4)', textAlign: 'center' }}>
          Mosaic v1.0.0 · ugx.ai
        </div>
      </div>
    </div>
  )
}
