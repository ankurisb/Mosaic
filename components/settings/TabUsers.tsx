'use client'
import { useState, useEffect } from 'react'
import type { SessionUser } from '@/lib/auth'
import { PageTitle, PageSub, INP, Btn, Badge, Alert, Field, Grid, Spinner } from './ui'

interface User { id: string; email: string; name: string; role: string; banned: boolean; created_at: string }

export default function TabUsers({ user }: { user: SessionUser }) {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [showInvite, setShowInvite] = useState(false)
  const [form, setForm] = useState({ email: '', name: '', role: 'user', password: '' })
  const [invResult, setInvResult] = useState<{ tempPassword?: string; email?: string } | null>(null)
  const [error, setError] = useState('')

  async function load() { setLoading(true); const r = await fetch('/api/users'); if (r.ok) setUsers((await r.json()).users); setLoading(false) }
  useEffect(() => { load() }, [])

  async function act(action: string, userId: string, extra?: object) {
    const r = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, userId, ...extra }) })
    const d = await r.json(); if (!r.ok) { setError(d.error); return }; setError(''); load()
  }

  async function invite() {
    if (!form.email) return
    const r = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'invite', ...form }) })
    const d = await r.json(); if (!r.ok) { setError(d.error); return }
    setInvResult({ ...d, email: form.email }); load()
  }

  if (user.role !== 'admin') return (
    <div className="fade-in"><PageTitle>Users</PageTitle><Alert variant="warning">Only admins can manage users.</Alert></div>
  )

  return (
    <div className="fade-in">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <PageTitle>Users</PageTitle>
        <Btn variant="primary" onClick={() => { setShowInvite(!showInvite); setInvResult(null); setError('') }}>+ Add user</Btn>
      </div>
      <PageSub>{users.length} user{users.length !== 1 ? 's' : ''} . email + password authentication</PageSub>

      {error && <Alert variant="error">{error}</Alert>}

      {showInvite && !invResult && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', padding: 24, marginBottom: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)', marginBottom: 18 }}>Add new user</div>
          <Grid cols={2}>
            <Field label="Email" required><input style={INP} type="email" placeholder="user@company.com" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} /></Field>
            <Field label="Name"><input style={INP} placeholder="Full name" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} /></Field>
            <Field label="Role">
              <select style={{ ...INP, cursor: 'pointer' }} value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))}>
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            </Field>
            <Field label="Password" hint="Leave blank to auto-generate">
              <input style={INP} type="password" placeholder="Auto-generated if blank" value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} />
            </Field>
          </Grid>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <Btn variant="primary" onClick={invite}>Create user</Btn>
            <Btn onClick={() => setShowInvite(false)}>Cancel</Btn>
          </div>
        </div>
      )}

      {invResult && (
        <div style={{ background: 'var(--green-bg)', border: '1px solid rgba(22,163,74,.2)', borderRadius: 'var(--radius)', padding: 20, marginBottom: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--green-t)', marginBottom: 10 }}>ok User created successfully</div>
          {invResult.tempPassword && (
            <>
              <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 8 }}>Share these credentials securely with the new user:</p>
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '10px 14px', fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text)', lineHeight: 1.8 }}>
                Email: {invResult.email}<br />Password: {invResult.tempPassword}
              </div>
            </>
          )}
          <Btn style={{ marginTop: 14 }} onClick={() => { setShowInvite(false); setInvResult(null); setForm({ email: '', name: '', role: 'user', password: '' }) }}>Done</Btn>
        </div>
      )}

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['User', 'Email', 'Role', 'Status', 'Joined', 'Actions'].map(h => (
                <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ padding: 28, textAlign: 'center' }}><Spinner size={18} /></td></tr>
            ) : users.map(u => (
              <tr key={u.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '12px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--bg3)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, color: 'var(--text2)', flexShrink: 0 }}>{u.name.slice(0, 2).toUpperCase()}</div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{u.name} {u.id === user.id && <span style={{ fontSize: 10, color: 'var(--text4)' }}>(you)</span>}</div>
                    </div>
                  </div>
                </td>
                <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text2)' }}>{u.email}</td>
                <td style={{ padding: '12px 16px' }}><Badge label={u.role} color={u.role === 'admin' ? 'purple' : 'gray'} /></td>
                <td style={{ padding: '12px 16px' }}><Badge label={u.banned ? 'banned' : 'active'} color={u.banned ? 'red' : 'green'} /></td>
                <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text3)' }}>{new Date(u.created_at).toLocaleDateString()}</td>
                <td style={{ padding: '12px 16px' }}>
                  {u.id !== user.id && (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Btn size="sm" onClick={() => act('setRole', u.id, { role: u.role === 'admin' ? 'user' : 'admin' })}>{u.role === 'admin' ? ' user' : ' admin'}</Btn>
                      <Btn size="sm" onClick={() => act(u.banned ? 'unban' : 'ban', u.id)}>{u.banned ? 'unban' : 'ban'}</Btn>
                      <Btn size="sm" variant="danger" onClick={() => confirm(`Delete ${u.email}?`) && act('delete', u.id)}>delete</Btn>
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
