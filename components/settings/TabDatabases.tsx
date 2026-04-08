'use client'
import { useState, useEffect } from 'react'
import type { SessionUser } from '@/lib/auth'
import { SH, SS, INP, SEL, Btn, Badge, StatusDot, Field, Grid, Spinner } from './ui'

interface DbConn { id: string; label: string; dialect: string; environment: string; host: string; port: number; database_name: string; username: string; schema_name: string; ssl_mode: string; pool_min: number; pool_max: number; read_only: boolean }

const EMPTY = { label: '', dialect: 'postgres', environment: 'development', host: '', port: '5432', database_name: '', username: '', password: '', connection_string: '', schema_name: 'public', ssl_mode: 'prefer', ssl_ca: '', pool_min: '1', pool_max: '5', connect_timeout_ms: '5000', query_timeout_ms: '30000', read_only: false }

export default function TabDatabases({ user }: { user: SessionUser }) {
  const [conns, setConns] = useState<DbConn[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<Record<string, string | boolean>>(EMPTY)
  const [editing, setEditing] = useState<string | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message?: string; latencyMs?: number }>>({})
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  async function load() {
    setLoading(true)
    const res = await fetch('/api/connections')
    if (res.ok) { const d = await res.json(); setConns(d.connections) }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const set = (k: string, v: string | boolean) => setForm(p => ({ ...p, [k]: v }))

  async function save() {
    if (!form.label) { setMsg('Label is required'); return }
    setSaving(true)
    const res = await fetch('/api/connections', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: editing ? 'update' : 'create', id: editing, ...form }),
    })
    const d = await res.json()
    if (!res.ok) { setMsg(d.error); setSaving(false); return }
    setMsg(''); setSaving(false); setShowForm(false); setEditing(null); setForm(EMPTY); load()
  }

  async function test(id: string) {
    setTesting(id)
    const res = await fetch('/api/connections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'test', id }) })
    const d = await res.json()
    setTestResults(p => ({ ...p, [id]: d }))
    setTesting(null)
  }

  async function del(id: string, label: string) {
    if (!confirm(`Delete "${label}"?`)) return
    await fetch('/api/connections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', id }) })
    load()
  }

  function editConn(c: DbConn) {
    setForm({ ...EMPTY, ...c, port: String(c.port), pool_min: String(c.pool_min), pool_max: String(c.pool_max) })
    setEditing(c.id); setShowForm(true)
  }

  const envColor = (e: string) => e === 'production' ? 'red' : e === 'staging' ? 'amber' : 'green'
  const SSL_MODES = ['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full']

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={SH}>Databases</div>
        {user.role === 'admin' && <Btn variant="primary" onClick={() => { setShowForm(!showForm); setEditing(null); setForm(EMPTY) }}>+ add database</Btn>}
      </div>
      <div style={SS}>Connect your databases so Claude can query them directly in chat.</div>
      <div style={{ background: 'var(--bbg)', border: '1px solid var(--blue)', borderRadius: 8, padding: '10px 14px', fontSize: 11, color: 'var(--bt)', marginBottom: 20 }}>
        💬 Once connected, ask Claude: <em>"Query the [connection name] database for..."</em>
      </div>

      {msg && <div style={{ background: 'var(--rbg)', border: '1px solid var(--red)', borderRadius: 6, padding: '8px 12px', fontSize: 11, color: 'var(--rt)', marginBottom: 12 }}>{msg}</div>}

      {showForm && (
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 10, padding: 20, marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 16 }}>{editing ? 'Edit connection' : 'New database connection'}</div>

          <Grid cols={2}>
            <Field label="Display label *"><input style={INP} placeholder="Production DB" value={String(form.label)} onChange={e => set('label', e.target.value)} /></Field>
            <Field label="Environment">
              <select style={SEL} value={String(form.environment)} onChange={e => set('environment', e.target.value)}>
                <option value="production">🔴 Production</option>
                <option value="staging">🟡 Staging</option>
                <option value="development">🟢 Development</option>
              </select>
            </Field>
          </Grid>

          <Field label="Database type">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const }}>
              {['postgres', 'mysql', 'mssql', 'sqlite'].map(d => (
                <button key={d} onClick={() => set('dialect', d)}
                  style={{ padding: '5px 12px', borderRadius: 20, border: `1px solid ${form.dialect === d ? 'var(--blue)' : 'var(--border2)'}`, background: form.dialect === d ? 'var(--bbg)' : 'none', color: form.dialect === d ? 'var(--bt)' : 'var(--text2)', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>
                  {d === 'postgres' ? 'PostgreSQL' : d === 'mysql' ? 'MySQL' : d === 'mssql' ? 'SQL Server' : 'SQLite'}
                </button>
              ))}
            </div>
          </Field>

          <Grid cols={3}>
            <Field label="Host *"><input style={INP} placeholder="db.company.com" value={String(form.host)} onChange={e => set('host', e.target.value)} /></Field>
            <Field label="Port"><input style={INP} placeholder="5432" value={String(form.port)} onChange={e => set('port', e.target.value)} /></Field>
            <Field label="Database name"><input style={INP} placeholder="mydb" value={String(form.database_name)} onChange={e => set('database_name', e.target.value)} /></Field>
          </Grid>

          <Grid cols={3}>
            <Field label="Username"><input style={INP} placeholder="app_user" value={String(form.username)} onChange={e => set('username', e.target.value)} /></Field>
            <Field label="Password" hint="Stored encrypted"><input style={INP} type="password" placeholder="••••••••" value={String(form.password)} onChange={e => set('password', e.target.value)} /></Field>
            <Field label="Schema" hint="Default: public"><input style={INP} placeholder="public" value={String(form.schema_name)} onChange={e => set('schema_name', e.target.value)} /></Field>
          </Grid>

          <Field label="Or use full connection string" hint="Overrides host/port/user/pass above">
            <input style={INP} type="password" placeholder="postgresql://user:pass@host:5432/db?sslmode=require" value={String(form.connection_string)} onChange={e => set('connection_string', e.target.value)} />
          </Field>

          <Grid cols={2}>
            <Field label="SSL mode">
              <select style={SEL} value={String(form.ssl_mode)} onChange={e => set('ssl_mode', e.target.value)}>
                {SSL_MODES.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </Field>
            <Field label="Pool size (min / max)">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <input style={INP} type="number" placeholder="1" value={String(form.pool_min)} onChange={e => set('pool_min', e.target.value)} />
                <input style={INP} type="number" placeholder="5" value={String(form.pool_max)} onChange={e => set('pool_max', e.target.value)} />
              </div>
            </Field>
          </Grid>

          {(form.ssl_mode === 'verify-ca' || form.ssl_mode === 'verify-full') && (
            <Field label="CA Certificate (PEM)" hint="Paste the contents of your CA cert file">
              <textarea style={{ ...INP, resize: 'vertical' as const, minHeight: 80, fontSize: 11 }} placeholder="-----BEGIN CERTIFICATE-----" value={String(form.ssl_ca)} onChange={e => set('ssl_ca', e.target.value)} />
            </Field>
          )}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={Boolean(form.read_only)} onChange={e => set('read_only', e.target.checked)} />
              <span style={{ color: 'var(--text2)' }}>Read-only (block INSERT/UPDATE/DELETE)</span>
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn variant="primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save connection'}</Btn>
              <Btn onClick={() => { setShowForm(false); setEditing(null); setForm(EMPTY) }}>Cancel</Btn>
            </div>
          </div>
        </div>
      )}

      {loading ? <div style={{ textAlign: 'center', padding: 40 }}><Spinner /></div> : (
        <div style={{ border: '1px solid var(--border2)', borderRadius: 10, overflow: 'hidden' }}>
          {conns.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', fontSize: 12, color: 'var(--text3)' }}>No database connections yet. Add one above to start querying from chat.</div>
          ) : conns.map((c, i) => {
            const tr = testResults[c.id]
            return (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: i < conns.length - 1 ? '1px solid var(--border)' : 'none', background: 'var(--bg2)' }}>
                <StatusDot status={tr ? (tr.ok ? 'healthy' : 'down') : 'unknown'} />
                <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text2)' }}>{c.dialect.toUpperCase()}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>{c.label} <Badge label={c.environment} color={envColor(c.environment)} /></div>
                  <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 1 }}>
                    {c.host}:{c.port}/{c.database_name} · SSL: {c.ssl_mode} · pool {c.pool_min}–{c.pool_max}
                    {c.read_only && ' · read-only'}
                  </div>
                  {tr && <div style={{ fontSize: 10, color: tr.ok ? 'var(--gt)' : 'var(--rt)', marginTop: 2 }}>
                    {tr.ok ? `✓ connected · ${tr.latencyMs}ms` : `✗ ${tr.message}`}
                  </div>}
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <Btn onClick={() => test(c.id)} disabled={testing === c.id}>{testing === c.id ? '…' : 'test'}</Btn>
                  {user.role === 'admin' && <Btn onClick={() => editConn(c)}>edit</Btn>}
                  {user.role === 'admin' && <Btn variant="danger" onClick={() => del(c.id, c.label)}>delete</Btn>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
