'use client'
import { useState, useEffect } from 'react'
import type { SessionUser } from '@/lib/auth'
import { PageTitle, PageSub, Card, CardRow, Btn, Badge, Spinner, Alert } from './ui'

interface ApiKey {
  id: string
  name: string
  key_preview: string
  scopes: string[]
  rate_limit: number
  active: number
  last_used_at: string | null
  expires_at: string | null
  created_at: string
}
interface KeyStats { last24h: number; total: number }

const SCOPE_LABELS: Record<string, string> = {
  read:  'Read',
  write: 'Write',
  admin: 'Admin',
}

const BASE_URL = typeof window !== 'undefined' ? window.location.origin : ''

export default function TabDeveloperAPI({ user }: { user: SessionUser }) {
  const [keys,       setKeys]       = useState<ApiKey[]>([])
  const [stats,      setStats]      = useState<Record<string, KeyStats>>({})
  const [loading,    setLoading]    = useState(true)
  const [creating,   setCreating]   = useState(false)
  const [newKey,     setNewKey]     = useState<string | null>(null)
  const [toast,      setToast]      = useState('')
  const [showForm,   setShowForm]   = useState(false)
  const [formName,   setFormName]   = useState('')
  const [formScopes, setFormScopes] = useState<string[]>(['read'])
  const [formRate,   setFormRate]   = useState(100)
  const [saving,     setSaving]     = useState(false)

  useEffect(() => { load() }, [])
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 3000); return () => clearTimeout(t) } }, [toast])

  async function load() {
    setLoading(true)
    try {
      const r = await fetch('/api/developer-keys')
      const d = await r.json()
      setKeys(d.keys || [])
      setStats(d.stats || {})
    } finally { setLoading(false) }
  }

  async function create() {
    if (!formName.trim()) return
    setSaving(true)
    try {
      const r = await fetch('/api/developer-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', name: formName, scopes: formScopes, rate_limit: formRate }),
      })
      const d = await r.json()
      if (d.ok) {
        setNewKey(d.key)
        setShowForm(false)
        setFormName('')
        setFormScopes(['read'])
        setFormRate(100)
        load()
      }
    } finally { setSaving(false) }
  }

  async function revoke(id: string) {
    if (!confirm('Revoke this API key? Any integrations using it will stop working immediately.')) return
    await fetch('/api/developer-keys', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'revoke', id }),
    })
    load(); setToast('Key revoked')
  }

  async function toggle(id: string, active: number) {
    await fetch('/api/developer-keys', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: active ? 'revoke' : 'enable', id }),
    })
    load(); setToast(active ? 'Key disabled' : 'Key enabled')
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text).then(() => setToast('Copied'))
  }

  function toggleScope(s: string) {
    setFormScopes(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])
  }

  const inp: React.CSSProperties = {
    background: 'var(--bg)', border: '1px solid var(--border2)',
    borderRadius: 'var(--radius-sm)', padding: '8px 12px', fontSize: 13,
    color: 'var(--text)', fontFamily: 'inherit', outline: 'none', width: '100%',
  }

  return (
    <div className="fade-in">
      <PageTitle>Developer API</PageTitle>
      <PageSub>Issue API keys to integrate Mosaic with external systems. All endpoints are under <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, background: 'var(--bg3)', padding: '1px 5px', borderRadius: 3 }}>/api/v1/</code></PageSub>

      {/* New key reveal */}
      {newKey && (
        <div style={{ background: 'var(--green-bg)', border: '1px solid rgba(22,163,74,.2)', borderRadius: 'var(--radius)', padding: '14px 18px', marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--green-t)', marginBottom: 8 }}>API key created — copy it now. It will not be shown again.</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <code style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text)', background: 'var(--bg)', padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{newKey}</code>
            <Btn size="sm" variant="primary" onClick={() => copy(newKey)}>Copy</Btn>
            <Btn size="sm" onClick={() => setNewKey(null)}>Dismiss</Btn>
          </div>
        </div>
      )}

      {/* Create key form */}
      {showForm ? (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '18px 20px', marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 14 }}>New API key</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text2)', marginBottom: 5 }}>Name</div>
              <input style={inp} placeholder="e.g. SCADA Integration" value={formName}
                onChange={e => setFormName(e.target.value)} autoFocus />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text2)', marginBottom: 5 }}>Rate limit (requests/hour)</div>
              <input style={inp} type="number" min={1} max={10000} value={formRate}
                onChange={e => setFormRate(parseInt(e.target.value) || 100)} />
            </div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text2)', marginBottom: 8 }}>Scopes</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {['read', 'write', 'admin'].map(s => (
                <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: 'var(--text)' }}>
                  <input type="checkbox" checked={formScopes.includes(s)} onChange={() => toggleScope(s)}
                    style={{ width: 14, height: 14, cursor: 'pointer' }} />
                  {SCOPE_LABELS[s]}
                  <span style={{ fontSize: 11, color: 'var(--text3)' }}>
                    {s === 'read' && '— query data, list resources'}
                    {s === 'write' && '— trigger RCA, run chat'}
                    {s === 'admin' && '— all permissions'}
                  </span>
                </label>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn variant="primary" size="sm" onClick={create} disabled={saving || !formName.trim()}>
              {saving ? 'Generating...' : 'Generate key'}
            </Btn>
            <Btn size="sm" onClick={() => { setShowForm(false); setFormName('') }}>Cancel</Btn>
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: 20 }}>
          <Btn variant="primary" onClick={() => setShowForm(true)}>+ Generate API key</Btn>
        </div>
      )}

      {/* Keys list */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><Spinner size={20} /></div>
      ) : keys.length === 0 ? (
        <Card>
          <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
            No API keys yet. Generate one to start building integrations.
          </div>
        </Card>
      ) : (
        <Card>
          {keys.map((k, i) => (
            <CardRow key={k.id} last={i === keys.length - 1}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 14, fontWeight: 500, color: k.active ? 'var(--text)' : 'var(--text3)' }}>{k.name}</span>
                  <Badge label={k.active ? 'active' : 'disabled'} color={k.active ? 'green' : 'gray'} />
                  {k.scopes.map(s => <Badge key={s} label={s} color="gray" />)}
                </div>
                <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--text3)' }}>
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{k.key_preview}</span>
                  <span>{k.rate_limit} req/hr</span>
                  {stats[k.id] && <span>{stats[k.id].last24h} calls today · {stats[k.id].total} total</span>}
                  {k.last_used_at && <span>Last used {new Date(k.last_used_at).toLocaleDateString()}</span>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <Btn size="sm" variant="danger" onClick={() => revoke(k.id)}>Revoke</Btn>
              </div>
            </CardRow>
          ))}
        </Card>
      )}

      {/* Endpoints quick reference */}
      <div style={{ marginTop: 32, marginBottom: 8, fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>Endpoints</div>
      <Card style={{ marginBottom: 20 }}>
        {[
          { method: 'POST', path: '/api/v1/chat',                  desc: 'Send a message, get AI response with data source access' },
          { method: 'POST', path: '/api/v1/query',                 desc: 'Natural language query against connected data sources' },
          { method: 'POST', path: '/api/v1/rca',                   desc: 'Trigger a Root Cause Analysis programmatically' },
          { method: 'GET',  path: '/api/v1/conversations',         desc: 'List conversation history' },
          { method: 'GET',  path: '/api/v1/connections',           desc: 'List all databases, APIs, and file servers' },
          { method: 'GET',  path: '/api/v1/connections/airbyte',   desc: 'List Airbyte sources and sync connections' },
          { method: 'GET',  path: '/api/v1/connections/:id/health',desc: 'Check health of a specific data source' },
          { method: 'GET',  path: '/api/v1/users',                 desc: 'List all users' },
        ].map((ep, i, arr) => (
          <CardRow key={ep.path} last={i === arr.length - 1}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: ep.method === 'POST' ? 'var(--blue-t)' : 'var(--green-t)', fontFamily: 'var(--font-mono)', flexShrink: 0, minWidth: 36 }}>{ep.method}</span>
              <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text)', flexShrink: 0 }}>{ep.path}</span>
              <span style={{ fontSize: 12, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ep.desc}</span>
            </div>
          </CardRow>
        ))}
      </Card>

      {/* Docs link + base URL */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ fontSize: 12, color: 'var(--text3)' }}>
          Base URL: <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11, background: 'var(--bg3)', padding: '1px 5px', borderRadius: 3 }}>{BASE_URL}/api/v1</code>
        </div>
        <Btn size="sm" onClick={() => window.open('/api/v1/docs', '_blank')}>Open API docs →</Btn>
      </div>

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: 'var(--text)', color: 'var(--bg)', padding: '9px 18px', borderRadius: 'var(--radius-pill)', fontSize: 13, fontWeight: 500, boxShadow: 'var(--shadow-lg)', zIndex: 999 }}>{toast}</div>
      )}
    </div>
  )
}
