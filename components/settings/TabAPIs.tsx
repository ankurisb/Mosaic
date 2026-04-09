'use client'
import { useState, useEffect, useRef } from 'react'
import type { SessionUser } from '@/lib/auth'
import { PageTitle, PageSub, INP, SEL, Btn, Badge, Field, Grid, Alert, Spinner } from './ui'

interface ApiService { id: string; label: string; base_url: string; environment: string; auth_type: string; rate_limit_rpm: number; request_timeout_ms: number; retry_count: number }
interface ApiConn { id: string; service_id: string; label: string; description: string; base_path: string; pagination_style: string }

interface PostmanCollection {
  info: { name: string }
  item: Array<{
    name: string
    request: {
      method: string
      url: { raw: string; path?: string[] }
      auth?: { type: string; bearer?: Array<{ key: string; value: string }> }
      header?: Array<{ key: string; value: string }>
    }
  }>
}

interface ImportPreview {
  serviceName: string
  baseUrl: string
  authType: string
  token: string
  connections: Array<{ name: string; path: string; method: string }>
}

const SVC_EMPTY = { label: '', base_url: '', environment: 'production', auth_type: 'bearer', token: '', header_name: '', header_value: '', username: '', password: '', client_id: '', client_secret: '', token_url: '', custom_headers: '', api_version: '', version_header: '', rate_limit_rpm: '', request_timeout_ms: '30000', retry_count: '3' }
const CONN_EMPTY = { label: '', description: '', base_path: '', pagination_style: 'none', pagination_limit_param: 'limit', pagination_cursor_param: 'cursor', pagination_data_path: '' }

const PRESETS = [
  { label: 'HubSpot', base_url: 'https://api.hubapi.com', auth_type: 'oauth2_client', color: '#ff7a59', icon: 'H' },
  { label: 'Stripe', base_url: 'https://api.stripe.com', auth_type: 'bearer', color: '#635bff', icon: 'S' },
  { label: 'Salesforce', base_url: 'https://login.salesforce.com', auth_type: 'oauth2_client', color: '#0176d3', icon: 'SF' },
  { label: 'Slack', base_url: 'https://slack.com/api', auth_type: 'bearer', color: '#4a154b', icon: 'Sl' },
  { label: 'GitHub', base_url: 'https://api.github.com', auth_type: 'bearer', color: '#24292e', icon: 'GH' },
  { label: 'Notion', base_url: 'https://api.notion.com', auth_type: 'bearer', color: '#000', icon: 'N' },
  { label: 'Jira', base_url: 'https://yourorg.atlassian.net', auth_type: 'basic', color: '#0052cc', icon: 'J' },
  { label: 'Custom', base_url: '', auth_type: 'bearer', color: '#6b7280', icon: '+' },
]

function extractBaseUrl(rawUrl: string): { baseUrl: string; path: string } {
  try {
    const u = new URL(rawUrl.split('?')[0])
    const parts = u.pathname.split('/').filter(Boolean)
    // Heuristic: base URL = protocol + host + first path segment (e.g. /api)
    const base = parts.length > 0 ? `${u.protocol}//${u.host}/${parts[0]}` : `${u.protocol}//${u.host}`
    const path = '/' + parts.slice(1).join('/')
    return { baseUrl: base, path }
  } catch {
    return { baseUrl: rawUrl, path: '' }
  }
}

function parsePostmanCollection(json: PostmanCollection): ImportPreview | null {
  try {
    const items = json.item?.filter(i => i.request?.url?.raw) ?? []
    if (!items.length) return null

    // Derive base URL from first item
    const firstUrl = items[0].request.url.raw
    const { baseUrl } = extractBaseUrl(firstUrl)

    // Detect auth from first item that has bearer auth
    let authType = 'bearer'
    let token = ''
    for (const item of items) {
      const auth = item.request.auth
      if (auth?.type === 'bearer' && auth.bearer?.[0]?.value) {
        authType = 'bearer'
        token = auth.bearer[0].value
        break
      }
    }

    const connections = items.map(item => {
      const { path } = extractBaseUrl(item.request.url.raw)
      return {
        name: item.name,
        path: path || '/',
        method: item.request.method || 'GET',
      }
    })

    return {
      serviceName: json.info?.name ?? 'Imported Service',
      baseUrl,
      authType,
      token,
      connections,
    }
  } catch {
    return null
  }
}

export default function TabAPIs({ user }: { user: SessionUser }) {
  const [services, setServices] = useState<ApiService[]>([])
  const [connections, setConnections] = useState<ApiConn[]>([])
  const [loading, setLoading] = useState(true)
  const [showSvcForm, setShowSvcForm] = useState(false)
  const [svcForm, setSvcForm] = useState<Record<string, string>>(SVC_EMPTY)
  const [editingSvc, setEditingSvc] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [showConnForm, setShowConnForm] = useState<string | null>(null)
  const [connForm, setConnForm] = useState<Record<string, string>>(CONN_EMPTY)
  const [editingConn, setEditingConn] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Postman import state
  const fileRef = useRef<HTMLInputElement>(null)
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null)
  const [importError, setImportError] = useState('')
  const [importing, setImporting] = useState(false)
  const [importDragOver, setImportDragOver] = useState(false)

  async function load() { setLoading(true); const r = await fetch('/api/services'); if (r.ok) { const d = await r.json(); setServices(d.services); setConnections(d.connections) }; setLoading(false) }
  useEffect(() => { load() }, [])

  const setSvc = (k: string, v: string) => setSvcForm(p => ({ ...p, [k]: v }))
  const setConn = (k: string, v: string) => setConnForm(p => ({ ...p, [k]: v }))

  function buildAuth() {
    const t = svcForm.auth_type
    if (t === 'bearer') return { token: svcForm.token }
    if (t === 'api_key_header') return { header: svcForm.header_name, key: svcForm.header_value }
    if (t === 'basic') return { username: svcForm.username, password: svcForm.password }
    if (t === 'oauth2_client') return { client_id: svcForm.client_id, client_secret: svcForm.client_secret, token_url: svcForm.token_url }
    try { return JSON.parse(svcForm.custom_headers || '{}') } catch { return {} }
  }

  async function saveSvc() {
    if (!svcForm.label || !svcForm.base_url) { setError('Label and base URL are required'); return }
    setSaving(true)
    const r = await fetch('/api/services', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: editingSvc ? 'updateService' : 'createService', id: editingSvc, ...svcForm, auth_config: buildAuth() }) })
    const d = await r.json()
    if (!r.ok) { setError(d.error); setSaving(false); return }
    setSaving(false); setShowSvcForm(false); setEditingSvc(null); setSvcForm(SVC_EMPTY); setError(''); load()
  }

  async function saveConn(serviceId: string) {
    if (!connForm.label) { setError('Label is required'); return }
    setSaving(true)
    const r = await fetch('/api/services', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: editingConn ? 'updateConnection' : 'createConnection', id: editingConn, service_id: serviceId, ...connForm }) })
    const d = await r.json()
    if (!r.ok) { setError(d.error); setSaving(false); return }
    setSaving(false); setShowConnForm(null); setEditingConn(null); setConnForm(CONN_EMPTY); setError(''); load()
  }

  async function delSvc(id: string, label: string) {
    if (!confirm(`Delete service "${label}" and all its connections?`)) return
    await fetch('/api/services', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'deleteService', id }) }); load()
  }

  async function delConn(id: string, label: string) {
    if (!confirm(`Delete "${label}"?`)) return
    await fetch('/api/services', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'deleteConnection', id }) }); load()
  }

  function handlePostmanFile(file: File) {
    setImportError('')
    setImportPreview(null)
    const reader = new FileReader()
    reader.onload = e => {
      try {
        const json = JSON.parse(e.target?.result as string) as PostmanCollection
        const preview = parsePostmanCollection(json)
        if (!preview) { setImportError('Could not parse collection — make sure it is a valid Postman v2.1 collection.'); return }
        setImportPreview(preview)
      } catch {
        setImportError('Invalid JSON file.')
      }
    }
    reader.readAsText(file)
  }

  function onFileDrop(e: React.DragEvent) {
    e.preventDefault(); setImportDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handlePostmanFile(file)
  }

  async function confirmImport() {
    if (!importPreview) return
    setImporting(true)
    try {
      // 1. Create the service
      const svcRes = await fetch('/api/services', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'createService',
          label: importPreview.serviceName,
          base_url: importPreview.baseUrl,
          environment: 'production',
          auth_type: importPreview.authType,
          auth_config: { token: importPreview.token },
          request_timeout_ms: 30000,
          retry_count: 3,
        }),
      })
      const svcData = await svcRes.json()
      if (!svcRes.ok) throw new Error(svcData.error)
      const serviceId = svcData.id

      // 2. Create each connection
      for (const conn of importPreview.connections) {
        await fetch('/api/services', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'createConnection',
            service_id: serviceId,
            label: conn.name,
            description: `${conn.method} ${conn.path}`,
            base_path: conn.path,
            pagination_style: 'none',
          }),
        })
      }

      setImportPreview(null)
      setExpanded(prev => new Set([...prev, serviceId]))
      load()
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'Import failed')
    }
    setImporting(false)
  }

  const toggle = (id: string) => setExpanded(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  const envColor = (e: string): 'red'|'amber'|'green' => e === 'production' ? 'red' : e === 'sandbox' ? 'amber' : 'green'
  const preset = (label: string) => PRESETS.find(p => p.label === label)

  const authFields: Record<string, React.ReactNode> = {
    bearer: <Field label="Bearer token" hint="Sent as: Authorization: Bearer <token>"><input style={{ ...INP, fontFamily: 'var(--font-mono)', fontSize: 12 }} type="password" placeholder="Token or API key" value={svcForm.token} onChange={e => setSvc('token', e.target.value)} /></Field>,
    api_key_header: <Grid cols={2}><Field label="Header name"><input style={INP} placeholder="X-API-Key" value={svcForm.header_name} onChange={e => setSvc('header_name', e.target.value)} /></Field><Field label="API key"><input style={{ ...INP, fontFamily: 'var(--font-mono)', fontSize: 12 }} type="password" value={svcForm.header_value} onChange={e => setSvc('header_value', e.target.value)} /></Field></Grid>,
    basic: <Grid cols={2}><Field label="Username"><input style={INP} value={svcForm.username} onChange={e => setSvc('username', e.target.value)} /></Field><Field label="Password"><input style={INP} type="password" value={svcForm.password} onChange={e => setSvc('password', e.target.value)} /></Field></Grid>,
    oauth2_client: <Grid cols={2}><Field label="Client ID"><input style={INP} value={svcForm.client_id} onChange={e => setSvc('client_id', e.target.value)} /></Field><Field label="Client secret"><input style={{ ...INP, fontFamily: 'var(--font-mono)', fontSize: 12 }} type="password" value={svcForm.client_secret} onChange={e => setSvc('client_secret', e.target.value)} /></Field><Field label="Token URL" hint="e.g. https://api.hubapi.com/oauth/v1/token"><input style={INP} placeholder="https://..." value={svcForm.token_url} onChange={e => setSvc('token_url', e.target.value)} /></Field><Field label="API version (optional)"><input style={INP} placeholder="e.g. 2024-11-20" value={svcForm.api_version} onChange={e => setSvc('api_version', e.target.value)} /></Field></Grid>,
    custom_headers: <Field label="Custom headers (JSON)"><textarea style={{ ...INP, resize: 'vertical', fontSize: 12, fontFamily: 'var(--font-mono)' }} rows={3} placeholder={'{"X-Custom-Auth": "token"}'} value={svcForm.custom_headers} onChange={e => setSvc('custom_headers', e.target.value)} /></Field>,
  }

  const dropZoneStyle: React.CSSProperties = {
    border: `2px dashed ${importDragOver ? 'var(--blue)' : 'var(--border2)'}`,
    borderRadius: 'var(--radius)',
    padding: '22px 20px',
    textAlign: 'center',
    background: importDragOver ? 'var(--blue-bg)' : 'var(--bg)',
    cursor: 'pointer',
    transition: 'all .15s',
    marginBottom: 16,
  }

  return (
    <div className="fade-in">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <PageTitle>API connections</PageTitle>
        {user.role === 'admin' && (
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn onClick={() => { fileRef.current?.click() }}>⬆ Import Postman</Btn>
            <Btn variant="primary" onClick={() => { setShowSvcForm(!showSvcForm); setEditingSvc(null); setSvcForm(SVC_EMPTY); setError('') }}>+ Add service</Btn>
          </div>
        )}
      </div>
      <PageSub>Group related endpoints under a service. Auth is shared across all connections within a service.</PageSub>

      <Alert variant="info">💬 Once connected, ask Claude: <em>"Fetch my latest HubSpot contacts"</em> or <em>"Get last month's Stripe revenue"</em></Alert>

      {error && <Alert variant="error">{error}</Alert>}

      {/* ── Postman import drop zone ── */}
      {user.role === 'admin' && !importPreview && (
        <>
          <input ref={fileRef} type="file" accept=".json" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handlePostmanFile(f); e.target.value = '' }} />
          <div style={dropZoneStyle}
            onDragOver={e => { e.preventDefault(); setImportDragOver(true) }}
            onDragLeave={() => setImportDragOver(false)}
            onDrop={onFileDrop}
            onClick={() => fileRef.current?.click()}>
            <div style={{ fontSize: 22, marginBottom: 6 }}>📮</div>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text2)', marginBottom: 3 }}>Drop a Postman collection here</div>
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>or click to browse · supports Postman v2.1 JSON</div>
          </div>
          {importError && <Alert variant="error">{importError}</Alert>}
        </>
      )}

      {/* ── Import preview ── */}
      {importPreview && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', padding: 20, marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <span style={{ fontSize: 18 }}>📮</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Import preview</div>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>{importPreview.connections.length} endpoint{importPreview.connections.length !== 1 ? 's' : ''} found</div>
            </div>
            <button onClick={() => setImportPreview(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 18, lineHeight: 1 }}>×</button>
          </div>

          <Grid cols={2}>
            <Field label="Service name">
              <input style={INP} value={importPreview.serviceName}
                onChange={e => setImportPreview(p => p ? { ...p, serviceName: e.target.value } : p)} />
            </Field>
            <Field label="Base URL">
              <input style={INP} value={importPreview.baseUrl}
                onChange={e => setImportPreview(p => p ? { ...p, baseUrl: e.target.value } : p)} />
            </Field>
          </Grid>

          <Field label="Bearer token (from collection)" hint="Replace with a valid token before using in chat">
            <input style={{ ...INP, fontFamily: 'var(--font-mono)', fontSize: 11 }} type="password"
              value={importPreview.token}
              onChange={e => setImportPreview(p => p ? { ...p, token: e.target.value } : p)} />
          </Field>

          {/* Connection list preview */}
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden', marginTop: 4 }}>
            {importPreview.connections.map((c, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderBottom: i < importPreview.connections.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: c.method === 'GET' ? 'var(--blue-bg)' : c.method === 'POST' ? 'var(--green-bg)' : 'var(--amber-bg)', color: c.method === 'GET' ? 'var(--blue-t)' : c.method === 'POST' ? 'var(--green-t)' : 'var(--amber-t)', minWidth: 36, textAlign: 'center' }}>{c.method}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{c.name}</div>
                  <code style={{ fontSize: 11, color: 'var(--text3)' }}>{c.path}</code>
                </div>
                <button onClick={() => setImportPreview(p => p ? { ...p, connections: p.connections.filter((_, j) => j !== i) } : p)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text4)', fontSize: 15, lineHeight: 1, padding: '2px 4px' }}>×</button>
              </div>
            ))}
          </div>

          {importError && <Alert variant="error">{importError}</Alert>}

          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <Btn variant="primary" onClick={confirmImport} disabled={importing}>
              {importing ? <><Spinner size={12} /> Importing…</> : `Import ${importPreview.connections.length} endpoint${importPreview.connections.length !== 1 ? 's' : ''}`}
            </Btn>
            <Btn onClick={() => { setImportPreview(null); setImportError('') }}>Cancel</Btn>
          </div>
        </div>
      )}

      {/* ── Manual service form ── */}
      {showSvcForm && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', padding: 24, marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 500, color: 'var(--text)', marginBottom: 18 }}>{editingSvc ? 'Edit service' : 'New API service'}</div>

          {!editingSvc && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text3)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '.06em' }}>Quick start</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {PRESETS.map(p => (
                  <button key={p.label} onClick={() => setSvcForm(f => ({ ...f, label: p.label, base_url: p.base_url, auth_type: p.auth_type }))}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', background: 'var(--bg)', border: '1px solid var(--border2)', borderRadius: 'var(--radius-pill)', cursor: 'pointer', fontSize: 13, color: 'var(--text)', fontFamily: 'inherit', boxShadow: 'var(--shadow)', fontWeight: 500, transition: 'box-shadow .15s' }}
                    onMouseEnter={e => (e.currentTarget.style.boxShadow = 'var(--shadow-md)')}
                    onMouseLeave={e => (e.currentTarget.style.boxShadow = 'var(--shadow)')}>
                    <span style={{ width: 20, height: 20, borderRadius: 5, background: p.color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, flexShrink: 0 }}>{p.icon}</span>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <Grid cols={2}>
            <Field label="Service name" required><input style={INP} placeholder="HubSpot" value={svcForm.label} onChange={e => setSvc('label', e.target.value)} /></Field>
            <Field label="Environment"><select style={SEL} value={svcForm.environment} onChange={e => setSvc('environment', e.target.value)}><option value="production">🔴 Production</option><option value="sandbox">🟡 Sandbox</option><option value="staging">🟢 Staging</option></select></Field>
          </Grid>
          <Field label="Base URL" required hint="All connection paths are appended to this"><input style={INP} placeholder="https://api.hubapi.com" value={svcForm.base_url} onChange={e => setSvc('base_url', e.target.value)} /></Field>

          <Field label="Authentication type">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
              {[['bearer','Bearer token'],['api_key_header','API key'],['oauth2_client','OAuth 2.0'],['basic','Basic'],['custom_headers','Custom']].map(([v,l]) => (
                <button key={v} onClick={() => setSvc('auth_type', v)}
                  style={{ padding: '6px 14px', borderRadius: 'var(--radius-pill)', border: `1.5px solid ${svcForm.auth_type === v ? 'var(--purple)' : 'var(--border2)'}`, background: svcForm.auth_type === v ? 'var(--purple-bg)' : 'var(--bg)', color: svcForm.auth_type === v ? 'var(--purple-t)' : 'var(--text2)', fontSize: 12, fontWeight: svcForm.auth_type === v ? 600 : 400, cursor: 'pointer', fontFamily: 'inherit', transition: 'all .15s' }}>
                  {l}
                </button>
              ))}
            </div>
            {authFields[svcForm.auth_type]}
          </Field>

          <Grid cols={3}>
            <Field label="Rate limit (req/min)" hint="Client-side throttle"><input style={INP} type="number" placeholder="100" value={svcForm.rate_limit_rpm} onChange={e => setSvc('rate_limit_rpm', e.target.value)} /></Field>
            <Field label="Request timeout (ms)"><input style={INP} type="number" value={svcForm.request_timeout_ms} onChange={e => setSvc('request_timeout_ms', e.target.value)} /></Field>
            <Field label="Retry attempts"><input style={INP} type="number" value={svcForm.retry_count} onChange={e => setSvc('retry_count', e.target.value)} /></Field>
          </Grid>

          <div style={{ display: 'flex', gap: 8, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <Btn variant="primary" onClick={saveSvc} disabled={saving}>{saving ? 'Saving…' : 'Save service'}</Btn>
            <Btn onClick={() => { setShowSvcForm(false); setEditingSvc(null); setError('') }}>Cancel</Btn>
          </div>
        </div>
      )}

      {/* ── Services list ── */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spinner size={24} /></div>
      ) : services.length === 0 ? (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '48px 24px', textAlign: 'center', fontSize: 14, color: 'var(--text3)' }}>
          No API services yet. Add one above or import a Postman collection.
        </div>
      ) : (
        services.map(svc => {
          const svcConns = connections.filter(c => c.service_id === svc.id)
          const isExpanded = expanded.has(svc.id)
          const p = preset(svc.label)
          return (
            <div key={svc.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', marginBottom: 10, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', cursor: 'pointer' }} onClick={() => toggle(svc.id)}>
                <div style={{ width: 34, height: 34, borderRadius: 'var(--radius-sm)', background: p?.color || 'var(--bg4)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{svc.label.slice(0, 2).toUpperCase()}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>{svc.label} <Badge label={svc.environment} color={envColor(svc.environment)} /></div>
                  <div style={{ fontSize: 12, color: 'var(--text3)' }}>{svc.base_url} · {svc.auth_type} · {svcConns.length} connection{svcConns.length !== 1 ? 's' : ''}</div>
                </div>
                {user.role === 'admin' && (
                  <div style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
                    <Btn size="sm" onClick={() => { const s = svc as unknown as Record<string,unknown>; setSvcForm({ ...SVC_EMPTY, label: String(s.label||''), base_url: String(s.base_url||''), environment: String(s.environment||'production'), auth_type: String(s.auth_type||'bearer'), rate_limit_rpm: String(s.rate_limit_rpm||''), request_timeout_ms: String(s.request_timeout_ms||30000), retry_count: String(s.retry_count||3) }); setEditingSvc(svc.id); setShowSvcForm(true) }}>Edit</Btn>
                    <Btn size="sm" variant="danger" onClick={() => delSvc(svc.id, svc.label)}>Delete</Btn>
                  </div>
                )}
                <span style={{ fontSize: 11, color: 'var(--text4)', transform: isExpanded ? 'rotate(90deg)' : 'none', display: 'inline-block', transition: 'transform .2s' }}>▶</span>
              </div>

              {isExpanded && (
                <div style={{ borderTop: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 18px', background: 'var(--bg)', borderBottom: '1px solid var(--border)', fontSize: 11, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>Shared auth:</span>
                    <span style={{ padding: '2px 9px', borderRadius: 'var(--radius-pill)', background: 'var(--green-bg)', border: '1px solid rgba(22,163,74,.2)', color: 'var(--green-t)', fontWeight: 500 }}>✓ {svc.auth_type}</span>
                    {svc.rate_limit_rpm && <span style={{ padding: '2px 9px', borderRadius: 'var(--radius-pill)', background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text3)' }}>{svc.rate_limit_rpm} req/min</span>}
                    <span style={{ padding: '2px 9px', borderRadius: 'var(--radius-pill)', background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text3)' }}>retry {svc.retry_count}×</span>
                    <span style={{ marginLeft: 'auto', color: 'var(--text4)' }}>all connections inherit ↑</span>
                  </div>

                  {svcConns.map(c => (
                    <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 18px 11px 42px', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ width: 6, height: 1, background: 'var(--border2)', flexShrink: 0 }} />
                      <div style={{ width: 22, height: 22, borderRadius: 5, background: 'var(--bg3)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, color: 'var(--text3)', fontWeight: 600, flexShrink: 0 }}>API</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 1 }}>{c.label}</div>
                        {c.description && <div style={{ fontSize: 11, color: 'var(--text3)' }}>{c.description}</div>}
                      </div>
                      {c.base_path && <code style={{ fontSize: 11, color: 'var(--text3)', background: 'var(--bg3)', padding: '2px 7px', borderRadius: 5, border: '1px solid var(--border)' }}>{c.base_path}</code>}
                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 'var(--radius-pill)', background: 'var(--bg3)', border: '1px solid var(--border)', color: 'var(--text4)' }}>↑ inherits auth</span>
                      {user.role === 'admin' && (
                        <div style={{ display: 'flex', gap: 5 }}>
                          <Btn size="sm" onClick={() => { setConnForm({ ...CONN_EMPTY, ...(c as unknown as Record<string,string>) }); setEditingConn(c.id); setShowConnForm(svc.id) }}>Edit</Btn>
                          <Btn size="sm" variant="danger" onClick={() => delConn(c.id, c.label)}>Delete</Btn>
                        </div>
                      )}
                    </div>
                  ))}

                  {user.role === 'admin' && showConnForm !== svc.id && (
                    <div style={{ padding: '10px 18px 10px 42px', cursor: 'pointer', fontSize: 13, color: 'var(--text3)', display: 'flex', alignItems: 'center', gap: 6 }}
                      onClick={() => { setConnForm(CONN_EMPTY); setEditingConn(null); setShowConnForm(svc.id) }}>
                      <span style={{ fontSize: 16 }}>+</span> Add connection to {svc.label}
                    </div>
                  )}

                  {showConnForm === svc.id && (
                    <div style={{ padding: '18px', borderTop: '1px solid var(--border)', background: 'var(--bg)' }}>
                      <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', marginBottom: 14 }}>{editingConn ? 'Edit connection' : `Add connection to ${svc.label}`}</div>
                      <Grid cols={2}>
                        <Field label="Connection label" required><input style={INP} placeholder="Contacts API" value={connForm.label} onChange={e => setConn('label', e.target.value)} /></Field>
                        <Field label="Base path" hint="Appended to service URL"><input style={INP} placeholder="/crm/v3/contacts" value={connForm.base_path} onChange={e => setConn('base_path', e.target.value)} /></Field>
                      </Grid>
                      <Field label="Description"><input style={INP} placeholder="Get, create, and update contacts" value={connForm.description} onChange={e => setConn('description', e.target.value)} /></Field>
                      <Grid cols={3}>
                        <Field label="Pagination">
                          <select style={SEL} value={connForm.pagination_style} onChange={e => setConn('pagination_style', e.target.value)}>
                            <option value="none">none</option>
                            <option value="offset">offset / limit</option>
                            <option value="cursor">cursor</option>
                            <option value="page">page number</option>
                            <option value="link-header">link header</option>
                          </select>
                        </Field>
                        <Field label="Limit param"><input style={INP} placeholder="limit" value={connForm.pagination_limit_param} onChange={e => setConn('pagination_limit_param', e.target.value)} /></Field>
                        <Field label="Data path" hint="e.g. results, data"><input style={INP} placeholder="results" value={connForm.pagination_data_path} onChange={e => setConn('pagination_data_path', e.target.value)} /></Field>
                      </Grid>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <Btn variant="primary" onClick={() => saveConn(svc.id)} disabled={saving}>{saving ? 'Saving…' : 'Save connection'}</Btn>
                        <Btn onClick={() => { setShowConnForm(null); setEditingConn(null) }}>Cancel</Btn>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}
