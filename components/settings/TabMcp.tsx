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
  managed?: number | boolean
  catalog_id?: string | null
  sidecar_name?: string | null
  created_at: string
}

interface CatalogField { key: string; label: string; secret?: boolean; required?: boolean; placeholder?: string; help?: string; group?: string }
interface CatalogEntry { id: string; name: string; blurb: string; transport: string; color?: string; authNote?: string; fields: CatalogField[] }

const EMPTY = { id: '', label: '', endpoint_url: '', transport: 'http', token: '', description: '', enabled: true }

// The managed (catalog-driven) form: the user fills descriptor fields; Mosaic provisions a sidecar.
interface CatForm { id: string; catalog_id: string; name: string; label: string; values: Record<string, string> }

export default function TabMcp({ user }: { user: SessionUser }) {
  const [conns, setConns] = useState<McpConn[] | null>(null)
  const [form, setForm] = useState<typeof EMPTY | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [testResult, setTestResult] = useState<{ ok: boolean; tools?: string[]; error?: string } | null>(null)

  // Managed-server state
  const [catalog, setCatalog] = useState<CatalogEntry[]>([])
  const [managerReady, setManagerReady] = useState(false)
  const [picking, setPicking] = useState(false)
  const [catForm, setCatForm] = useState<CatForm | null>(null)

  async function load() {
    const r = await fetch('/api/mcp-connections')
    const d = await r.json()
    setConns(Array.isArray(d.mcp_connections) ? d.mcp_connections : [])
  }
  async function loadCatalog() {
    try {
      const r = await fetch('/api/mcp-connections', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'catalog' }),
      })
      const d = await r.json()
      setCatalog(Array.isArray(d.catalog) ? d.catalog : [])
      setManagerReady(!!d.manager_ready)
    } catch { /* non-fatal; managed section just won't show entries */ }
  }
  useEffect(() => { load(); loadCatalog() }, [])

  function catEntry(id?: string | null) { return catalog.find(c => c.id === id) }

  function startAdd() { setForm({ ...EMPTY }); setTestResult(null); setMsg(null); setPicking(false); setCatForm(null) }
  function startEdit(c: McpConn) {
    setForm({ id: c.id, label: c.label, endpoint_url: c.endpoint_url, transport: c.transport, token: '', description: c.description || '', enabled: !!c.enabled })
    setTestResult(null); setMsg(null); setPicking(false); setCatForm(null)
  }
  function startPick() { setPicking(true); setForm(null); setCatForm(null); setTestResult(null); setMsg(null) }
  function pickEntry(e: CatalogEntry) {
    setCatForm({ id: '', catalog_id: e.id, name: e.name, label: e.name, values: {} })
    setPicking(false); setTestResult(null); setMsg(null)
  }
  function startEditManaged(c: McpConn) {
    const e = catEntry(c.catalog_id)
    setCatForm({ id: c.id, catalog_id: c.catalog_id || '', name: e?.name || c.label, label: c.label, values: {} })
    setForm(null); setPicking(false); setTestResult(null); setMsg(null)
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
        body: JSON.stringify({ action: 'test', endpoint_url: form.endpoint_url, token: form.token || undefined, transport: form.transport || 'http' }),
      })
      setTestResult(await r.json())
    } catch (e) { setTestResult({ ok: false, error: (e as Error).message }) }
    finally { setBusy(false) }
  }

  // Provision (or re-provision) a managed sidecar from the descriptor form.
  async function saveManaged() {
    if (!catForm) return
    const entry = catEntry(catForm.catalog_id)
    if (!entry) { setMsg({ ok: false, text: 'Unknown server type.' }); return }
    setBusy(true); setMsg(null); setTestResult(null)
    try {
      const action = catForm.id ? 'managed-update' : 'provision'
      const r = await fetch('/api/mcp-connections', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, id: catForm.id || undefined, catalog_id: catForm.catalog_id, label: catForm.label, values: catForm.values }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Provisioning failed')
      // Confirm the freshly started sidecar actually serves tools.
      if (d.endpoint_url) {
        try {
          const t = await fetch('/api/mcp-connections', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'test', endpoint_url: d.endpoint_url, transport: entry.transport }),
          })
          setTestResult(await t.json())
        } catch { /* test is best-effort confirmation */ }
      }
      setCatForm(null); await load()
      setMsg({ ok: true, text: catForm.id ? `${entry.name} updated and restarted.` : `${entry.name} provisioned and connected.` })
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }) }
    finally { setBusy(false) }
  }

  async function remove(c: McpConn) {
    if (!confirm(c.managed ? `Delete “${c.label}” and stop its server?` : 'Delete this MCP connection?')) return
    await fetch('/api/mcp-connections', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', id: c.id }),
    })
    await load()
  }

  const anyForm = !!form || !!catForm || picking

  return (
    <div>
      <PageTitle>MCP servers</PageTitle>
      <PageSub>Connect data sources exposed over the Model Context Protocol. Provision a server Mosaic manages for you, or point at an existing MCP endpoint.</PageSub>

      {msg && <Alert variant={msg.ok ? 'success' : 'error'}>{msg.text}</Alert>}

      {/* ── Catalog picker ─────────────────────────────────────── */}
      {picking && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 20, marginBottom: 20, boxShadow: 'var(--shadow)' }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, color: 'var(--text)' }}>Add a managed server</div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 16 }}>Mosaic starts and runs the server for you — just enter your credentials.</div>
          {!managerReady && (
            <div style={{ marginBottom: 14 }}>
              <Alert variant="info">Managed servers aren&apos;t enabled on this install. You can still add a custom MCP connection to an endpoint you run yourself.</Alert>
            </div>
          )}
          {catalog.length === 0 ? (
            <Alert variant="info">No managed server types are available.</Alert>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
              {catalog.map(e => (
                <button key={e.id} onClick={() => pickEntry(e)} disabled={!managerReady}
                  style={{ textAlign: 'left', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 14, cursor: managerReady ? 'pointer' : 'not-allowed', opacity: managerReady ? 1 : 0.6, color: 'var(--text)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ width: 10, height: 10, borderRadius: '50%', background: e.color || 'var(--accent)', display: 'inline-block' }} />
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{e.name}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.4 }}>{e.blurb}</div>
                </button>
              ))}
            </div>
          )}
          <div style={{ marginTop: 16 }}>
            <Btn onClick={() => setPicking(false)}>Cancel</Btn>
          </div>
        </div>
      )}

      {/* ── Managed (descriptor-driven) form ───────────────────── */}
      {catForm && (() => {
        const entry = catEntry(catForm.catalog_id)
        if (!entry) return null
        return (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 20, marginBottom: 20, boxShadow: 'var(--shadow)' }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, color: 'var(--text)' }}>{catForm.id ? `Edit ${entry.name}` : `Set up ${entry.name}`}</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 16 }}>{entry.blurb}</div>
            <Field label="Name">
              <input style={INP} value={catForm.label} onChange={e => setCatForm({ ...catForm, label: e.target.value })} placeholder={entry.name} />
            </Field>
            {entry.authNote && (
              <div style={{ fontSize: 12, color: 'var(--text3)', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '8px 10px', marginBottom: 14 }}>{entry.authNote}</div>
            )}
            {entry.fields.map(f => (
              <Field key={f.key} label={f.label + (f.required ? ' *' : '')}>
                <input style={INP} type={f.secret ? 'password' : 'text'}
                  value={catForm.values[f.key] || ''}
                  onChange={e => setCatForm({ ...catForm, values: { ...catForm.values, [f.key]: e.target.value } })}
                  placeholder={f.secret && catForm.id ? 'Leave blank to keep existing' : (f.placeholder || '')} />
                {f.help && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>{f.help}</div>}
              </Field>
            ))}

            {testResult && (
              <div style={{ marginTop: 8, marginBottom: 12 }}>
                {testResult.ok
                  ? <Alert variant="success">Connected — {testResult.tools?.length || 0} tool{testResult.tools?.length === 1 ? '' : 's'} available.</Alert>
                  : <Alert variant="error">Server started but the connection test failed: {testResult.error}</Alert>}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <Btn variant="primary" onClick={saveManaged} disabled={busy || !catForm.label}>{busy ? (catForm.id ? 'Updating…' : 'Provisioning…') : (catForm.id ? 'Update & restart' : 'Provision & connect')}</Btn>
              <Btn onClick={() => { setCatForm(null); setTestResult(null) }}>Cancel</Btn>
            </div>
          </div>
        )
      })()}

      {/* ── Custom (manual) form ───────────────────────────────── */}
      {form && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 20, marginBottom: 20, boxShadow: 'var(--shadow)' }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: 'var(--text)' }}>{form.id ? 'Edit MCP connection' : 'New custom MCP connection'}</div>
          <Field label="Name">
            <input style={INP} value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} placeholder="e.g. Plant historian MCP" />
          </Field>
          <Field label="Transport">
            <select style={INP} value={form.transport || 'http'} onChange={e => setForm({ ...form, transport: e.target.value })}>
              <option value="http">Streamable HTTP — one URL, modern servers (default)</option>
              <option value="sse">HTTP + SSE — GET /sse stream (Spring AI, ThingsBoard, legacy servers)</option>
              <option value="stdio">stdio — run the server as a local command</option>
            </select>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
              {form.transport === 'sse'
                ? 'Point at the server’s SSE URL (e.g. http://host:8000/sse). Mosaic reads the message endpoint from the stream.'
                : form.transport === 'stdio'
                ? 'A launcher command run on the Mosaic host (docker / npx / node / uvx / python). Mosaic speaks JSON-RPC over stdin/stdout.'
                : 'A single endpoint that accepts JSON-RPC over POST.'}
            </div>
          </Field>
          <Field label={form.transport === 'stdio' ? 'Launch command' : 'Endpoint URL'}>
            <input style={INP} value={form.endpoint_url} onChange={e => setForm({ ...form, endpoint_url: e.target.value })}
              placeholder={form.transport === 'stdio' ? 'docker run -i --rm -e THINGSBOARD_URL -e THINGSBOARD_API_KEY thingsboard/mcp' : form.transport === 'sse' ? 'http://host:8000/sse' : 'https://mcp.internal:8080/rpc'} />
          </Field>
          <Field label={form.transport === 'stdio' ? 'Bearer token (unused for stdio)' : 'Bearer token (optional)'}>
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
      )}

      {/* Entry actions */}
      {!anyForm && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
          <Btn variant="primary" onClick={startPick}>+ Add managed server</Btn>
          <Btn onClick={startAdd}>Add custom connection</Btn>
        </div>
      )}

      {/* List */}
      {conns === null ? (
        <div style={{ padding: 24, textAlign: 'center' }}><Spinner size={16} /></div>
      ) : conns.length === 0 ? (
        <Alert variant="info">No MCP connections yet. Add a managed server, or connect a custom endpoint.</Alert>
      ) : (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', boxShadow: 'var(--shadow)' }}>
          {conns.map((c, i) => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', borderTop: i > 0 ? '1px solid var(--border)' : 'none' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>{c.label}</span>
                  {c.managed ? <Badge label="managed" /> : null}
                  {!c.enabled && <Badge label="disabled" />}
                  {c.has_token ? <Badge label="auth" /> : null}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.managed ? (c.description || catEntry(c.catalog_id)?.blurb || 'Managed server') : `${c.endpoint_url}${c.description ? ` · ${c.description}` : ''}`}</div>
              </div>
              <Btn onClick={() => c.managed ? startEditManaged(c) : startEdit(c)}>Edit</Btn>
              <Btn onClick={() => remove(c)}>Delete</Btn>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
