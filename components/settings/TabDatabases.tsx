'use client'
import { useState, useEffect } from 'react'
import type { SessionUser } from '@/lib/auth'
import { PageTitle, PageSub, INP, SEL, Btn, Badge, StatusDot, Field, Grid, Alert, Spinner } from './ui'

interface DbConn { id: string; label: string; dialect: string; environment: string; host: string; port: number; database_name: string; username: string; schema_name: string; ssl_mode: string; pool_min: number; pool_max: number; read_only: boolean }
const EMPTY = { label: '', dialect: 'postgres', environment: 'development', host: '', port: '5432', database_name: '', username: '', password: '', connection_string: '', schema_name: 'public', ssl_mode: 'prefer', ssl_ca: '', pool_min: '1', pool_max: '5', connect_timeout_ms: '5000', query_timeout_ms: '30000', read_only: false }

export default function TabDatabases({ user }: { user: SessionUser }) {
  const [conns, setConns] = useState<DbConn[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<Record<string, string | boolean>>(EMPTY)
  const [editing, setEditing] = useState<string | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, { ok: boolean; message?: string; latencyMs?: number }>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function load() { setLoading(true); const r = await fetch('/api/connections'); if (r.ok) setConns((await r.json()).connections); setLoading(false) }
  useEffect(() => { load() }, [])

  const set = (k: string, v: string | boolean) => setForm(p => ({ ...p, [k]: v }))

  async function save() {
    if (!form.label) { setError('Label is required'); return }
    setSaving(true)
    const r = await fetch('/api/connections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: editing ? 'update' : 'create', id: editing, ...form }) })
    const d = await r.json()
    if (!r.ok) { setError(d.error); setSaving(false); return }
    setSaving(false); setShowForm(false); setEditing(null); setForm(EMPTY); setError(''); load()
  }

  async function test(id: string) {
    setTesting(id)
    const r = await fetch('/api/connections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'test', id }) })
    const data = await r.json()
    setResults(p => ({ ...p, [id]: data })); setTesting(null)
  }

  function del(id: string, label: string) {
    if (!confirm(`Delete "${label}"?`)) return
    fetch('/api/connections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', id }) })
      .then(() => load())
  }

  const envColor = (e: string): 'red'|'amber'|'green' => e === 'production' ? 'red' : e === 'staging' ? 'amber' : 'green'

  return (
    <div className="fade-in">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <PageTitle>Databases</PageTitle>
        {user.role === 'admin' && <Btn variant="primary" onClick={() => { setShowForm(!showForm); setEditing(null); setForm(EMPTY); setError('') }}>+ Add database</Btn>}
      </div>
      <PageSub>Connect your databases so Claude can query them directly in chat.</PageSub>

      <Alert variant="info">💬 Once connected, ask Claude: <em>"Query the [connection label] database for all customers ordered by revenue"</em></Alert>

      {error && <Alert variant="error">{error}</Alert>}

      {showForm && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', padding: 24, marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 500, color: 'var(--text)', marginBottom: 20 }}>{editing ? 'Edit connection' : 'New database connection'}</div>

          <Grid cols={2}>
            <Field label="Display label" required><input style={INP} placeholder="Production DB" value={String(form.label)} onChange={e => set('label', e.target.value)} /></Field>
            <Field label="Environment">
              <select style={SEL} value={String(form.environment)} onChange={e => set('environment', e.target.value)}>
                <option value="production">🔴 Production</option>
                <option value="staging">🟡 Staging</option>
                <option value="development">🟢 Development</option>
              </select>
            </Field>
          </Grid>

          <Field label="Database type">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[['postgres','PostgreSQL'],['mysql','MySQL'],['mssql','SQL Server'],['sqlite','SQLite']].map(([v,l]) => (
                <button key={v} onClick={() => set('dialect', v)}
                  style={{ padding: '6px 14px', borderRadius: 'var(--radius-pill)', border: `1.5px solid ${form.dialect === v ? 'var(--blue)' : 'var(--border2)'}`, background: form.dialect === v ? 'var(--blue-bg)' : 'var(--bg)', color: form.dialect === v ? 'var(--blue-t)' : 'var(--text2)', fontSize: 13, fontWeight: form.dialect === v ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit', transition: 'all .15s' }}>
                  {l}
                </button>
              ))}
            </div>
          </Field>

          <Grid cols={3}>
            <Field label="Host" required><input style={INP} placeholder="db.company.com" value={String(form.host)} onChange={e => set('host', e.target.value)} /></Field>
            <Field label="Port"><input style={INP} placeholder="5432" value={String(form.port)} onChange={e => set('port', e.target.value)} /></Field>
            <Field label="Database name"><input style={INP} placeholder="mydb" value={String(form.database_name)} onChange={e => set('database_name', e.target.value)} /></Field>
          </Grid>

          <Grid cols={3}>
            <Field label="Username"><input style={INP} placeholder="app_user" value={String(form.username)} onChange={e => set('username', e.target.value)} /></Field>
            <Field label="Password" hint="Stored encrypted"><input style={INP} type="password" placeholder="••••••••" value={String(form.password)} onChange={e => set('password', e.target.value)} /></Field>
            <Field label="Schema" hint="Default: public"><input style={INP} placeholder="public" value={String(form.schema_name)} onChange={e => set('schema_name', e.target.value)} /></Field>
          </Grid>

          <Field label="Or use full connection string" hint="Overrides fields above if provided">
            <input style={{ ...INP, fontFamily: 'var(--font-mono)', fontSize: 12 }} type="password" placeholder="postgresql://user:pass@host:5432/db?sslmode=require" value={String(form.connection_string)} onChange={e => set('connection_string', e.target.value)} />
          </Field>

          <Grid cols={2}>
            <Field label="SSL mode">
              <select style={SEL} value={String(form.ssl_mode)} onChange={e => set('ssl_mode', e.target.value)}>
                {['disable','allow','prefer','require','verify-ca','verify-full'].map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </Field>
            <Field label="Connection pool (min / max)">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <input style={INP} type="number" placeholder="1" value={String(form.pool_min)} onChange={e => set('pool_min', e.target.value)} />
                <input style={INP} type="number" placeholder="5" value={String(form.pool_max)} onChange={e => set('pool_max', e.target.value)} />
              </div>
            </Field>
          </Grid>

          {(form.ssl_mode === 'verify-ca' || form.ssl_mode === 'verify-full') && (
            <Field label="CA Certificate (PEM)" hint="Paste the contents of your CA cert. Required for cloud DBs like AWS RDS.">
              <textarea style={{ ...INP, resize: 'vertical', minHeight: 80, fontSize: 12, fontFamily: 'var(--font-mono)' }} placeholder="-----BEGIN CERTIFICATE-----" value={String(form.ssl_ca)} onChange={e => set('ssl_ca', e.target.value)} />
            </Field>
          )}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 16, borderTop: '1px solid var(--border)', marginTop: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', color: 'var(--text2)' }}>
              <input type="checkbox" checked={Boolean(form.read_only)} onChange={e => set('read_only', e.target.checked)} style={{ width: 15, height: 15, cursor: 'pointer' }} />
              Read-only mode (block INSERT / UPDATE / DELETE)
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn variant="primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save connection'}</Btn>
              <Btn onClick={() => { setShowForm(false); setEditing(null); setError('') }}>Cancel</Btn>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spinner size={24} /></div>
      ) : conns.length === 0 ? (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '48px 24px', textAlign: 'center', fontSize: 14, color: 'var(--text3)' }}>
          No database connections yet. Add one above to start querying from chat.
        </div>
      ) : (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
          {conns.map((c, i) => {
            const tr = results[c.id]
            return (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: i < conns.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <StatusDot status={tr ? (tr.ok ? 'healthy' : 'down') : 'unknown'} />
                <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 'var(--radius-sm)', background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text3)' }}>{c.dialect.toUpperCase()}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 2 }}>{c.label} <Badge label={c.environment} color={envColor(c.environment)} /></div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>{c.host}:{c.port}/{c.database_name} · SSL: {c.ssl_mode} · pool {c.pool_min}–{c.pool_max}{c.read_only ? ' · read-only' : ''}</div>
                  {tr && <div style={{ fontSize: 11, color: tr.ok ? 'var(--green-t)' : 'var(--red-t)', marginTop: 3 }}>{tr.ok ? `✓ Connected · ${tr.latencyMs}ms` : `✗ ${tr.message}`}</div>}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <Btn size="sm" onClick={() => test(c.id)} disabled={testing === c.id}>{testing === c.id ? <Spinner size={11} /> : 'Test'}</Btn>
                  {user.role === 'admin' && <Btn size="sm" onClick={() => { setForm({ ...EMPTY, ...c, port: String(c.port), pool_min: String(c.pool_min), pool_max: String(c.pool_max) }); setEditing(c.id); setShowForm(true) }}>Edit</Btn>}
                  {user.role === 'admin' && <Btn size="sm" variant="danger" onClick={() => del(c.id, c.label)}>Delete</Btn>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
