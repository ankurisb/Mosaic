'use client'
import { useState, useEffect } from 'react'
import type { SessionUser } from '@/lib/auth'
import { PageTitle, PageSub, INP, SEL, Btn, Field, Alert } from './ui'

interface PrismInstance {
  id: string; label: string; base_url: string
  environment: string; username: string; active: number; created_at: string
}

const EMPTY = { label: '', base_url: '', environment: 'production', username: '', password: '' }

export default function TabPrism({ user }: { user: SessionUser }) {
  const [instances, setInstances] = useState<PrismInstance[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ ...EMPTY })

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const r = await fetch('/api/prism-instances')
      const d = await r.json()
      setInstances(d.instances || [])
    } catch { setError('Failed to load Prism instances') }
    finally { setLoading(false) }
  }

  function openAdd() {
    setEditId(null); setForm({ ...EMPTY }); setTestResult(null); setError(''); setSuccess(''); setShowForm(true)
  }
  function openEdit(inst: PrismInstance) {
    setEditId(inst.id)
    setForm({ label: inst.label, base_url: inst.base_url, environment: inst.environment, username: inst.username, password: '' })
    setTestResult(null); setError(''); setSuccess(''); setShowForm(true)
  }
  function cancel() { setShowForm(false); setEditId(null); setForm({ ...EMPTY }); setTestResult(null); setError('') }
  function set(k: keyof typeof EMPTY) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(f => ({ ...f, [k]: e.target.value }))
  }

  async function test() {
    if (!form.base_url || !form.username || (!form.password && !editId)) { setError('URL, username and password required to test'); return }
    setTesting(true); setTestResult(null)
    try {
      const r = await fetch('/api/prism-instances/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base_url: form.base_url, username: form.username, password: form.password, instance_id: editId || undefined }),
      })
      const d = await r.json()
      setTestResult({ ok: d.ok, message: d.message || (d.ok ? 'Connected successfully' : 'Connection failed') })
    } catch { setTestResult({ ok: false, message: 'Network error' }) }
    finally { setTesting(false) }
  }

  async function save() {
    if (!form.label.trim()) { setError('Label is required'); return }
    if (!form.base_url.trim()) { setError('URL is required'); return }
    if (!form.username.trim()) { setError('Username is required'); return }
    if (!editId && !form.password.trim()) { setError('Password is required'); return }
    setSaving(true); setError('')
    try {
      const body: Record<string, string> = {
        label: form.label.trim(), base_url: form.base_url.trim().replace(/\/$/, ''),
        environment: form.environment, username: form.username.trim(),
      }
      if (form.password) body.password = form.password
      if (editId) body.id = editId
      const r = await fetch('/api/prism-instances', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const d = await r.json()
      if (!r.ok || d.error) { setError(d.error || 'Save failed'); return }
      setSuccess(editId ? 'Instance updated' : 'Prism instance connected')
      setShowForm(false); setEditId(null); load()
    } catch { setError('Network error') }
    finally { setSaving(false) }
  }

  async function remove(id: string, label: string) {
    if (!confirm(`Remove "${label}"?`)) return
    try {
      await fetch('/api/prism-instances', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
      load()
    } catch { setError('Delete failed') }
  }

  const ENV_COLOR: Record<string, string> = { production: 'var(--red)', staging: 'var(--amber)', development: 'var(--green)' }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <PageTitle>Prism</PageTitle>
          <PageSub>Connect to your Prism IoT intelligence platform to query devices, assets, and real-time telemetry in chat.</PageSub>
        </div>
        {!showForm && <Btn onClick={openAdd} style={{ flexShrink: 0, marginTop: 4 }}>+ Add instance</Btn>}
      </div>

      {error && <Alert variant="error">{error}</Alert>}
      {success && !showForm && <Alert variant="success">{success}</Alert>}

      {showForm && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '20px 24px', marginBottom: 24 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 20 }}>
            {editId ? 'Edit Prism instance' : 'Connect Prism instance'}
          </div>

          {/* URL — full width, shown first as it's the most important field */}
          <Field label="Platform URL" hint="Base URL of your Prism instance">
            <input style={INP} value={form.base_url} onChange={set('base_url')} placeholder="https://platform.example.com" />
          </Field>

          {/* Username + Password */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
            <Field label="Username" hint="Email or username">
              <input style={INP} value={form.username} onChange={set('username')} placeholder="user@example.com" />
            </Field>
            <Field label="Password" hint={editId ? 'Leave blank to keep existing' : ''}>
              <input style={INP} type="password" value={form.password} onChange={set('password')} placeholder={editId ? '(unchanged)' : '••••••••'} />
            </Field>
          </div>

          {/* Label + Environment — secondary fields */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
            <Field label="Display name" hint="Label shown in Mosaic settings and chat">
              <input style={INP} value={form.label} onChange={set('label')} placeholder="e.g. UGX Production" />
            </Field>
            <Field label="Environment">
              <select style={SEL} value={form.environment} onChange={set('environment')}>
                <option value="production">Production</option>
                <option value="staging">Staging</option>
                <option value="development">Development</option>
              </select>
            </Field>
          </div>

          {testResult && (
            <div style={{ marginTop: 14 }}>
              <Alert variant={testResult.ok ? 'success' : 'error'}>{testResult.message}</Alert>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
            <Btn onClick={save} disabled={saving}>{saving ? 'Saving…' : editId ? 'Save changes' : 'Connect'}</Btn>
            <Btn variant="ghost" onClick={test} disabled={testing}>{testing ? 'Testing…' : 'Test connection'}</Btn>
            <Btn variant="ghost" onClick={cancel}>Cancel</Btn>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>Loading…</div>
      ) : instances.length === 0 && !showForm ? (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '40px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 4 }}>No Prism instances connected</div>
          <div style={{ fontSize: 12, color: 'var(--text4)' }}>Add an instance to query IoT devices, assets, and telemetry in chat.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {instances.map(inst => (
            <div key={inst.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: inst.active ? 'var(--green)' : 'var(--text4)', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>{inst.label}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <span>{inst.base_url}</span>
                  <span>·</span>
                  <span>{inst.username}</span>
                  <span>·</span>
                  <span style={{ color: ENV_COLOR[inst.environment] ?? 'var(--text3)', fontWeight: 500 }}>{inst.environment}</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <Btn size="sm" variant="ghost" onClick={() => openEdit(inst)}>Edit</Btn>
                <Btn size="sm" variant="ghost" onClick={() => remove(inst.id, inst.label)} style={{ color: 'var(--red)' }}>Remove</Btn>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
