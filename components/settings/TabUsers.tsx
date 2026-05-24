'use client'
import { useState, useEffect } from 'react'
import type { SessionUser } from '@/lib/auth'
import { PageTitle, PageSub, INP, Btn, Badge, Alert, Field, Grid, Spinner } from './ui'
import { safeJson } from '@/lib/fetch'

interface User {
  id: string; email: string; name: string; role: string; banned: boolean
  created_at: string; invite_sent_at: string | null; last_login_at: string | null; sso_provider: string | null
}

const PAGE_SIZE = 10

export default function TabUsers({ user }: { user: SessionUser }) {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [showInvite, setShowInvite] = useState(false)
  const [form, setForm] = useState({ email: '', name: '', role: 'user', password: '' })
  const [invResult, setInvResult] = useState<{ tempPassword?: string; email?: string } | null>(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState<'all'|'active'|'banned'>('all')

  async function load() {
    setLoading(true)
    const r = await fetch('/api/users')
    if (r.ok) setUsers((await r.json()).users)
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function act(action: string, userId: string, extra?: object) {
    try {
      const r = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, userId, ...extra }) })
      const { error: err } = await safeJson(r)
      if (err) { setError(err); return }
      setError(''); load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Action failed') }
  }

  async function invite() {
    if (!form.email) return
    try {
      const r = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'invite', ...form }) })
      const { data: d, error: err } = await safeJson<Record<string,unknown>>(r)
      if (err) { setError(err); return }
      setInvResult({ ...(d || {}), email: form.email }); load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Invite failed') }
  }

  const filtered = users.filter(u => {
    const q = search.toLowerCase()
    const matchSearch = !q || u.email.toLowerCase().includes(q) || u.name.toLowerCase().includes(q)
    const matchStatus = statusFilter === 'all' || (statusFilter === 'banned' ? u.banned : !u.banned)
    return matchSearch && matchStatus
  })
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE) || 1
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }) : '—'
  const fmtDateTime = (d: string | null) => d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'

  if (user.role !== 'admin') return (
    <div className="fade-in"><PageTitle>Users</PageTitle><Alert variant="warning">Only admins can manage users.</Alert></div>
  )

  const totalActive = users.filter(u => !u.banned).length
  const totalInvited = users.filter(u => u.invite_sent_at).length
  const totalLoggedIn = users.filter(u => u.last_login_at).length
  const totalSso = users.filter(u => u.sso_provider).length

  return (
    <div className="fade-in">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <PageTitle>Users</PageTitle>
        <Btn variant="primary" onClick={() => { setShowInvite(!showInvite); setInvResult(null); setError('') }}>+ Add user</Btn>
      </div>
      <PageSub>{users.length} user{users.length !== 1 ? 's' : ''} · email + password authentication</PageSub>

      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { label: 'Total users', value: users.length },
          { label: 'Active', value: totalActive },
          { label: 'Invites sent', value: totalInvited },
          { label: 'Logged in', value: totalLoggedIn },
          { label: 'SSO users', value: totalSso },
        ].map(s => (
          <div key={s.label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '10px 16px', minWidth: 100 }}>
            <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--text)' }}>{s.value}</div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

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
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--green-t)', marginBottom: 10 }}>✓ User created successfully</div>
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

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <input style={{ ...INP, flex: 1, fontSize: 13 }} placeholder="Search by name or email..." value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} />
        <select style={{ ...INP, width: 'auto', cursor: 'pointer', fontSize: 13 }} value={statusFilter} onChange={e => { setStatusFilter(e.target.value as 'all'|'active'|'banned'); setPage(1) }}>
          <option value="all">All users</option>
          <option value="active">Active only</option>
          <option value="banned">Banned only</option>
        </select>
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['User', 'Role', 'Status', 'Auth', 'Last login', 'Actions'].map(h => (
                <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ padding: 28, textAlign: 'center' }}><Spinner size={18} /></td></tr>
            ) : paged.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: 28, textAlign: 'center', fontSize: 13, color: 'var(--text3)' }}>No users found</td></tr>
            ) : paged.map(u => (
              <tr key={u.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '12px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--bg3)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, color: 'var(--text2)', flexShrink: 0 }}>{u.name.slice(0, 2).toUpperCase()}</div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{u.name} {u.id === user.id && <span style={{ fontSize: 10, color: 'var(--text4)' }}>(you)</span>}</div>
                      <div style={{ fontSize: 11, color: 'var(--text3)' }}>{u.email}</div>
                    </div>
                  </div>
                </td>
                <td style={{ padding: '12px 12px' }}><Badge label={u.role} color={u.role === 'admin' ? 'purple' : 'gray'} /></td>
                <td style={{ padding: '12px 12px' }}><Badge label={u.banned ? 'banned' : 'active'} color={u.banned ? 'red' : 'green'} /></td>
                <td style={{ padding: '12px 12px' }}>
                  {u.sso_provider ? <Badge label={u.sso_provider} color="blue" /> : <Badge label="password" color="gray" />}
                </td>
                <td style={{ padding: '12px 12px', fontSize: 12, color: 'var(--text3)', whiteSpace: 'nowrap' }}>{fmtDateTime(u.last_login_at) || '—'}</td>
                <td style={{ padding: '12px 12px' }}>
                  {u.id !== user.id && (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'nowrap' }}>
                      <Btn size="sm" onClick={() => act('setRole', u.id, { role: u.role === 'admin' ? 'user' : 'admin' })}>{u.role === 'admin' ? '↓ User' : '↑ Admin'}</Btn>
                      <Btn size="sm" onClick={() => act(u.banned ? 'unban' : 'ban', u.id)}>{u.banned ? 'Unban' : 'Suspend'}</Btn>
                      <Btn size="sm" variant="danger" onClick={() => { if(confirm(`Delete ${u.email}? This cannot be undone.`)) act('delete', u.id) }}>Delete</Btn>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderTop: '1px solid var(--border)', background: 'var(--bg)' }}>
          <span style={{ fontSize: 12, color: 'var(--text3)' }}>{filtered.length} user{filtered.length !== 1 ? 's' : ''}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', cursor: page === 1 ? 'not-allowed' : 'pointer', color: 'var(--text3)', fontSize: 12 }}>←</button>
            <span style={{ fontSize: 12, color: 'var(--text3)' }}>Page {page} of {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', cursor: page === totalPages ? 'not-allowed' : 'pointer', color: 'var(--text3)', fontSize: 12 }}>→</button>
          </div>
        </div>
      </div>
    </div>
  )
}
