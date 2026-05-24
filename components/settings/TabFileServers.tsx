'use client'
import { useState, useEffect } from 'react'
import type { SessionUser } from '@/lib/auth'
import { PageTitle, PageSub, INP, SEL, Btn, Badge, StatusDot, Field, Grid, Alert, Spinner } from './ui'
import { safeJson } from '@/lib/fetch'

interface FileServer {
  id: string; label: string; transport: string; environment: string
  host: string; port: number; share_path: string; sub_path: string
  username: string; bucket: string; endpoint_url: string; access_key_id: string
  tenant_id: string; client_id: string
  file_types: string; poll_interval_sec: number; max_files: number; max_rows: number
  filename_date_pattern: string; ts_strategy: string
}

const TRANSPORTS = ['smb','sftp','local','s3','sharepoint']
const TS_STRATS  = ['auto','filename','modified','content']
const ENV_COLOR  = (e: string): 'red'|'amber'|'green' => e === 'production' ? 'red' : e === 'staging' ? 'amber' : 'green'

const EMPTY = {
  label: '', transport: 'smb', environment: 'production',
  host: '', port: '', share_path: '', sub_path: '', username: '', password: '', ssh_key: '',
  bucket: '', endpoint_url: '', access_key_id: '', secret_key: '',
  tenant_id: '', client_id: '',
  file_types: 'csv,xlsx,pdf', poll_interval_sec: '60', max_files: '20', max_rows: '500',
  filename_date_pattern: '', ts_strategy: 'auto',
}

export default function TabFileServers({ user }: { user: SessionUser }) {
  const [servers, setServers] = useState<FileServer[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [testing, setTesting] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, { ok: boolean; message?: string; latencyMs?: number }>>({})
  const [fsSearch, setFsSearch] = useState('')
  const [fsPage, setFsPage] = useState(1)

  async function load() {
    setLoading(true)
    try {
      const r = await fetch('/api/file-servers')
      if (r.ok) setServers((await r.json()).file_servers || [])
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  function f(k: keyof typeof EMPTY, v: string) { setForm(p => ({ ...p, [k]: v })) }

  async function save() {
    if (!form.label.trim()) { setError('Label is required'); return }
    if (!form.transport) { setError('Transport is required'); return }
    setSaving(true); setError('')
    try {
      const r = await fetch('/api/file-servers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: editing ? 'update' : 'create', id: editing, ...form }),
      })
      const { error: err } = await safeJson(r)
      if (err) { setError(err); return }
      setShowForm(false); setEditing(null); setForm(EMPTY); await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed') }
    finally { setSaving(false) }
  }

  async function del(id: string, label: string) {
    if (!confirm(`Delete "${label}"?`)) return
    await fetch('/api/file-servers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', id }) })
    await load()
  }

  async function test(id: string) {
    setTesting(id)
    try {
      const r = await fetch('/api/file-servers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'test', id }) })
      const { data: d, error: err } = await safeJson<{ ok: boolean; message?: string; latencyMs?: number }>(r)
      setResults(p => ({ ...p, [id]: err ? { ok: false, message: err } : (d as { ok: boolean; message?: string; latencyMs?: number }) }))
    } catch { setResults(p => ({ ...p, [id]: { ok: false, message: 'Connection check failed — server unreachable' } })) }
    finally { setTesting(null) }
  }

  function startEdit(s: FileServer) {
    setForm({ ...EMPTY, ...s, port: String(s.port || ''), poll_interval_sec: String(s.poll_interval_sec), max_files: String(s.max_files), max_rows: String(s.max_rows), password: '', ssh_key: '', secret_key: '' })
    setEditing(s.id); setShowForm(true); setError('')
  }

  const t = form.transport
  const FS_PAGE_SIZE = 10
  const fsFiltered = servers.filter(s => !fsSearch || s.label?.toLowerCase().includes(fsSearch.toLowerCase()) || s.transport?.toLowerCase().includes(fsSearch.toLowerCase()))
  const fsTotalPages = Math.ceil(fsFiltered.length / FS_PAGE_SIZE) || 1
  const fsPaged = fsFiltered.slice((fsPage - 1) * FS_PAGE_SIZE, fsPage * FS_PAGE_SIZE)

  return (
    <div className="fade-in">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <PageTitle>File servers</PageTitle>
        {user.role === 'admin' && <Btn variant="primary" onClick={() => { setShowForm(!showForm); setEditing(null); setForm(EMPTY); setError('') }}>+ Add file server</Btn>}
      </div>
      <PageSub>Connect SMB shares, SFTP, S3 buckets, or local paths. Mosaic can read CSV, Excel, PDF, XML, and JSON files.</PageSub>


      {error && <Alert variant="error">{error}</Alert>}

      {showForm && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 20, marginTop: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 16 }}>{editing ? 'Edit file server' : 'Add file server'}</div>
          <Grid cols={2}>
            <Field label="Label *"><input style={INP} type="text" value={form.label} onChange={e => f('label', e.target.value)} placeholder="Plant A SMB Share" /></Field>
            <Field label="Transport">
              <select style={SEL} value={form.transport} onChange={e => f('transport', e.target.value)}>{TRANSPORTS.map(t => ({ value: t, label: t.toUpperCase() })).map((o: {value:string;label:string}) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
            </Field>
            <Field label="Environment">
              <select style={SEL} value={form.environment} onChange={e => f('environment', e.target.value)}>{['production','staging','development'].map(e => ({ value: e, label: e })).map((o: {value:string;label:string}) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
            </Field>
          </Grid>

          {(t === 'smb' || t === 'sftp') && (
            <Grid cols={2}>
              <Field label="Host"><input style={INP} type="text" value={form.host} onChange={e => f('host', e.target.value)} placeholder="192.168.1.100" /></Field>
              <Field label="Port"><input style={INP} type="text" value={form.port} onChange={e => f('port', e.target.value)} placeholder={t === 'smb' ? '445' : '22'} /></Field>
              {t === 'smb' && <Field label="Share path"><input style={INP} type="text" value={form.share_path} onChange={e => f('share_path', e.target.value)} placeholder="\\share\\reports" /></Field>}
              {t === 'sftp' && <Field label="Remote path"><input style={INP} type="text" value={form.share_path} onChange={e => f('share_path', e.target.value)} placeholder="/home/reports" /></Field>}
              <Field label="Username"><input style={INP} type="text" value={form.username} onChange={e => f('username', e.target.value)} placeholder="domain\\user" /></Field>
              <Field label={t === 'sftp' ? 'Password or leave blank' : 'Password'}><input style={INP} type="password" value={form.password} onChange={e => f('password', e.target.value)} placeholder={editing ? '(unchanged)' : 'password'} /></Field>
              {t === 'sftp' && <Field label="SSH private key (optional)"><input style={INP} type="text" value={form.ssh_key} onChange={e => f('ssh_key', e.target.value)} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" /></Field>}
            </Grid>
          )}

          {t === 'local' && (
            <Grid cols={2}>
              <Field label="Directory path"><input style={INP} type="text" value={form.share_path} onChange={e => f('share_path', e.target.value)} placeholder="/data/reports or C:\Reports" /></Field>
            </Grid>
          )}

          {t === 's3' && (
            <Grid cols={2}>
              <Field label="Bucket"><input style={INP} type="text" value={form.bucket} onChange={e => f('bucket', e.target.value)} placeholder="my-reports-bucket" /></Field>
              <Field label="Prefix (optional)"><input style={INP} type="text" value={form.sub_path} onChange={e => f('sub_path', e.target.value)} placeholder="plant-a/oee/" /></Field>
              <Field label="Endpoint URL (optional)"><input style={INP} type="text" value={form.endpoint_url} onChange={e => f('endpoint_url', e.target.value)} placeholder="https://s3.eu-west-1.amazonaws.com" /></Field>
              <Field label="Access key ID"><input style={INP} type="text" value={form.access_key_id} onChange={e => f('access_key_id', e.target.value)} placeholder="AKIA..." /></Field>
              <Field label="Secret key"><input style={INP} type="password" value={form.secret_key} onChange={e => f('secret_key', e.target.value)} placeholder={editing ? '(unchanged)' : 'secret'} /></Field>
            </Grid>
          )}
          {form.transport === 'sharepoint' && (
            <Grid cols={2}>
              <Field label="SharePoint site URL" hint="e.g. https://yourcompany.sharepoint.com/sites/Engineering">
                <input style={INP} type="url" value={form.endpoint_url} onChange={e => f('endpoint_url', e.target.value)} placeholder="https://yourcompany.sharepoint.com/sites/Engineering" />
              </Field>
              <Field label="Document library folder" hint="Leave blank for root Documents, or enter a path e.g. Reports/2026">
                <input style={INP} type="text" value={form.sub_path} onChange={e => f('sub_path', e.target.value)} placeholder="Reports/2026" />
              </Field>
              <Field label="Tenant ID" hint="Azure AD Directory ID — Azure Portal → App registrations">
                <input style={INP} type="text" value={form.tenant_id || ''} onChange={e => f('tenant_id', e.target.value)} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
              </Field>
              <Field label="Client ID (App ID)" hint="Application ID from Azure App Registration">
                <input style={INP} type="text" value={form.client_id || ''} onChange={e => f('client_id', e.target.value)} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
              </Field>
              <Field label="Client secret" hint="Client secret value — Certificates &amp; secrets">
                <input style={INP} type="password" value={form.password} onChange={e => f('password', e.target.value)} placeholder={editing ? '(unchanged)' : 'client secret value'} />
              </Field>
            </Grid>
          )}

          <div style={{ height: 1, background: 'var(--border)', margin: '16px 0' }} />
          <Grid cols={2}>
            <Field label="File types" hint="Comma-separated: csv, xlsx, pdf, xml, json"><input style={INP} type="text" value={form.file_types} onChange={e => f('file_types', e.target.value)} placeholder="csv,xlsx,pdf" /></Field>
            <Field label="Max rows per file"><input style={INP} type="text" value={form.max_rows} onChange={e => f('max_rows', e.target.value)} placeholder="500" /></Field>
            <Field label="Timestamp strategy" hint="How to determine file recency">
              <select style={SEL} value={form.ts_strategy} onChange={e => f('ts_strategy', e.target.value)}>{TS_STRATS.map(s => ({ value: s, label: s })).map((o: {value:string;label:string}) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
            </Field>
            <Field label="Sub-path filter (optional)" hint="Only look in this subfolder"><input style={INP} type="text" value={form.sub_path} onChange={e => f('sub_path', e.target.value)} placeholder="weekly-reports/" /></Field>
          </Grid>

          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <Btn variant="primary" onClick={save} disabled={saving}>{saving ? <Spinner size={13} /> : (editing ? 'Save changes' : 'Add server')}</Btn>
            <Btn variant="ghost" onClick={() => { setShowForm(false); setEditing(null); setForm(EMPTY); setError('') }}>Cancel</Btn>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ padding: 24, textAlign: 'center' }}><Spinner size={18} /></div>
      ) : servers.length === 0 ? (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '48px 24px', textAlign: 'center', fontSize: 14, color: 'var(--text3)' }}>
          No file servers configured. Add one above to let Mosaic read files from your network shares, SFTP servers, or S3 buckets.
        </div>
      ) : (
        <>
          <input style={{ width: '100%', padding: '8px 12px', marginBottom: 10, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
            placeholder="Search file servers..." value={fsSearch} onChange={e => { setFsSearch(e.target.value); setFsPage(1) }} />
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
            {fsPaged.map((s, i) => {
            const tr = results[s.id]
            return (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: i < servers.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <StatusDot status={tr ? (tr.ok ? 'healthy' : 'down') : 'unknown'} />
                <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 'var(--radius-sm)', background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text3)' }}>{s.transport.toUpperCase()}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 2 }}>
                    {s.label} <Badge label={s.environment} color={ENV_COLOR(s.environment)} />
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                    {s.transport === 's3' ? (s.endpoint_url ? `${s.endpoint_url}/${s.bucket || ''}` : (s.bucket || '—')) : s.transport === 'sharepoint' ? (s.endpoint_url || '—') : s.host ? `${s.host}${s.share_path ? '/' + s.share_path : ''}` : (s.share_path || '—')} · {s.file_types}
                  </div>
                  {tr && <div style={{ fontSize: 11, color: tr.ok ? 'var(--green-t)' : 'var(--red-t)', marginTop: 3 }}>{tr.ok ? (tr.latencyMs != null ? `✓ Connected · ${tr.latencyMs}ms` : '✓ Connected') : `✗ ${tr.message}`}</div>}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <Btn size="sm" onClick={() => test(s.id)} disabled={testing === s.id}>{testing === s.id ? <Spinner size={11} /> : 'Test'}</Btn>
                  {user.role === 'admin' && <Btn size="sm" onClick={() => startEdit(s)}>Edit</Btn>}
                  {user.role === 'admin' && <Btn size="sm" variant="danger" onClick={() => del(s.id, s.label)}>Delete</Btn>}
                </div>
              </div>
            )
            })}
          </div>
          {(
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 0 4px' }}>
              <button onClick={() => setFsPage(p => Math.max(1, p - 1))} disabled={fsPage === 1} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', cursor: fsPage === 1 ? 'not-allowed' : 'pointer', color: 'var(--text3)', fontSize: 12 }}>←</button>
              <span style={{ fontSize: 12, color: 'var(--text3)' }}>Page {fsPage} of {fsTotalPages}</span>
              <button onClick={() => setFsPage(p => Math.min(fsTotalPages, p + 1))} disabled={fsPage === fsTotalPages} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', cursor: fsPage === fsTotalPages ? 'not-allowed' : 'pointer', color: 'var(--text3)', fontSize: 12 }}>→</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
