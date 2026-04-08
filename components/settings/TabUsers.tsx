'use client'
import { useState, useEffect } from 'react'
import type { SessionUser } from '@/lib/auth'
import { SH, SS, INP, Btn, Badge, Field, Grid } from './ui'

interface User { id: string; email: string; name: string; role: string; banned: boolean; created_at: string }

export default function TabUsers({ user }: { user: SessionUser }) {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [showInvite, setShowInvite] = useState(false)
  const [invEmail, setInvEmail] = useState('')
  const [invName, setInvName] = useState('')
  const [invRole, setInvRole] = useState('user')
  const [invPassword, setInvPassword] = useState('')
  const [invResult, setInvResult] = useState<{ tempPassword?: string } | null>(null)
  const [msg, setMsg] = useState('')

  async function load() {
    setLoading(true)
    const res = await fetch('/api/users')
    if (res.ok) { const d = await res.json(); setUsers(d.users) }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function act(action: string, userId: string, extra?: object) {
    const res = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, userId, ...extra }) })
    const d = await res.json()
    if (!res.ok) { setMsg(d.error); return }
    setMsg(''); load()
  }

  async function invite() {
    if (!invEmail) return
    const res = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'invite', email: invEmail, name: invName, role: invRole, password: invPassword }) })
    const d = await res.json()
    if (!res.ok) { setMsg(d.error); return }
    setInvResult(d); load()
  }

  if (user.role !== 'admin') return (
    <div>
      <div style={SH}>Users</div>
      <div style={{ fontSize: 13, color: 'var(--text3)', marginTop: 12 }}>Only admins can manage users.</div>
    </div>
  )

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={SH}>Users</div>
        <Btn variant="primary" onClick={() => { setShowInvite(!showInvite); setInvResult(null) }}>+ add user</Btn>
      </div>
      <div style={SS}>{users.length} user{users.length !== 1 ? 's' : ''} · email + password auth</div>

      {msg && <div style={{ background: 'var(--rbg)', border: '1px solid var(--red)', borderRadius: 6, padding: '8px 12px', fontSize: 11, color: 'var(--rt)', marginBottom: 12 }}>{msg}</div>}

      {showInvite && !invResult && (
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 10, padding: 20, marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 16 }}>Add new user</div>
          <Grid cols={2}>
            <Field label="Email *"><input style={INP} type="email" placeholder="user@company.com" value={invEmail} onChange={e => setInvEmail(e.target.value)} /></Field>
            <Field label="Name"><input style={INP} placeholder="Full name" value={invName} onChange={e => setInvName(e.target.value)} /></Field>
            <Field label="Role">
              <select style={{ ...INP, cursor: 'pointer' }} value={invRole} onChange={e => setInvRole(e.target.value)}>
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>
            </Field>
            <Field label="Password" hint="Leave blank to auto-generate">
              <input style={INP} type="password" placeholder="Auto-generated if blank" value={invPassword} onChange={e => setInvPassword(e.target.value)} />
            </Field>
          </Grid>
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <Btn variant="primary" onClick={invite}>Create user</Btn>
            <Btn onClick={() => setShowInvite(false)}>Cancel</Btn>
          </div>
        </div>
      )}

      {invResult && (
        <div style={{ background: 'var(--gbg)', border: '1px solid var(--green)', borderRadius: 10, padding: 16, marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--gt)', marginBottom: 8 }}>✓ User created</div>
          {invResult.tempPassword && (
            <>
              <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 4 }}>Share these credentials securely:</div>
              <div style={{ background: 'var(--bg3)', borderRadius: 6, padding: '8px 12px', fontSize: 11, fontFamily: 'monospace', color: 'var(--text)' }}>
                Email: {invEmail}<br />Password: {invResult.tempPassword}
              </div>
            </>
          )}
          <Btn style={{ marginTop: 12 }} onClick={() => { setShowInvite(false); setInvResult(null); setInvEmail(''); setInvName(''); setInvPassword('') }}>Done</Btn>
        </div>
      )}

      <div style={{ border: '1px solid var(--border2)', borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['User', 'Email', 'Role', 'Status', 'Joined', 'Actions'].map(h => (
                <th key={h} style={{ padding: '8px 14px', textAlign: 'left', fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.1em', fontWeight: 400 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ padding: 20, textAlign: 'center', fontSize: 11, color: 'var(--text3)' }}>Loading…</td></tr>
            ) : users.map(u => (
              <tr key={u.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '10px 14px', fontSize: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--bg3)', border: '1px solid var(--border2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 500, flexShrink: 0 }}>
                      {u.name.slice(0, 2).toUpperCase()}
                    </div>
                    <span style={{ color: 'var(--text)' }}>{u.name}</span>
                    {u.id === user.id && <span style={{ fontSize: 9, color: 'var(--text3)' }}>(you)</span>}
                  </div>
                </td>
                <td style={{ padding: '10px 14px', fontSize: 11, color: 'var(--text2)' }}>{u.email}</td>
                <td style={{ padding: '10px 14px' }}><Badge label={u.role} color={u.role === 'admin' ? 'purple' : 'gray'} /></td>
                <td style={{ padding: '10px 14px' }}><Badge label={u.banned ? 'banned' : 'active'} color={u.banned ? 'red' : 'green'} /></td>
                <td style={{ padding: '10px 14px', fontSize: 11, color: 'var(--text3)' }}>{new Date(u.created_at).toLocaleDateString()}</td>
                <td style={{ padding: '10px 14px' }}>
                  {u.id !== user.id && (
                    <div style={{ display: 'flex', gap: 4 }}>
                      <Btn onClick={() => act('setRole', u.id, { role: u.role === 'admin' ? 'user' : 'admin' })}>
                        {u.role === 'admin' ? '→ user' : '→ admin'}
                      </Btn>
                      <Btn onClick={() => act(u.banned ? 'unban' : 'ban', u.id)}>
                        {u.banned ? 'unban' : 'ban'}
                      </Btn>
                      <Btn variant="danger" onClick={() => { if (confirm(`Delete ${u.email}?`)) act('delete', u.id) }}>delete</Btn>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
