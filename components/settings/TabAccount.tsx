'use client'
import { useState } from 'react'
import type { SessionUser } from '@/lib/auth'
import { PageTitle, PageSub, Btn, Alert } from './ui'

const inp: React.CSSProperties = {
  width: '100%', padding: '9px 12px', border: '1.5px solid var(--border2)', borderRadius: 8,
  fontSize: 13, background: 'var(--bg)', color: 'var(--text)', fontFamily: 'inherit',
  outline: 'none', boxSizing: 'border-box',
}
const lbl: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text2)', marginBottom: 6 }

export default function TabAccount({ user }: { user: SessionUser }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function submit() {
    setMsg(null)
    if (next.length < 10 || !/[a-zA-Z]/.test(next) || !/[0-9]/.test(next)) { setMsg({ ok: false, text: 'New password must be at least 10 characters and include a letter and a number.' }); return }
    if (next !== confirm) { setMsg({ ok: false, text: 'New password and confirmation do not match.' }); return }
    if (next === current) { setMsg({ ok: false, text: 'New password must differ from the current one.' }); return }
    setBusy(true)
    try {
      const r = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'changePassword', currentPassword: current, newPassword: next }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Could not change password')
      setMsg({ ok: true, text: 'Password changed.' })
      setCurrent(''); setNext(''); setConfirm('')
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fade-in">
      <PageTitle>Password</PageTitle>
      <PageSub>Change the password for {user.email}.</PageSub>

      {msg && <Alert variant={msg.ok ? 'success' : 'error'}>{msg.text}</Alert>}

      <div style={{
        maxWidth: 420, marginTop: 16, background: 'var(--surface)',
        border: '1px solid var(--border)', borderRadius: 'var(--radius)',
        boxShadow: 'var(--shadow)', padding: 22,
      }}>
        <div style={{ marginBottom: 16 }}>
          <label style={lbl}>Current password</label>
          <input type="password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} style={inp} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={lbl}>New password</label>
          <input type="password" autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} style={inp} />
          <div style={{ fontSize: 11, color: 'var(--text4)', marginTop: 4 }}>At least 10 characters, including a letter and a number.</div>
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={lbl}>Confirm new password</label>
          <input type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} style={inp} />
        </div>
        <Btn variant="primary" onClick={submit} disabled={busy || !current || !next || !confirm}>
          {busy ? 'Changing…' : 'Change password'}
        </Btn>
      </div>
    </div>
  )
}
