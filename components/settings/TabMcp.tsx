import { useState, useEffect } from 'react'
import type { SessionUser } from '@/lib/auth'
import { PageTitle, PageSub, INP, Btn, Badge, Field, Alert, Spinner } from './ui'

interface McpConn {
  id: string
  label: string
  endpoint_url: string
  transport: string
  description: string | null
  enabled: number | boolean
  has_token: number | boolean
  created_at: string
}

const EMPTY = { id: '', label: '', endpoint_url: '', transport: 'http', token: '', description: '', enabled: true }

export default function TabMcp({ user }: { user: SessionUser }) {
  const [conns, setConns] = useState<McpConn[] | null>(null)
  const [form, setForm] = useState<typeof EMPTY | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [testResult, setTestResult] = useState<{ ok: boolean; tools?: string[]; error?: string } | null>(null)

  async function load() {
    const r = await fetch('/api/mcp-connections')
    const d = await r.json()
    setConns(Array.isArray(d.mcp_connections) ? d.mcp_connections : [])
  }
  useEffect(() => { load() }, [])

  function startAdd() { setForm({ ...EMPTY }); setTestResult(null); setMsg(null) }
  function startEdit(c: McpConn) {
    setForm({ id: c.id, label: c.label, endpoint_url: c.endpoint_url, transport: c.transport, token: '', description: c.description || '', enabled: !!c.enabled })
    setTestResult(null); setMsg(null)
  }

  async function save() {
    if (!form) return
    setBusy(true); setMsg(null)
    try {
      const action = form.id ? 'update' : 'create'
      const r = await fetch('/api/mcp-connections', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...form }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Save failed')
      setForm(null); await load()
      setMsg({ ok: true, text: action === 'create' ? 'MCP connection added.' : 'Saved.' })
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }) }
    finally { setBusy(false) }
  }

  async function test() {
    if (!form) return
    setBusy(true); setTestResult(null)
    try {
      const r = await fetch('/api/mcp-connections', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test', endpoint_url: form.endpoint_url, token: form.token || undefined }),
      })
      setTestResult(await r.json())
    } catch (e) { setTestResult({ ok: false, error: (e as Error).message }) }
    finally { setBusy(false) }
  }

  async function remove(id: string) {
    if (!confirm('Delete this MCP connection?')) return
    await fetch('/api/mcp-connections', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', id }),
    })
    await load()
  }

  return (
    <div>
      <PageTitle>MCP servers</PageTitle>
      <PageSub>Connect data sources exposed over the Model Context Protocol. Use for bespoke or custom integrations that don&apos;t fit the database, API, or file-server types.</PageSub>

      {msg && <Alert variant={msg.ok ? 'success' : 'error'}>{msg.text}</Alert>}

      {/* Add / edit form */}
      {form ? (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 20, marginBottom: 20, boxShadow: 'var(--shadow)' }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: 'var(--text)' }}>{form.id ? 'Edit MCP connection' : 'New MCP connection'}</div>
          <Field label="Name">
            <input style={INP} value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} placeholder="e.g. Plant historian MCP" />
          </Field>
          <Field label="Endpoint URL">
            <input style={INP} value={form.endpoint_url} onChange={e => setForm({ ...form, endpoint_url: e.target.value })} placeholder="https://mcp.internal:8080/rpc" />
          </Field>
          <Field label="Bearer token (optional)">
            <input style={INP} type="password" value={form.token} onChange={e => setForm({ ...form, token: e.target.value })} placeholder={form.id ? 'Leave blank to keep existing' : 'Optional auth token'} />
          </Field>
          <Field label="Description (optional)">
            <input style={INP} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="What this server exposes" />
          </Field>

          {testResult && (
            <div style={{ marginTop: 8, marginBottom: 12 }}>
              {testResult.ok
                ? <Alert variant="success">Reachable — {testResult.tools?.length || 0} tool{testResult.tools?.length === 1 ? '' : 's'}{testResult.tools?.length ? `: ${testResult.tools.slice(0, 8).join(', ')}${testResult.tools.length > 8 ? '…' : ''}` : ''}</Alert>
                : <Alert variant="error">Test failed: {testResult.error}</Alert>}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <Btn variant="primary" onClick={save} disabled={busy || !form.label || !form.endpoint_url}>{busy ? 'Saving…' : (form.id ? 'Save' : 'Add')}</Btn>
            <Btn onClick={test} disabled={busy || !form.endpoint_url}>Test connection</Btn>
            <Btn onClick={() => { setForm(null); setTestResult(null) }}>Cancel</Btn>
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: 16 }}>
          <Btn variant="primary" onClick={startAdd}>+ Add MCP connection</Btn>
        </div>
      )}

      {/* List */}
      {conns === null ? (
        <div style={{ padding: 24, textAlign: 'center' }}><Spinner size={16} /></div>
      ) : conns.length === 0 ? (
        <Alert variant="info">No MCP connections yet. Add one to connect a Model Context Protocol data source.</Alert>
      ) : (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', boxShadow: 'var(--shadow)' }}>
          {conns.map((c, i) => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', borderTop: i > 0 ? '1px solid var(--border)' : 'none' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>{c.label}</span>
                  {!c.enabled && <Badge label="disabled" />}
                  {c.has_token ? <Badge label="auth" /> : null}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.endpoint_url}{c.description ? ` · ${c.description}` : ''}</div>
              </div>
              <Btn onClick={() => startEdit(c)}>Edit</Btn>
              <Btn onClick={() => remove(c.id)}>Delete</Btn>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
