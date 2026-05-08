'use client'
import { useState, useEffect } from 'react'
import type { SessionUser } from '@/lib/auth'
import { PageTitle, PageSub, Card, CardRow, INP, Btn, Badge, Alert, Spinner } from './ui'

interface KeyStatus { configured: boolean; preview: string }

const KEY_META: Record<string, { label: string; hint: string; placeholder: string }> = {
  TAVILY_API_KEY:     { label: 'Tavily Search',      hint: 'Web search tool . Free tier at app.tavily.com -- 1,000 searches/month',                        placeholder: 'tvly-...' },
  TWILIO_ACCOUNT_SID: { label: 'Twilio Account SID', hint: 'Required for SMS and WhatsApp notifications . Found in Twilio Console dashboard',              placeholder: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' },
  TWILIO_AUTH_TOKEN:  { label: 'Twilio Auth Token',  hint: 'Stored encrypted at rest . Paired with Account SID',                                           placeholder: 'Stored encrypted' },
  N8N_URL:            { label: 'n8n URL',            hint: 'Base URL of your n8n instance . Default: http://localhost:5678',                                   placeholder: 'http://localhost:5678' },
  N8N_API_KEY:        { label: 'n8n API Key',        hint: 'Generated in n8n Settings → API → Create API Key . Used by Mosaic to check status and import workflows', placeholder: 'n8n_...' },
  N8N_MOSAIC_API_KEY: { label: 'Mosaic API Key (for n8n)', hint: 'Paste this into n8n as a Header Auth credential. n8n uses this to call Mosaic endpoints.', placeholder: 'Generate a key below' },
}

export default function TabKeys({ user }: { user: SessionUser }) {
  const [keys,    setKeys]    = useState<Record<string, KeyStatus>>({})
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<string | null>(null)
  const [vals,    setVals]    = useState<Record<string, string>>({})
  const [saving,  setSaving]  = useState<string | null>(null)
  const [toast,   setToast]   = useState('')

  useEffect(() => { load() }, [])
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 2500); return () => clearTimeout(t) } }, [toast])

  async function load() {
    setLoading(true)
    try {
      const r = await fetch('/api/keys')
      const d = await r.json()
      setKeys(d.keys || {})
    } finally { setLoading(false) }
  }

  async function save(key: string) {
    if (!vals[key]?.trim()) return
    setSaving(key)
    try {
      const r = await fetch('/api/keys', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set', key, value: vals[key] }),
      })
      const d = await r.json()
      if (d.ok) {
        setKeys(p => ({ ...p, [key]: { configured: true, preview: d.preview } }))
        setVals(p => ({ ...p, [key]: '' }))
        setEditing(null)
        setToast('Key saved')
      }
    } finally { setSaving(null) }
  }

  async function del(key: string) {
    if (!confirm(`Remove ${KEY_META[key]?.label ?? key}?`)) return
    await fetch('/api/keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', key }) })
    setKeys(p => ({ ...p, [key]: { configured: false, preview: '' } }))
    setToast('Key removed')
  }

  async function generateMosaicKey() {
    const key = 'mk_' + Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2,'0')).join('')
    setSaving('N8N_MOSAIC_API_KEY')
    try {
      const r = await fetch('/api/keys', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set', key: 'N8N_MOSAIC_API_KEY', value: key }),
      })
      const d = await r.json()
      if (d.ok) {
        setKeys(p => ({ ...p, N8N_MOSAIC_API_KEY: { configured: true, preview: d.preview } }))
        setVals(p => ({ ...p, N8N_MOSAIC_API_KEY: key }))
        setEditing('N8N_MOSAIC_API_KEY_show')
        setToast('Key generated — copy it now')
      }
    } finally { setSaving(null) }
  }

  const isAdmin = user.role === 'admin'

  return (
    <div className="fade-in">
      <PageTitle>API keys</PageTitle>
      <PageSub>Configure external service credentials. Keys are encrypted at rest and never returned in plaintext.</PageSub>

      {/* Env-var-only keys -- read only */}
      <Card style={{ marginBottom: 16 }}>
        <CardRow>
          <div>
            <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', marginBottom: 2 }}>
              Anthropic API key <Badge label="configured" color="green" />
            </div>
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>Powers all Mosaic AI completions . Set via ANTHROPIC_API_KEY environment variable</div>
          </div>
          <span style={{ fontSize: 12, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>sk-ant-</span>
        </CardRow>
        <CardRow last>
          <div>
            <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', marginBottom: 2 }}>
              Auth secret <Badge label="configured" color="green" />
            </div>
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>Signs session tokens . Set via AUTH_SECRET environment variable</div>
          </div>
          <span style={{ fontSize: 12, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}></span>
        </CardRow>
      </Card>

      {/* Configurable keys */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><Spinner size={20} /></div>
      ) : (<>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase' as const, letterSpacing: '.08em', marginBottom: 8, marginTop: 8 }}>Web Search</div>
      <Card style={{ marginBottom: 16 }}>
          {Object.entries(KEY_META).filter(([k]) => k === 'TAVILY_API_KEY').map(([key, meta], i, arr) => {
            const status = keys[key] || { configured: false, preview: '' }
            const isLast = i === arr.length - 1
            return (
              <div key={key}>
                <CardRow last={isLast && editing !== key}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 8 }}>
                      {meta.label}
                      <Badge label={status.configured ? 'configured' : 'not set'} color={status.configured ? 'green' : 'gray'} />
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text3)' }}>{meta.hint}</div>
                    {status.configured && status.preview && (
                      <div style={{ fontSize: 11, color: 'var(--text4)', fontFamily: 'var(--font-mono)', marginTop: 3 }}>{status.preview}</div>
                    )}
                  </div>
                  {isAdmin && (
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <Btn size="sm" onClick={() => setEditing(editing === key ? null : key)}>
                        {status.configured ? 'Update' : 'Set'}
                      </Btn>
                      {status.configured && <Btn size="sm" variant="danger" onClick={() => del(key)}>Remove</Btn>}
                    </div>
                  )}
                </CardRow>
                {editing === key && (
                  <div style={{ padding: '10px 18px', borderBottom: isLast ? 'none' : '1px solid var(--border)', background: 'var(--bg)', display: 'flex', gap: 8 }}>
                    <input
                      style={{ ...INP, flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12 }}
                      type="password"
                      placeholder={meta.placeholder}
                      value={vals[key] || ''}
                      onChange={e => setVals(p => ({ ...p, [key]: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter') save(key) }}
                      autoFocus
                    />
                    <Btn variant="primary" size="sm" onClick={() => save(key)} disabled={saving === key || !vals[key]?.trim()}>
                      {saving === key ? 'Saving...' : 'Save'}
                    </Btn>
                    <Btn size="sm" onClick={() => setEditing(null)}>Cancel</Btn>
                  </div>
                )}
              </div>
            )
          })}
      </Card>

      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase' as const, letterSpacing: '.08em', marginBottom: 8 }}>SMS & WhatsApp</div>
      <Card style={{ marginBottom: 16 }}>
          {Object.entries(KEY_META).filter(([k]) => k.startsWith('TWILIO')).map(([key, meta], i, arr) => {
            const status = keys[key] || { configured: false, preview: '' }
            const isLast = i === arr.length - 1
            return (
              <div key={key}>
                <CardRow last={isLast && editing !== key}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 8 }}>
                      {meta.label}
                      <Badge label={status.configured ? 'configured' : 'not set'} color={status.configured ? 'green' : 'gray'} />
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text3)' }}>{meta.hint}</div>
                    {status.configured && status.preview && (
                      <div style={{ fontSize: 11, color: 'var(--text4)', fontFamily: 'var(--font-mono)', marginTop: 3 }}>{status.preview}</div>
                    )}
                  </div>
                  {isAdmin && (
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <Btn size="sm" onClick={() => setEditing(editing === key ? null : key)}>
                        {status.configured ? 'Update' : 'Set'}
                      </Btn>
                      {status.configured && <Btn size="sm" variant="danger" onClick={() => del(key)}>Remove</Btn>}
                    </div>
                  )}
                </CardRow>
                {editing === key && (
                  <div style={{ padding: '10px 18px', borderBottom: isLast ? 'none' : '1px solid var(--border)', background: 'var(--bg)', display: 'flex', gap: 8 }}>
                    <input
                      style={{ ...INP, flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12 }}
                      type="password"
                      placeholder={meta.placeholder}
                      value={vals[key] || ''}
                      onChange={e => setVals(p => ({ ...p, [key]: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter') save(key) }}
                      autoFocus
                    />
                    <Btn variant="primary" size="sm" onClick={() => save(key)} disabled={saving === key || !vals[key]?.trim()}>
                      {saving === key ? 'Saving...' : 'Save'}
                    </Btn>
                    <Btn size="sm" onClick={() => setEditing(null)}>Cancel</Btn>
                  </div>
                )}
              </div>
            )
          })}
      </Card>

      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase' as const, letterSpacing: '.08em', marginBottom: 8 }}>Workflow Automation</div>
      <Card>
          {Object.entries(KEY_META).filter(([k]) => k.startsWith('N8N')).map(([key, meta], i, arr) => {
            const status = keys[key] || { configured: false, preview: '' }
            const isLast = i === arr.length - 1
            return (
              <div key={key}>
                <CardRow last={isLast && editing !== key}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 8 }}>
                      {meta.label}
                      <Badge label={status.configured ? 'configured' : 'not set'} color={status.configured ? 'green' : 'gray'} />
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text3)' }}>{meta.hint}</div>
                    {status.configured && status.preview && (
                      <div style={{ fontSize: 11, color: 'var(--text4)', fontFamily: 'var(--font-mono)', marginTop: 3 }}>{status.preview}</div>
                    )}
                  </div>
                  {isAdmin && (
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <Btn size="sm" onClick={() => setEditing(editing === key ? null : key)}>
                        {status.configured ? 'Update' : 'Set'}
                      </Btn>
                      {status.configured && <Btn size="sm" variant="danger" onClick={() => del(key)}>Remove</Btn>}
                    </div>
                  )}
                </CardRow>
                {editing === key && (
                  <div style={{ padding: '10px 18px', borderBottom: isLast ? 'none' : '1px solid var(--border)', background: 'var(--bg)', display: 'flex', gap: 8 }}>
                    <input
                      style={{ ...INP, flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12 }}
                      type="password"
                      placeholder={meta.placeholder}
                      value={vals[key] || ''}
                      onChange={e => setVals(p => ({ ...p, [key]: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter') save(key) }}
                      autoFocus
                    />
                    <Btn variant="primary" size="sm" onClick={() => save(key)} disabled={saving === key || !vals[key]?.trim()}>
                      {saving === key ? 'Saving...' : 'Save'}
                    </Btn>
                    <Btn size="sm" onClick={() => setEditing(null)}>Cancel</Btn>
                  </div>
                )}
              </div>
            )
          })}
        </Card>
      </>
      )}

      <Alert variant="info">
        Primary credentials (ANTHROPIC_API_KEY, AUTH_SECRET, DATABASE_URL, CRON_SECRET) must be set as Vercel environment variables and require a redeploy. The keys above can be updated without redeploying.
      </Alert>

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: 'var(--text)', color: 'var(--bg)', padding: '9px 18px', borderRadius: 'var(--radius-pill)', fontSize: 13, fontWeight: 500, boxShadow: 'var(--shadow-lg)', zIndex: 999 }}>{toast}</div>
      )}
    </div>
  )
}
