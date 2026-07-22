'use client'
import { useState, useEffect } from 'react'
import type { SessionUser } from '@/lib/auth'
import { PageTitle, PageSub, INP, Btn, Badge, Alert, Field, Grid, Spinner } from './ui'
import { safeJson } from '@/lib/fetch'
import { SURFACES, SURFACE_LABELS } from '@/lib/surfaces'

interface User {
  id: string; email: string; name: string; role: string; banned: boolean
  created_at: string; invite_sent_at: string | null; last_login_at: string | null; sso_provider: string | null
  surfaces?: string[]
}

const PAGE_SIZE = 10

// Row-action icons. 14×14, stroke 1.4 with round caps — matches the settings
// nav icon style. Kept icon-only (with a title tooltip on each button) so five
// actions fit one compact row instead of stretching or stacking.
const ico = { width: 15, height: 15, viewBox: '0 0 14 14', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
const IconAccess   = () => <svg {...ico}><path d="M7 8.5A2.5 2.5 0 107 3.5a2.5 2.5 0 000 5z"/><path d="M2.5 12c.6-2 2.3-3 4.5-3s3.9 1 4.5 3"/></svg>
const IconResetPw  = () => <svg {...ico}><path d="M11.5 6.5a4.5 4.5 0 10-1.2 3.5"/><path d="M11.5 3v3.5H8"/></svg>
const IconPromote  = () => <svg {...ico}><path d="M7 11V3M4 6l3-3 3 3"/></svg>
const IconDemote   = () => <svg {...ico}><path d="M7 3v8M4 8l3 3 3-3"/></svg>
const IconSuspend  = () => <svg {...ico}><rect x="3" y="2.5" width="2.5" height="9" rx="0.6"/><rect x="8.5" y="2.5" width="2.5" height="9" rx="0.6"/></svg>
const IconUnban    = () => <svg {...ico}><path d="M3 7.5l2.5 2.5L11 4"/></svg>
const IconDelete   = () => <svg {...ico}><path d="M3 4h8M5.5 4V2.8h3V4M4 4l.5 7.5h5L10 4"/></svg>

// Square icon-button sizing: overrides Btn's pill padding so each action is a
// compact 30px square rather than a wide pill.
const ICON_BTN: React.CSSProperties = { padding: 0, width: 30, height: 30, flexShrink: 0 }


export default function TabUsers({ user }: { user: SessionUser }) {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [showInvite, setShowInvite] = useState(false)
  const [form, setForm] = useState<{ email: string; name: string; role: string; password: string; surfaces: string[] }>({ email: '', name: '', role: 'user', password: '', surfaces: [] })
  const [invResult, setInvResult] = useState<{ tempPassword?: string; email?: string } | null>(null)
  const [error, setError] = useState('')
  const [accessUser, setAccessUser] = useState<User | null>(null)
  const [accessSel, setAccessSel] = useState<string[]>([])
  const [accessSaving, setAccessSaving] = useState(false)
  const [resetResult, setResetResult] = useState<{ email: string; tempPassword: string } | null>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState<'all'|'active'|'banned'>('all')

  async function resetPassword(u: User) {
    if (!confirm(`Reset password for ${u.email}? They will need the new temporary password to sign in.`)) return
    setError('')
    try {
      const r = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'resetPassword', userId: u.id }) })
      const { data: d, error: err } = await safeJson(r)
      if (err) { setError(err); return }
      setResetResult({ email: u.email, tempPassword: (d as { tempPassword: string }).tempPassword })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Password reset failed')
    }
  }

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

  function openAccess(u: User) {
    setAccessUser(u)
    setAccessSel(u.surfaces || [])
    setError('')
  }

  async function saveAccess() {
    if (!accessUser) return
    setAccessSaving(true)
    try {
      const r = await fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'setSurfaces', userId: accessUser.id, surfaces: accessSel }) })
      const { error: err } = await safeJson(r)
      if (err) { setError(err); return }
      setError(''); setAccessUser(null); load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save access')
    } finally {
      setAccessSaving(false)
    }
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
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text2)', marginBottom: 8 }}>Interface access</div>
            {form.role === 'admin' ? (
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>Admins have access to all interfaces.</div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {SURFACES.map(s => {
                  const on = form.surfaces.includes(s)
                  return (
                    <button key={s} type="button"
                      onClick={() => setForm(p => ({ ...p, surfaces: on ? p.surfaces.filter(x => x !== s) : [...p.surfaces, s] }))}
                      style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 12px', borderRadius: 'var(--radius-sm)', border: `1px solid ${on ? 'var(--text)' : 'var(--border)'}`, background: on ? 'var(--text)' : 'var(--bg)', color: on ? 'var(--bg)' : 'var(--text2)', cursor: 'pointer', fontSize: 12, transition: 'all .12s' }}>
                      <span style={{ fontSize: 11 }}>{on ? '✓' : '+'}</span>{SURFACE_LABELS[s]}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
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
          <Btn style={{ marginTop: 14 }} onClick={() => { setShowInvite(false); setInvResult(null); setForm({ email: '', name: '', role: 'user', password: '', surfaces: [] }) }}>Done</Btn>
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
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
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
              <tr><td colSpan={6} style={{ padding: 28, textAlign: 'center', fontSize: 13, color: 'var(--text3)' }}>No users found</td></tr>
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
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
                      <Btn size="sm" title={`Access — ${u.role === 'admin' ? 'all surfaces' : `${u.surfaces?.length || 0} granted`}`} onClick={() => openAccess(u)} style={ICON_BTN}><IconAccess /></Btn>
                      <Btn size="sm" title="Reset password" onClick={() => resetPassword(u)} style={ICON_BTN}><IconResetPw /></Btn>
                      <Btn size="sm" title={u.role === 'admin' ? 'Demote to user' : 'Promote to admin'} onClick={() => act('setRole', u.id, { role: u.role === 'admin' ? 'user' : 'admin' })} style={ICON_BTN}>{u.role === 'admin' ? <IconDemote /> : <IconPromote />}</Btn>
                      <Btn size="sm" title={u.banned ? 'Unban user' : 'Suspend user'} onClick={() => act(u.banned ? 'unban' : 'ban', u.id)} style={ICON_BTN}>{u.banned ? <IconUnban /> : <IconSuspend />}</Btn>
                      <Btn size="sm" variant="danger" title="Delete user" onClick={() => { if(confirm(`Delete ${u.email}? This cannot be undone.`)) act('delete', u.id) }} style={ICON_BTN}><IconDelete /></Btn>
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

      {accessUser && (
        <div onClick={() => !accessSaving && setAccessUser(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', padding: 24, width: 420, maxWidth: '90vw' }}>
            <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)', marginBottom: 4 }}>Interface access</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 18 }}>{accessUser.name} · {accessUser.email}</div>
            {accessUser.role === 'admin' ? (
              <Alert variant="info">Admins have access to all interfaces. Change the role to User to set specific access.</Alert>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {SURFACES.map(s => {
                  const on = accessSel.includes(s)
                  return (
                    <button key={s} type="button"
                      onClick={() => setAccessSel(prev => on ? prev.filter(x => x !== s) : [...prev, s])}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', borderRadius: 'var(--radius-sm)', border: `1px solid ${on ? 'var(--text)' : 'var(--border)'}`, background: on ? 'var(--text)' : 'var(--bg)', color: on ? 'var(--bg)' : 'var(--text2)', cursor: 'pointer', fontSize: 13, textAlign: 'left', transition: 'all .12s' }}>
                      <span style={{ width: 16, fontSize: 12 }}>{on ? '✓' : ''}</span>{SURFACE_LABELS[s]}
                    </button>
                  )
                })}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
              <Btn onClick={() => setAccessUser(null)} disabled={accessSaving}>Cancel</Btn>
              {accessUser.role !== 'admin' && <Btn variant="primary" onClick={saveAccess} disabled={accessSaving}>{accessSaving ? 'Saving…' : 'Save access'}</Btn>}
            </div>
          </div>
        </div>
      )}
      {resetResult && (
        <div onClick={() => setResetResult(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', padding: 24, width: 440, maxWidth: '90vw' }}>
            <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)', marginBottom: 4 }}>Password reset</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 16 }}>{resetResult.email}</div>
            <Alert variant="warning">This temporary password is shown once. Copy it now and share it securely — the user should change it after signing in.</Alert>
            <div style={{ marginTop: 14, padding: '12px 14px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontFamily: 'ui-monospace, monospace', fontSize: 14, color: 'var(--text)', wordBreak: 'break-all' }}>
              {resetResult.tempPassword}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 18, justifyContent: 'flex-end' }}>
              <Btn onClick={() => navigator.clipboard?.writeText(resetResult.tempPassword)}>Copy</Btn>
              <Btn variant="primary" onClick={() => setResetResult(null)}>Done</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
