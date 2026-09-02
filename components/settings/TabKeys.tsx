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
  // Superset is bring-your-own: SUPERSET_URL / SUPERSET_PUBLIC_URL / ADMIN_USER /
  // ADMIN_PASSWORD resolve settings-first (via supersetSetting) in the status,
  // guest-token and native-login paths, so a customer can point Mosaic at their
  // OWN Superset from here without redeploying. AIRBYTE_* remains env-only (basic
  // auth shared by compose across both containers); Airbyte's BYO config lives in
  // Settings → Data sources. See ENV_TEMPLATE.md / DEPLOY_RUNBOOK.md.
  { title: 'Notifications — Twilio',   keys: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'] },
  { title: 'n8n Automation',           keys: ['N8N_URL', 'N8N_API_KEY', 'N8N_MOSAIC_API_KEY'] },
  { title: 'Superset Analytics',       keys: ['SUPERSET_URL', 'SUPERSET_PUBLIC_URL', 'SUPERSET_ADMIN_USER', 'SUPERSET_ADMIN_PASSWORD'] },
  { title: 'CISO Assistant',           keys: ['CISO_API_URL', 'CISO_SUPERUSER_EMAIL', 'CISO_SUPERUSER_PASSWORD'] },
]

// Generate a URL-safe random secret in the browser (used for the "Generate"
// action on keys like N8N_MOSAIC_API_KEY, so the user never has to run openssl or
// invent a value). 32 random bytes -> hex.
function genSecret(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

// Step-by-step panel showing exactly where the Mosaic-API-key-for-n8n goes on the
// n8n side. Renders under the N8N_MOSAIC_API_KEY field once it's generated/saved.
function N8nSetupSteps({ generatedKey, n8nUrl }: { generatedKey: string; n8nUrl?: string }) {
  const [copied, setCopied] = useState('')
  const bearer = generatedKey ? `Bearer ${generatedKey}` : 'Bearer <your key>'
  const copy = (text: string, label: string) => {
    navigator.clipboard?.writeText(text).then(() => { setCopied(label); setTimeout(() => setCopied(''), 1500) }).catch(() => {})
  }
  // Link to the n8n home rather than a deep credentials path: n8n's client-side
  // credentials route varies by version and (on Cloud) by project scoping, and a
  // wrong deep path silently redirects to the workflows page. The base URL always
  // opens n8n; the user clicks "Credentials" in the left nav from there.
  const n8nHome = n8nUrl ? n8nUrl.replace(/\/$/, '') : null

  const Field = ({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
      <span style={{ fontSize: 11, color: 'var(--text3)', minWidth: 92 }}>{label}</span>
      <code style={{ flex: 1, fontSize: 11, fontFamily: mono ? 'var(--font-mono)' : 'inherit', background: 'var(--bg3)', padding: '3px 8px', borderRadius: 4, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</code>
      <button
        onClick={() => copy(value, label)}
        style={{ fontSize: 10, padding: '3px 8px', borderRadius: 4, border: '1px solid var(--border2)', background: 'var(--bg)', color: 'var(--text2)', cursor: 'pointer', flexShrink: 0 }}
      >{copied === label ? 'Copied' : 'Copy'}</button>
    </div>
  )

  return (
    <div style={{ marginTop: 12, padding: '12px 14px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8 }}>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text2)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
        How to add this key in n8n
        {n8nHome && (
          <a href={n8nHome} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10.5, fontWeight: 500, color: 'var(--blue-t)', textDecoration: 'none' }}>
            open n8n ↗
          </a>
        )}
      </div>
      <ol style={{ margin: 0, paddingLeft: 18, fontSize: 11.5, color: 'var(--text3)', lineHeight: 1.9 }}>
        <li>In n8n, go to <b style={{ color: 'var(--text2)' }}>Credentials → Add credential</b> and choose <b style={{ color: 'var(--text2)' }}>Header Auth</b>.</li>
        <li>Fill it in exactly:
          <Field label="Name" value="Mosaic API" mono={false} />
          <Field label="Header Name" value="Authorization" />
          <Field label="Header Value" value={bearer} />
        </li>
        <li>Save the credential. Then in any HTTP Request node that calls Mosaic, set <b style={{ color: 'var(--text2)' }}>Authentication → Header Auth</b> and pick <b style={{ color: 'var(--text2)' }}>Mosaic API</b>.</li>
      </ol>
      {!generatedKey && (
        <div style={{ fontSize: 10.5, color: 'var(--text4)', marginTop: 8, fontStyle: 'italic' }}>
          The key is stored encrypted, so its value can&rsquo;t be shown again. If you didn&rsquo;t copy it, click Update → Generate to make a new one.
        </div>
      )}
    </div>
  )
}

const KEY_META: Record<string, { label: string; hint: string; placeholder: string; secret?: boolean; options?: string[]; generatable?: boolean; n8nSetup?: boolean }> = {
  ANTHROPIC_API_KEY:       { label: 'Anthropic API key',        hint: 'Powers all Mosaic AI completions · get it from console.anthropic.com',              placeholder: 'sk-ant-api03-...', secret: true },
  SEARCH_PROVIDER:         { label: 'Web search provider',      hint: 'Which service powers web search',                                                    placeholder: 'tavily', options: ['tavily', 'perplexity'] },
  TAVILY_API_KEY:          { label: 'Tavily API key',           hint: 'Web search · free tier at app.tavily.com · used when provider is Tavily',           placeholder: 'tvly-...', secret: true },
  PERPLEXITY_API_KEY:      { label: 'Perplexity API key',       hint: 'Web search via Sonar · get it from perplexity.ai/settings/api · used when provider is Perplexity', placeholder: 'pplx-...', secret: true },
  CRON_SECRET:             { label: 'Cron secret',              hint: 'Protects the scheduler endpoint · auto-generated on first run — only set this to use your own value',        placeholder: 'Auto-generated', secret: true },
  GITHUB_TOKEN:            { label: 'GitHub token',             hint: 'Fine-grained PAT with Contents read-only · used to check for Mosaic updates',       placeholder: 'github_pat_...', secret: true },
  GITHUB_REPO:             { label: 'GitHub repo',              hint: 'Repository to check for updates · format: owner/repo',                               placeholder: 'ankurisb/Mosaic' },
  TWILIO_ACCOUNT_SID:      { label: 'Twilio Account SID',       hint: 'Required for SMS and WhatsApp · found in Twilio Console',                            placeholder: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' },
  TWILIO_AUTH_TOKEN:       { label: 'Twilio Auth Token',        hint: 'Paired with Account SID · stored encrypted',                                        placeholder: 'Stored encrypted', secret: true },
  N8N_URL:                 { label: 'n8n URL',                  hint: 'Base URL of your n8n instance · default: http://localhost:5678',                    placeholder: 'http://localhost:5678' },
  N8N_API_KEY:             { label: 'n8n API key',              hint: 'Generated in n8n Settings → API · used by Mosaic to import workflows',              placeholder: 'n8n_...', secret: true },
  N8N_MOSAIC_API_KEY:      { label: 'Mosaic API key (for n8n)', hint: 'Lets your n8n workflows call Mosaic back (query data, trigger syncs, send notifications). Click Generate, Save, then follow the steps below to add it in n8n.',           placeholder: 'Click Generate to create one', generatable: true, n8nSetup: true },
  CISO_API_URL:            { label: 'CISO Assistant URL',       hint: 'Base URL of your CISO backend · point at your own instance to use it',              placeholder: 'http://ciso-backend:8000' },
  CISO_SUPERUSER_EMAIL:    { label: 'CISO admin email',         hint: 'Mosaic authenticates as this to provision users when access is granted',            placeholder: 'admin@yourcompany.com' },
  CISO_SUPERUSER_PASSWORD: { label: 'CISO admin password',      hint: 'Stored encrypted · required for user provisioning',                                 placeholder: 'Stored encrypted', secret: true },
  SUPERSET_URL:            { label: 'Superset URL',             hint: 'Reachable base URL of your Superset (server-side · used for health + API)',         placeholder: 'http://superset:8088' },
  SUPERSET_PUBLIC_URL:     { label: 'Superset public URL',      hint: 'Browser-facing URL for links & embeds · what users\u2019 browsers open',            placeholder: 'https://superset.yourco.com/' },
  SUPERSET_ADMIN_USER:     { label: 'Superset service user',    hint: 'Account Mosaic authenticates as to mint guest tokens · needs dashboard access',     placeholder: 'admin' },
  SUPERSET_ADMIN_PASSWORD: { label: 'Superset service password',hint: 'Paired with the service user · stored encrypted',                                    placeholder: 'Stored encrypted', secret: true },
}

// Tool launch links live in the "Connected tools" tab (TabInterfaces), which
// routes through the no-login handshake and is gated by surface access. This
// tab is for configuration only — no direct launch links (they bypassed the
// handshake and behaved inconsistently depending on existing tool cookies).

export default function TabKeys({ user }: { user: SessionUser }) {
  const [keys,    setKeys]    = useState<Record<string, { configured: boolean; preview: string; value?: string }>>({})
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
        // Also carry the plain value locally so provider-dependent rendering
        // (e.g. which search-provider key field to show) updates immediately,
        // without waiting for a refetch. The server only returns value for
        // non-secret keys, so mirror that: keep it only for the dropdown.
        const savedVal = vals[key]
        setKeys(p => ({ ...p, [key]: { configured: true, preview: savedVal.slice(0,4) + '...', ...(KEY_META[key]?.options ? { value: savedVal } : {}) } }))
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
                {(() => {
                  // Show only the key field for the currently-selected search
                  // provider, so the section reads as "pick a provider, then set
                  // its key" rather than presenting both providers' key fields
                  // at once.
                  const provider = (keys['SEARCH_PROVIDER']?.value || 'tavily').toLowerCase()
                  const hiddenKey = provider === 'perplexity' ? 'TAVILY_API_KEY' : 'PERPLEXITY_API_KEY'
                  return section.keys.filter(k => k !== hiddenKey)
                })().map((key, i, visibleKeys) => {
                  const meta = KEY_META[key]
                  if (!meta) return null
                  const status = keys[key]
                  const isEditing = editing === key
                  return (
                    <div key={key} style={{ padding: '14px 18px', borderBottom: i < visibleKeys.length - 1 ? '1px solid var(--border)' : 'none' }}>
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
                              {meta.options ? (
                                <select
                                  style={{ ...INP, flex: 1, fontSize: 12, cursor: 'pointer' }}
                                  value={vals[key] || meta.placeholder}
                                  onChange={e => setVals(p => ({ ...p, [key]: e.target.value }))}
                                  onKeyDown={e => { if (e.key === 'Escape') setEditing(null) }}
                                  autoFocus
                                >
                                  {meta.options.map(opt => (
                                    <option key={opt} value={opt}>{opt}</option>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  type={meta.secret ? 'password' : 'text'}
                                  style={{ ...INP, flex: 1, fontFamily: meta.secret ? 'var(--font-mono)' : 'inherit', fontSize: 12 }}
                                  placeholder={meta.placeholder}
                                  value={vals[key] || ''}
                                  onChange={e => setVals(p => ({ ...p, [key]: e.target.value }))}
                                  onKeyDown={e => { if (e.key === 'Enter') save(key); if (e.key === 'Escape') setEditing(null) }}
                                  autoFocus
                                />
                              )}
                              {meta.generatable && (
                                <Btn onClick={() => setVals(p => ({ ...p, [key]: genSecret() }))}>
                                  Generate
                                </Btn>
                              )}
                              <Btn variant="primary" onClick={() => save(key)} disabled={saving === key}>
                                {saving === key ? <Spinner size={12} /> : 'Save'}
                              </Btn>
                              <Btn onClick={() => setEditing(null)}>Cancel</Btn>
                            </div>
                          )}
                        </div>
                        {!isEditing && (
                          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                            <Btn size="sm" onClick={() => { setEditing(key); setVals(p => ({ ...p, [key]: meta.options ? meta.options[0] : '' })) }}>
                              {status?.configured ? 'Update' : 'Set'}
                            </Btn>
                            {status?.configured && (
                              <Btn size="sm" variant="danger" onClick={() => remove(key)}>Remove</Btn>
                            )}
                          </div>
                        )}
                      </div>
                      {meta.n8nSetup && (isEditing || status?.configured) && (
                        <N8nSetupSteps generatedKey={isEditing ? (vals[key] || '') : ''} n8nUrl={keys['N8N_URL']?.value} />
                      )}
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
