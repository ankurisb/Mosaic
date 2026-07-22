'use client'
import { useState, useEffect } from 'react'
import type { SessionUser } from '@/lib/auth'
import { PageTitle, PageSub, INP, Btn, Badge, Alert, Spinner } from './ui'
import { safeJson } from '@/lib/fetch'

const KEY_SECTIONS = [
  { title: 'Anthropic',                keys: ['ANTHROPIC_API_KEY'] },
  { title: 'AI & Search',              keys: ['SEARCH_PROVIDER', 'TAVILY_API_KEY', 'PERPLEXITY_API_KEY'] },
  // NEXT_PUBLIC_APP_URL is deliberately NOT listed here. The NEXT_PUBLIC_
  // prefix means Next.js inlines it at BUILD time, so it can never be truly
  // runtime-configurable, and every consumer reads process.env directly. A
  // field here would save to kv_settings and be silently ignored. Set it in
  // .env instead (see ENV_TEMPLATE.md / DEPLOY_RUNBOOK.md).
  { title: 'App Configuration',        keys: ['CRON_SECRET'] },
  // DATABASE_URL is intentionally NOT here. It is Mosaic's own database
  // connection string — read from process.env at startup to open the very
  // connection this settings page is served from. A value stored in kv_settings
  // (which lives inside that database) could only be read after the connection
  // it defines already exists, so the field was always a silent no-op. It is
  // env-only bootstrap config; see ENV_TEMPLATE.md / DEPLOY_RUNBOOK.md.
  { title: 'GitHub — Update Checker',  keys: ['GITHUB_TOKEN', 'GITHUB_REPO'] },
  // Superset Analytics and Airbyte Connectors are intentionally NOT here. Their
  // credentials are internal service accounts, set once in .env and shared by
  // compose across both containers (e.g. SUPERSET_ADMIN_PASSWORD bootstraps the
  // Superset admin AND is what Mosaic authenticates with; AIRBYTE_* is basic
  // auth on both the proxy and Mosaic's caller). Editing them here can't reach
  // the other container, and all of them are read from process.env, never via
  // getKey — so the fields were silent no-ops. End users reach Superset through
  // the SSO gate, not these credentials. SUPERSET_URL is likewise an internal
  // Docker address fixed by the compose topology (its one getKey consumer falls
  // back to process.env). All env-only; see ENV_TEMPLATE.md / DEPLOY_RUNBOOK.md.
  { title: 'Notifications — Twilio',   keys: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'] },
  { title: 'n8n Automation',           keys: ['N8N_URL', 'N8N_API_KEY', 'N8N_MOSAIC_API_KEY'] },
  { title: 'CISO Assistant',           keys: ['CISO_API_URL', 'CISO_SUPERUSER_EMAIL', 'CISO_SUPERUSER_PASSWORD'] },
]

const KEY_META: Record<string, { label: string; hint: string; placeholder: string; secret?: boolean }> = {
  ANTHROPIC_API_KEY:       { label: 'Anthropic API key',        hint: 'Powers all Mosaic AI completions · get it from console.anthropic.com',              placeholder: 'sk-ant-api03-...', secret: true },
  SEARCH_PROVIDER:         { label: 'Web search provider',      hint: 'Which service powers web search · "tavily" (default) or "perplexity"',              placeholder: 'tavily' },
  TAVILY_API_KEY:          { label: 'Tavily API key',           hint: 'Web search · free tier at app.tavily.com · used when provider is Tavily',           placeholder: 'tvly-...', secret: true },
  PERPLEXITY_API_KEY:      { label: 'Perplexity API key',       hint: 'Web search via Sonar · get it from perplexity.ai/settings/api · used when provider is Perplexity', placeholder: 'pplx-...', secret: true },
  CRON_SECRET:             { label: 'Cron secret',              hint: 'Protects the scheduler endpoint · auto-generated on first run — only set this to use your own value',        placeholder: 'Auto-generated', secret: true },
  GITHUB_TOKEN:            { label: 'GitHub token',             hint: 'Fine-grained PAT with Contents read-only · used to check for Mosaic updates',       placeholder: 'github_pat_...', secret: true },
  GITHUB_REPO:             { label: 'GitHub repo',              hint: 'Repository to check for updates · format: owner/repo',                               placeholder: 'ankurisb/Mosaic' },
  TWILIO_ACCOUNT_SID:      { label: 'Twilio Account SID',       hint: 'Required for SMS and WhatsApp · found in Twilio Console',                            placeholder: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' },
  TWILIO_AUTH_TOKEN:       { label: 'Twilio Auth Token',        hint: 'Paired with Account SID · stored encrypted',                                        placeholder: 'Stored encrypted', secret: true },
  N8N_URL:                 { label: 'n8n URL',                  hint: 'Base URL of your n8n instance · default: http://localhost:5678',                    placeholder: 'http://localhost:5678' },
  N8N_API_KEY:             { label: 'n8n API key',              hint: 'Generated in n8n Settings → API · used by Mosaic to import workflows',              placeholder: 'n8n_...', secret: true },
  N8N_MOSAIC_API_KEY:      { label: 'Mosaic API key (for n8n)', hint: 'Paste into n8n as Header Auth credential · n8n uses this to call Mosaic',           placeholder: 'Generate below' },
  CISO_API_URL:            { label: 'CISO Assistant URL',       hint: 'Base URL of your CISO backend · point at your own instance to use it',              placeholder: 'http://ciso-backend:8000' },
  CISO_SUPERUSER_EMAIL:    { label: 'CISO admin email',         hint: 'Mosaic authenticates as this to provision users when access is granted',            placeholder: 'admin@yourcompany.com' },
  CISO_SUPERUSER_PASSWORD: { label: 'CISO admin password',      hint: 'Stored encrypted · required for user provisioning',                                 placeholder: 'Stored encrypted', secret: true },
}

// Tool launch links live in the "Connected tools" tab (TabInterfaces), which
// routes through the no-login handshake and is gated by surface access. This
// tab is for configuration only — no direct launch links (they bypassed the
// handshake and behaved inconsistently depending on existing tool cookies).

export default function TabKeys({ user }: { user: SessionUser }) {
  const [keys,    setKeys]    = useState<Record<string, { configured: boolean; preview: string }>>({})
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
      const { data: d, error: err } = await safeJson<{ ok?: boolean }>(r)
      if (err) { setToast('Error: ' + err); return }
      if (d?.ok) {
        setKeys(p => ({ ...p, [key]: { configured: true, preview: vals[key].slice(0,4) + '...' } }))
        setVals(p => ({ ...p, [key]: '' }))
        setEditing(null)
        setToast('Saved')
      }
    } catch (e) { setToast('Error: ' + (e instanceof Error ? e.message : 'Save failed')) }
    finally { setSaving(null) }
  }

  async function remove(key: string) {
    if (!confirm(`Remove ${KEY_META[key]?.label ?? key}?`)) return
    await fetch('/api/keys', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', key }),
    })
    setKeys(p => ({ ...p, [key]: { configured: false, preview: '' } }))
    setToast('Removed')
  }

  if (user.role !== 'admin') return (
    <div className="fade-in"><PageTitle>API keys & configuration</PageTitle><Alert variant="warning">Only admins can manage keys.</Alert></div>
  )

  return (
    <div className="fade-in">
      <PageTitle>API keys & configuration</PageTitle>
      <PageSub>Stored encrypted in the database. Set here instead of editing .env.local directly.</PageSub>

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 2000, padding: '10px 18px', background: 'var(--green-bg)', border: '1px solid rgba(22,163,74,.2)', borderRadius: 'var(--radius)', fontSize: 13, color: 'var(--green-t)', fontWeight: 500, boxShadow: 'var(--shadow-lg)' }}>
          {toast}
        </div>
      )}

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center' }}><Spinner size={20} /></div>
      ) : (
        <>
          {KEY_SECTIONS.map(section => (
            <div key={section.title} style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                {section.title}
              </div>
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
                {section.keys.map((key, i) => {
                  const meta = KEY_META[key]
                  if (!meta) return null
                  const status = keys[key]
                  const isEditing = editing === key
                  return (
                    <div key={key} style={{ padding: '14px 18px', borderBottom: i < section.keys.length - 1 ? '1px solid var(--border)' : 'none' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 8 }}>
                            {meta.label}
                            {status?.configured
                              ? <Badge label="configured" color="green" />
                              : <Badge label="not set" color="amber" />}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: isEditing ? 10 : 0 }}>{meta.hint}</div>
                          {status?.configured && !isEditing && (
                            <div style={{ fontSize: 11, color: 'var(--text4)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>{status.preview}</div>
                          )}
                          {isEditing && (
                            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                              <input
                                type={meta.secret ? 'password' : 'text'}
                                style={{ ...INP, flex: 1, fontFamily: meta.secret ? 'var(--font-mono)' : 'inherit', fontSize: 12 }}
                                placeholder={meta.placeholder}
                                value={vals[key] || ''}
                                onChange={e => setVals(p => ({ ...p, [key]: e.target.value }))}
                                onKeyDown={e => { if (e.key === 'Enter') save(key); if (e.key === 'Escape') setEditing(null) }}
                                autoFocus
                              />
                              <Btn variant="primary" onClick={() => save(key)} disabled={saving === key}>
                                {saving === key ? <Spinner size={12} /> : 'Save'}
                              </Btn>
                              <Btn onClick={() => setEditing(null)}>Cancel</Btn>
                            </div>
                          )}
                        </div>
                        {!isEditing && (
                          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                            <Btn size="sm" onClick={() => { setEditing(key); setVals(p => ({ ...p, [key]: '' })) }}>
                              {status?.configured ? 'Update' : 'Set'}
                            </Btn>
                            {status?.configured && (
                              <Btn size="sm" variant="danger" onClick={() => remove(key)}>Remove</Btn>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
