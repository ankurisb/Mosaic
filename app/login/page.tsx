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

  const li: React.CSSProperties = { width:'100%', background:'var(--bg3)', border:'1px solid var(--border)', borderRadius:7, padding:'9px 12px', fontSize:12, color:'var(--text)', outline:'none', marginBottom:8 }
  const soc: React.CSSProperties = { ...li, display:'flex', alignItems:'center', gap:10, cursor:'pointer', background:'none', border:'1px solid var(--border2)', marginBottom:7 }
  const ic: React.CSSProperties = { width:20, height:20, borderRadius:4, background:'var(--bg3)', border:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:500, flexShrink:0 }

  return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'var(--bg)' }}>
      <div style={{ width:380, background:'var(--bg2)', border:'1px solid var(--border2)', borderRadius:12, overflow:'hidden', boxShadow:'0 4px 24px rgba(0,0,0,0.07)' }}>
        <div style={{ padding:'32px 28px 0' }}>
          <div style={{ display:'flex', alignItems:'baseline', gap:8, marginBottom:4 }}>
            <span style={{ fontSize:17, fontWeight:500 }}>claude app</span>
            <span style={{ fontSize:10, color:'var(--text3)', padding:'1px 6px', borderRadius:4, background:'var(--bg3)', border:'1px solid var(--border2)' }}>v1.0.0</span>
          </div>
          <p style={{ fontSize:11, color:'var(--text3)', marginBottom:24 }}>Sign in to continue · ugx.ai</p>

          <button style={soc}><span style={{...ic, color:'#00a4ef'}}>M</span>Continue with Microsoft</button>
          <button style={soc}><span style={{...ic, color:'#ea4335'}}>G</span>Continue with Google</button>
          <button style={soc}><span style={ic}>⌥</span>Continue with GitHub</button>

          <div style={{ display:'flex', alignItems:'center', gap:10, margin:'14px 0' }}>
            <div style={{ flex:1, height:1, background:'var(--border)' }}/>
            <span style={{ fontSize:10, color:'var(--text3)' }}>or</span>
            <div style={{ flex:1, height:1, background:'var(--border)' }}/>
          </div>

          <form onSubmit={handleSubmit}>
            <input type="email" placeholder="Work email" value={email} onChange={e=>setEmail(e.target.value)} required style={li}/>
            <input type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} required style={{...li, marginBottom: error ? 8 : 16}}
              onKeyDown={e=>{ if(e.key==='Enter') handleSubmit(e as unknown as React.FormEvent) }}/>
            {error && <p style={{ fontSize:11, color:'var(--rt)', marginBottom:10 }}>{error}</p>}
            <button type="submit" disabled={loading} style={{ width:'100%', padding:10, background:'var(--text)', border:'none', borderRadius:7, fontSize:12, fontWeight:500, cursor:loading?'not-allowed':'pointer', color:'var(--bg2)', marginBottom:8, opacity:loading?.6:1 }}>
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
            <button type="button" style={{ width:'100%', padding:9, background:'none', border:'1px solid var(--border2)', borderRadius:7, fontSize:11, cursor:'pointer', color:'var(--text3)' }}>
              Sign in with SSO / SAML →
            </button>
          </form>
        </div>
        <div style={{ padding:'14px 28px', fontSize:11, color:'var(--text3)', textAlign:'center', borderTop:'1px solid var(--border)', marginTop:16 }}>
          v1.0.0 · ugx.ai
        </div>
      </div>
    </div>
  )
}
