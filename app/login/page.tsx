'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'signin', email, password }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Login failed'); return }
      router.push('/')
      router.refresh()
    } catch {
      setError('Could not connect. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const inp: React.CSSProperties = {
    width: '100%', background: 'var(--bg3)', border: '1px solid var(--border2)',
    borderRadius: 7, padding: '10px 12px', fontSize: 13, color: 'var(--text)',
    outline: 'none', marginBottom: 8,
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 360, background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 12, overflow: 'hidden' }}>

        <div style={{ padding: '32px 28px 24px' }}>
          {/* Logo + version */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 18, fontWeight: 500 }}>claude app</span>
            <span style={{ fontSize: 10, color: 'var(--text3)', padding: '1px 6px', borderRadius: 4, background: 'var(--bg3)', border: '1px solid var(--border)' }}>v1.0.0</span>
          </div>
          <p style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 28 }}>Sign in to continue</p>

          <form onSubmit={handleSubmit}>
            <input type="email" placeholder="Email address" value={email}
              onChange={e => setEmail(e.target.value)} required style={inp} />
            <input type="password" placeholder="Password" value={password}
              onChange={e => setPassword(e.target.value)} required style={{ ...inp, marginBottom: error ? 8 : 16 }} />
            {error && <p style={{ fontSize: 11, color: 'var(--red)', marginBottom: 12 }}>{error}</p>}
            <button type="submit" disabled={loading} style={{
              width: '100%', padding: '10px', background: loading ? 'var(--border2)' : 'var(--text)',
              border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 500,
              cursor: loading ? 'not-allowed' : 'pointer', color: 'var(--bg)',
            }}>
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>

        <div style={{ padding: '12px 28px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text3)', textAlign: 'center' }}>
          claude app v1.0.0 · ugx.ai
        </div>
      </div>
    </div>
  )
}
