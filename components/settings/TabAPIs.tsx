'use client'
import { useState, useEffect } from 'react'
import type { SessionUser } from '@/lib/auth'
import { SH, SS, INP, SEL, Btn, Badge, StatusDot, Field, Grid, Spinner } from './ui'

interface ApiService { id: string; label: string; base_url: string; environment: string; auth_type: string; api_version: string; rate_limit_rpm: number; request_timeout_ms: number; retry_count: number }
interface ApiConn { id: string; service_id: string; label: string; description: string; base_path: string; pagination_style: string }

const SVC_EMPTY = { label: '', base_url: '', environment: 'production', auth_type: 'bearer', token: '', header_name: '', header_value: '', username: '', password: '', client_id: '', client_secret: '', token_url: '', custom_headers: '', api_version: '', version_header: '', rate_limit_rpm: '', request_timeout_ms: '30000', retry_count: '3' }
const CONN_EMPTY = { label: '', description: '', base_path: '', pagination_style: 'none', pagination_limit_param: 'limit', pagination_cursor_param: 'cursor', pagination_data_path: '' }

const PRESETS = [
  { label: 'HubSpot', base_url: 'https://api.hubapi.com', auth_type: 'oauth2_client', version_header: '', color: '#ff7a59', icon: 'H' },
  { label: 'Stripe', base_url: 'https://api.stripe.com', auth_type: 'bearer', version_header: 'Stripe-Version', color: '#635bff', icon: 'S' },
  { label: 'Salesforce', base_url: 'https://myorg.salesforce.com', auth_type: 'oauth2_client', color: '#0176d3', icon: 'SF' },
  { label: 'Slack', base_url: 'https://slack.com/api', auth_type: 'bearer', color: '#4a154b', icon: 'Sl' },
  { label: 'GitHub', base_url: 'https://api.github.com', auth_type: 'bearer', color: '#333', icon: 'G' },
  { label: 'Notion', base_url: 'https://api.notion.com', auth_type: 'bearer', color: '#000', icon: 'N' },
]

export default function TabAPIs({ user }: { user: SessionUser }) {
  const [services, setServices] = useState<ApiService[]>([])
  const [connections, setConnections] = useState<ApiConn[]>([])
  const [loading, setLoading] = useState(true)
  const [showSvcForm, setShowSvcForm] = useState(false)
  const [svcForm, setSvcForm] = useState<Record<string, string>>(SVC_EMPTY)
  const [editingSvc, setEditingSvc] = useState<string | null>(null)
  const [expandedSvc, setExpandedSvc] = useState<Set<string>>(new Set())
  const [showConnForm, setShowConnForm] = useState<string | null>(null)
  const [connForm, setConnForm] = useState<Record<string, string>>(CONN_EMPTY)
  const [editingConn, setEditingConn] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  async function load() {
    setLoading(true)
    const res = await fetch('/api/services')
    if (res.ok) { const d = await res.json(); setServices(d.services); setConnections(d.connections) }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const setSvc = (k: string, v: string) => setSvcForm(p => ({ ...p, [k]: v }))
  const setConn = (k: string, v: string) => setConnForm(p => ({ ...p, [k]: v }))

  function buildAuthConfig() {
    const t = svcForm.auth_type
    if (t === 'bearer') return { token: svcForm.token }
    if (t === 'api_key_header') return { header: svcForm.header_name, key: svcForm.header_value }
    if (t === 'basic') return { username: svcForm.username, password: svcForm.password }
    if (t === 'oauth2_client') return { client_id: svcForm.client_id, client_secret: svcForm.client_secret, token_url: svcForm.token_url }
    try { return JSON.parse(svcForm.custom_headers || '{}') } catch { return {} }
  }

  async function saveSvc() {
    if (!svcForm.label || !svcForm.base_url) { setMsg('Label and base URL are required'); return }
    setSaving(true)
    const auth_config = buildAuthConfig()
    const res = await fetch('/api/services', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: editingSvc ? 'updateService' : 'createService', id: editingSvc, ...svcForm, auth_config }),
    })
    const d = await res.json()
    if (!res.ok) { setMsg(d.error); setSaving(false); return }
    setMsg(''); setSaving(false); setShowSvcForm(false); setEditingSvc(null); setSvcForm(SVC_EMPTY); load()
  }

  async function delSvc(id: string, label: string) {
    if (!confirm(`Delete service "${label}" and all its connections?`)) return
    await fetch('/api/services', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'deleteService', id }) })
    load()
  }

  async function saveConn(serviceId: string) {
    if (!connForm.label) { setMsg('Label is required'); return }
    setSaving(true)
    const res = await fetch('/api/services', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: editingConn ? 'updateConnection' : 'createConnection', id: editingConn, service_id: serviceId, ...connForm }),
    })
    const d = await res.json()
    if (!res.ok) { setMsg(d.error); setSaving(false); return }
    setMsg(''); setSaving(false); setShowConnForm(null); setEditingConn(null); setConnForm(CONN_EMPTY); load()
  }

  async function delConn(id: string, label: string) {
    if (!confirm(`Delete connection "${label}"?`)) return
    await fetch('/api/services', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'deleteConnection', id }) })
    load()
  }

  function toggleExpand(id: string) {
    setExpandedSvc(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  const envColor = (e: string) => e === 'production' ? 'red' : e === 'staging' ? 'amber' : 'green'

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={SH}>API connections</div>
        {user.role === 'admin' && <Btn variant="primary" onClick={() => { setShowSvcForm(!showSvcForm); setEditingSvc(null); setSvcForm(SVC_EMPTY) }}>+ add service</Btn>}
      </div>
      <div style={SS}>Group related API endpoints under a service. Auth is shared across all connections in a service.</div>
      <div style={{ background: 'var(--bbg)', border: '1px solid var(--blue)', borderRadius: 8, padding: '10px 14px', fontSize: 11, color: 'var(--bt)', marginBottom: 20 }}>
        💬 Once connected, ask Claude: <em>"Fetch my latest HubSpot contacts"</em> or <em>"Get last month's Stripe revenue"</em>
      </div>

      {msg && <div style={{ background: 'var(--rbg)', border: '1px solid var(--red)', borderRadius: 6, padding: '8px 12px', fontSize: 11, color: 'var(--rt)', marginBottom: 12 }}>{msg}</div>}

      {/* Add service form */}
      {showSvcForm && (
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border2)', borderRadius: 10, padding: 20, marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 12 }}>{editingSvc ? 'Edit service' : 'New API service'}</div>

          {/* Presets */}
          {!editingSvc && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase' as const, letterSpacing: '.08em', marginBottom: 8 }}>Quick start</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 6 }}>
                {PRESETS.map(p => (
                  <button key={p.label} onClick={() => setSvcForm(f => ({ ...f, label: p.label, base_url: p.base_url, auth_type: p.auth_type, version_header: p.version_header || '' }))}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 8px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 7, cursor: 'pointer', fontSize: 11, color: 'var(--text2)' }}>
                    <span style={{ width: 18, height: 18, borderRadius: 4, background: p.color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 600, flexShrink: 0 }}>{p.icon}</span>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <Grid cols={2}>
            <Field label="Service name *"><input style={INP} placeholder="HubSpot" value={svcForm.label} onChange={e => setSvc('label', e.target.value)} /></Field>
            <Field label="Environment">
              <select style={SEL} value={svcForm.environment} onChange={e => setSvc('environment', e.target.value)}>
                <option value="production">🔴 Production</option>
                <option value="sandbox">🟡 Sandbox</option>
                <option value="staging">🟢 Staging</option>
              </select>
            </Field>
          </Grid>
          <Field label="Base URL *" hint="All connection paths are appended to this">
            <input style={INP} placeholder="https://api.hubapi.com" value={svcForm.base_url} onChange={e => setSvc('base_url', e.target.value)} />
          </Field>

          <Field label="Authentication type">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const, marginBottom: 12 }}>
              {['bearer', 'api_key_header', 'oauth2_client', 'basic', 'custom_headers'].map(a => (
                <button key={a} onClick={() => setSvc('auth_type', a)}
                  style={{ padding: '4px 10px', borderRadius: 14, border: `1px solid ${svcForm.auth_type === a ? 'var(--purple)' : 'var(--border2)'}`, background: svcForm.auth_type === a ? 'var(--pbg)' : 'none', color: svcForm.auth_type === a ? 'var(--pt)' : 'var(--text2)', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit' }}>
                  {a === 'bearer' ? 'Bearer token' : a === 'api_key_header' ? 'API key (header)' : a === 'oauth2_client' ? 'OAuth 2.0' : a === 'basic' ? 'Basic auth' : 'Custom headers'}
                </button>
              ))}
            </div>
            {svcForm.auth_type === 'bearer' && <Field label="Token"><input style={INP} type="password" placeholder="Bearer token or API key" value={svcForm.token} onChange={e => setSvc('token', e.target.value)} /></Field>}
            {svcForm.auth_type === 'api_key_header' && <Grid cols={2}><Field label="Header name"><input style={INP} placeholder="X-API-Key" value={svcForm.header_name} onChange={e => setSvc('header_name', e.target.value)} /></Field><Field label="API key"><input style={INP} type="password" value={svcForm.header_value} onChange={e => setSvc('header_value', e.target.value)} /></Field></Grid>}
            {svcForm.auth_type === 'basic' && <Grid cols={2}><Field label="Username"><input style={INP} value={svcForm.username} onChange={e => setSvc('username', e.target.value)} /></Field><Field label="Password"><input style={INP} type="password" value={svcForm.password} onChange={e => setSvc('password', e.target.value)} /></Field></Grid>}
            {svcForm.auth_type === 'oauth2_client' && (
              <Grid cols={2}>
                <Field label="Client ID"><input style={INP} value={svcForm.client_id} onChange={e => setSvc('client_id', e.target.value)} /></Field>
                <Field label="Client secret"><input style={INP} type="password" value={svcForm.client_secret} onChange={e => setSvc('client_secret', e.target.value)} /></Field>
                <Field label="Token URL" hint="e.g. https://api.hubapi.com/oauth/v1/token"><input style={INP} placeholder="https://..." value={svcForm.token_url} onChange={e => setSvc('token_url', e.target.value)} /></Field>
                <Field label="API version" hint="e.g. 2024-11-20 or leave blank"><input style={INP} placeholder="optional" value={svcForm.api_version} onChange={e => setSvc('api_version', e.target.value)} /></Field>
              </Grid>
            )}
            {svcForm.auth_type === 'custom_headers' && <Field label="Headers (JSON)"><textarea style={{ ...INP, resize: 'vertical' as const, fontSize: 11 }} rows={3} placeholder={'{"X-Custom-Auth": "token"}'} value={svcForm.custom_headers} onChange={e => setSvc('custom_headers', e.target.value)} /></Field>}
          </Field>

          <Grid cols={3}>
            <Field label="Rate limit (req/min)" hint="Client-side throttle"><input style={INP} type="number" placeholder="100" value={svcForm.rate_limit_rpm} onChange={e => setSvc('rate_limit_rpm', e.target.value)} /></Field>
            <Field label="Request timeout (ms)"><input style={INP} type="number" value={svcForm.request_timeout_ms} onChange={e => setSvc('request_timeout_ms', e.target.value)} /></Field>
            <Field label="Retry attempts"><input style={INP} type="number" value={svcForm.retry_count} onChange={e => setSvc('retry_count', e.target.value)} /></Field>
          </Grid>

          <div style={{ display: 'flex', gap: 8, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
            <Btn variant="primary" onClick={saveSvc} disabled={saving}>{saving ? 'Saving…' : 'Save service'}</Btn>
            <Btn onClick={() => { setShowSvcForm(false); setEditingSvc(null) }}>Cancel</Btn>
          </div>
        </div>
      )}

      {/* Services list */}
      {loading ? <div style={{ textAlign: 'center', padding: 40 }}><Spinner /></div> : services.length === 0 ? (
        <div style={{ border: '1px solid var(--border2)', borderRadius: 10, padding: 32, textAlign: 'center', fontSize: 12, color: 'var(--text3)' }}>
          No API services yet. Add one above to start calling APIs from chat.
        </div>
      ) : (
        <div>
          {services.map(svc => {
            const svcConns = connections.filter(c => c.service_id === svc.id)
            const expanded = expandedSvc.has(svc.id)
            return (
              <div key={svc.id} style={{ border: '1px solid var(--border2)', borderRadius: 10, marginBottom: 10, overflow: 'hidden' }}>
                {/* Service header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', background: 'var(--bg2)', cursor: 'pointer' }} onClick={() => toggleExpand(svc.id)}>
                  <div style={{ width: 30, height: 30, borderRadius: 6, background: PRESETS.find(p => p.label === svc.label)?.color || 'var(--bg4)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, flexShrink: 0 }}>
                    {svc.label.slice(0, 2).toUpperCase()}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{svc.label} <Badge label={svc.environment} color={envColor(svc.environment)} /></div>
                    <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 1 }}>{svc.base_url} · {svc.auth_type} · {svcConns.length} connection{svcConns.length !== 1 ? 's' : ''}</div>
                  </div>
                  {user.role === 'admin' && (
                    <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
                      <Btn onClick={() => { const s = svc as unknown as Record<string, unknown>; setSvcForm({ ...SVC_EMPTY, label: String(s.label||''), base_url: String(s.base_url||''), environment: String(s.environment||'production'), auth_type: String(s.auth_type||'bearer'), rate_limit_rpm: String(s.rate_limit_rpm||''), request_timeout_ms: String(s.request_timeout_ms||30000), retry_count: String(s.retry_count||3), api_version: String(s.api_version||''), version_header: String(s.version_header||'') }); setEditingSvc(svc.id); setShowSvcForm(true) }}>edit</Btn>
                      <Btn variant="danger" onClick={() => delSvc(svc.id, svc.label)}>delete</Btn>
                    </div>
                  )}
                  <span style={{ fontSize: 10, color: 'var(--text3)', transition: 'transform .2s', transform: expanded ? 'rotate(90deg)' : 'none', display: 'inline-block' }}>▶</span>
                </div>

                {/* Connections */}
                {expanded && (
                  <div style={{ borderTop: '1px solid var(--border)' }}>
                    {/* Auth strip */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 14px', background: 'var(--bg2)', borderBottom: '1px solid var(--border)', fontSize: 10, flexWrap: 'wrap' as const }}>
                      <span style={{ color: 'var(--text3)', textTransform: 'uppercase' as const, letterSpacing: '.06em' }}>shared auth:</span>
                      <span style={{ padding: '2px 7px', borderRadius: 4, background: 'var(--gbg)', border: '1px solid var(--green)', color: 'var(--gt)', fontSize: 10 }}>✓ {svc.auth_type}</span>
                      {svc.rate_limit_rpm && <span style={{ padding: '2px 7px', borderRadius: 4, background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text2)', fontSize: 10 }}>{svc.rate_limit_rpm} req/min</span>}
                      <span style={{ padding: '2px 7px', borderRadius: 4, background: 'var(--bg3)', border: '1px solid var(--border2)', color: 'var(--text2)', fontSize: 10 }}>retry {svc.retry_count}×</span>
                      <span style={{ marginLeft: 'auto', color: 'var(--text3)' }}>all connections inherit ↑</span>
                    </div>

                    {svcConns.map((c, i) => (
                      <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px 9px 38px', borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'var(--bg)' : 'var(--bg2)' }}>
                        <div style={{ width: 14, flexShrink: 0 }}><div style={{ width: 10, height: 1, background: 'var(--border2)' }} /></div>
                        <div style={{ width: 20, height: 20, borderRadius: 4, background: 'var(--bg4)', border: '1px solid var(--border2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, color: 'var(--text2)', flexShrink: 0 }}>API</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text)' }}>{c.label}</div>
                          {c.description && <div style={{ fontSize: 10, color: 'var(--text3)' }}>{c.description}</div>}
                        </div>
                        {c.base_path && <code style={{ fontSize: 10, color: 'var(--text3)', background: 'var(--bg4)', padding: '2px 6px', borderRadius: 3, border: '1px solid var(--border)' }}>{c.base_path}</code>}
                        <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 8, background: 'var(--bg4)', border: '1px solid var(--border2)', color: 'var(--text3)' }}>↑ inherits auth</span>
                        {user.role === 'admin' && (
                          <div style={{ display: 'flex', gap: 4 }}>
                            <Btn onClick={() => { setConnForm({ ...CONN_EMPTY, ...(c as unknown as Record<string, string>) }); setEditingConn(c.id); setShowConnForm(svc.id) }}>edit</Btn>
                            <Btn variant="danger" onClick={() => delConn(c.id, c.label)}>delete</Btn>
                          </div>
                        )}
                      </div>
                    ))}

                    {/* Add connection */}
                    {user.role === 'admin' && showConnForm !== svc.id && (
                      <div style={{ padding: '8px 14px 8px 38px', borderTop: svcConns.length > 0 ? '1px solid var(--border)' : 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 11, display: 'flex', alignItems: 'center', gap: 6 }}
                        onClick={() => { setConnForm(CONN_EMPTY); setEditingConn(null); setShowConnForm(svc.id) }}>
                        <span>+</span><span>add connection to {svc.label}</span>
                      </div>
                    )}

                    {showConnForm === svc.id && (
                      <div style={{ padding: '14px 16px', borderTop: '1px solid var(--border)', background: 'var(--bg)' }}>
                        <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 12 }}>{editingConn ? 'Edit connection' : `Add connection to ${svc.label}`}</div>
                        <Grid cols={2}>
                          <Field label="Connection label *"><input style={INP} placeholder="Contacts API" value={connForm.label} onChange={e => setConn('label', e.target.value)} /></Field>
                          <Field label="Base path" hint="Appended to service URL"><input style={INP} placeholder="/crm/v3/contacts" value={connForm.base_path} onChange={e => setConn('base_path', e.target.value)} /></Field>
                        </Grid>
                        <Field label="Description"><input style={INP} placeholder="Get, create, and update contacts" value={connForm.description} onChange={e => setConn('description', e.target.value)} /></Field>
                        <Grid cols={3}>
                          <Field label="Pagination style">
                            <select style={SEL} value={connForm.pagination_style} onChange={e => setConn('pagination_style', e.target.value)}>
                              <option value="none">none</option>
                              <option value="offset">offset / limit</option>
                              <option value="cursor">cursor</option>
                              <option value="page">page number</option>
                              <option value="link-header">link header</option>
                            </select>
                          </Field>
                          <Field label="Limit param"><input style={INP} placeholder="limit" value={connForm.pagination_limit_param} onChange={e => setConn('pagination_limit_param', e.target.value)} /></Field>
                          <Field label="Data path in response" hint="e.g. results, data, items"><input style={INP} placeholder="results" value={connForm.pagination_data_path} onChange={e => setConn('pagination_data_path', e.target.value)} /></Field>
                        </Grid>
                        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                          <Btn variant="primary" onClick={() => saveConn(svc.id)} disabled={saving}>{saving ? 'Saving…' : 'Save connection'}</Btn>
                          <Btn onClick={() => { setShowConnForm(null); setEditingConn(null) }}>Cancel</Btn>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
