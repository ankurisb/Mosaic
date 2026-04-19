'use client'
import React from 'react'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import ThemeToggle from '@/components/ThemeToggle'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

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
        </div>

        <div style={{ padding: '12px 32px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text4)', textAlign: 'center' }}>
          Mosaic v1.0.0 · ugx.ai
        </div>
      </div>
    </div>
  )
}
